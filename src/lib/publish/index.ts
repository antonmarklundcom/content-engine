import "server-only";
import { and, asc, eq, inArray, like, lt, lte, or } from "drizzle-orm";

import { db } from "@/db";
import {
  assets,
  integrations,
  postAssets,
  posts,
  socialAccounts,
  type Post,
  type SocialAccount,
} from "@/db/schema";
import { withLease } from "@/lib/lease";
import { publishCopy } from "@/lib/media/public";
import { GraphClient, graphFetch, MetaGraphError, type GraphFetch } from "@/lib/meta/graph";
import { setIntegrationStatus, usableToken } from "@/lib/meta/integration";
import { pageToken } from "@/lib/meta/pages";
import { validatePostDraft, type PostDraft } from "@/lib/posts/contract";
import { captionText } from "@/lib/posts/export";
import type { StorageDriver } from "@/lib/storage/driver";

import { GraphWriter, isTransient } from "./graph";
import {
  fetchPermalink,
  finishInstagram,
  postComment,
  publishFacebook,
  publishInstagram,
  PublishFailure,
  type PollOptions,
  type PublishContext,
} from "./meta";
import {
  MAX_ATTEMPTS,
  planAssets,
  planPublish,
  retryDue,
  TEMPORARY_PREFIX,
  type PlanAsset,
} from "./plan";

/**
 * Publishing (PLAN.md §5.O13). An external, irreversible action, so it runs
 * only for a `scheduled` post whose time has come (`publishDue`, from
 * `npm run publish:due` and `/api/cron/publish`) or on the owner's "Publish
 * now" click (`publishPost` with `trigger: "manual"`).
 *
 * Two leases (§1.19): `publish` keeps two due runs from overlapping, and
 * `publish:post:<id>` — taken by the due run and the button alike — keeps two
 * callers from ever publishing the same post. The status claim
 * (`… → publishing` only from the status just read) is a third guard.
 *
 * Files come from `publishCopy()` (§1.41): Meta fetches them from the public
 * Hostinger URL. A temporary failure (Meta unreachable, 5xx, rate limit) before
 * the post went public is retried by the due run with backoff, at most
 * `MAX_ATTEMPTS` times; anything else stays `failed` with the reason.
 */

export const PUBLISH_LEASE = "publish";
export const PUBLISH_LEASE_TTL_MS = 15 * 60 * 1000;
const POST_LEASE_TTL_MS = 10 * 60 * 1000;
/** A `publishing` post with no container and no lease for this long was interrupted. */
export const STUCK_AFTER_MS = POST_LEASE_TTL_MS;

export const postLeaseName = (postId: number) => `publish:post:${postId}`;

export type PublishOptions = {
  now?: Date;
  fetch?: GraphFetch;
  poll?: Partial<PollOptions>;
  /** Injected storage drivers for `publishCopy` (tests). */
  drivers?: { local?: StorageDriver; public?: StorageDriver };
};

export type PublishOutcome = {
  postId: number;
  result: "published" | "pending" | "failed" | "skipped";
  message?: string;
  permalink?: string | null;
};

const DEFAULT_POLL: PollOptions = { tries: 6, delayMs: 5000 };

type Trigger = "due" | "manual";

class Refusal extends Error {}

/** Publish one post now, if it may be. Never throws for an expected failure. */
export async function publishPost(
  postId: number,
  options: PublishOptions & { trigger?: Trigger } = {},
): Promise<PublishOutcome> {
  const run = await withLease(postLeaseName(postId), POST_LEASE_TTL_MS, () =>
    publishLocked(postId, options.trigger ?? "manual", options),
  );
  if (!run.acquired) {
    return { postId, result: "skipped", message: "This post is already being published." };
  }
  return run.value;
}

function eligible(post: Post, trigger: Trigger, now: Date): string | null {
  if (post.status === "published") return "It is already published.";
  if (post.status === "publishing") {
    return post.externalContainerId ? null : "It is being published right now.";
  }
  if (trigger === "manual") {
    return ["ready", "scheduled", "failed"].includes(post.status)
      ? null
      : `A ${post.status} post cannot be published; make it ready first.`;
  }
  const due = post.scheduledFor !== null && post.scheduledFor.getTime() <= now.getTime();
  if (post.status === "scheduled") return due ? null : "Its time has not come.";
  if (post.status === "failed" && due && retryDue(post, now)) return null;
  return "It is not due.";
}

async function publishLocked(
  postId: number,
  trigger: Trigger,
  options: PublishOptions,
): Promise<PublishOutcome> {
  const now = options.now ?? new Date();
  const [post] = await db.select().from(posts).where(eq(posts.id, postId)).limit(1);
  if (!post) return { postId, result: "skipped", message: `No post ${postId}.` };
  const refused = eligible(post, trigger, now);
  if (refused) return { postId, result: "skipped", message: refused };

  // Resuming a container that exists is not a new attempt: it cannot post twice.
  const resume =
    post.externalContainerId !== null && ["publishing", "failed"].includes(post.status);
  const [claimed] = await db
    .update(posts)
    .set({
      status: "publishing",
      publishError: null,
      lastPublishAttemptAt: now,
      publishAttempts: resume ? post.publishAttempts : post.publishAttempts + 1,
      updatedAt: now,
    })
    .where(and(eq(posts.id, postId), eq(posts.status, post.status)))
    .returning();
  if (!claimed) return { postId, result: "skipped", message: "Its status changed; try again." };

  let integrationId: number | null = null;
  try {
    const account = await accountFor(claimed);
    integrationId = account.integrationId;
    const ctx = await contextFor(claimed, account, options);
    ctx.onContainer = async (containerId) => {
      await db.update(posts).set({ externalContainerId: containerId }).where(eq(posts.id, postId));
    };

    let done;
    let used: PlanAsset[] = [];
    if (resume && account.platform === "instagram") {
      done = await finishInstagram(ctx, claimed.externalContainerId!);
    } else {
      const plan = planPublish({
        platform: account.platform,
        format: claimed.format,
        caption: ctx.caption,
        assets: await attached(postId),
      });
      if (!plan.ok) throw new Refusal(plan.error);
      used = planAssets(plan.plan);
      for (const a of used) {
        const copy = await publishCopy(a.assetId, { now, drivers: options.drivers });
        if (!("url" in copy)) {
          throw new Refusal(`${a.name} (asset ${a.assetId}) has no public URL: ${copy.message}`);
        }
        ctx.urls.set(a.assetId, copy.url);
      }
      done =
        plan.plan.platform === "instagram"
          ? await publishInstagram(ctx, plan.plan)
          : await publishFacebook(ctx, plan.plan);
    }

    if (done.status === "pending") {
      return {
        postId,
        result: "pending",
        message: "Instagram is still processing the media; the next run publishes it.",
      };
    }
    return await markPublished(claimed, account, ctx, done.mediaId, used, now);
  } catch (err) {
    return failed(claimed, err, integrationId, now);
  }
}

async function accountFor(post: Post): Promise<SocialAccount> {
  const [account] = await db
    .select()
    .from(socialAccounts)
    .where(eq(socialAccounts.id, post.accountId))
    .limit(1);
  if (!account) throw new Refusal(`The post's account (${post.accountId}) no longer exists.`);
  if (account.platform !== "instagram" && account.platform !== "facebook") {
    throw new Refusal(
      `Publishing to ${account.platform} is not built yet; post it by hand with the post pack.`,
    );
  }
  if (!account.externalId || !account.integrationId) {
    throw new Refusal(
      `@${account.handle} is not linked to Meta. Link it in Settings → Meta (step 6), then publish again.`,
    );
  }
  return account;
}

async function contextFor(
  post: Post,
  account: SocialAccount,
  options: PublishOptions,
): Promise<PublishContext> {
  const [row] = await db
    .select()
    .from(integrations)
    .where(and(eq(integrations.id, account.integrationId!), eq(integrations.provider, "meta")))
    .limit(1);
  if (!row) {
    throw new Refusal(
      `@${account.handle}'s Meta connection no longer exists. Reconnect in Settings → Meta.`,
    );
  }
  const token = await usableToken(row, options.now);
  if (!token.ok) throw new Refusal(`@${account.handle}: ${token.reason}`);

  const fetchImpl = options.fetch ?? graphFetch();
  const actingToken =
    account.platform === "facebook"
      ? await pageToken(new GraphClient(token.token, fetchImpl), account.externalId!)
      : token.token;
  const draft = validatePostDraft(post.body).ok ? (post.body as PostDraft) : null;
  return {
    writer: new GraphWriter(actingToken, fetchImpl),
    targetId: account.externalId!,
    handle: account.handle,
    caption: post.caption ?? (draft ? captionText(draft) : ""),
    urls: new Map(),
    poll: { ...DEFAULT_POLL, ...options.poll },
  };
}

async function attached(postId: number): Promise<PlanAsset[]> {
  const rows = await db
    .select({
      assetId: postAssets.assetId,
      role: postAssets.role,
      position: postAssets.position,
      kind: assets.kind,
      localPath: assets.localPath,
      altText: assets.altText,
    })
    .from(postAssets)
    .innerJoin(assets, eq(assets.id, postAssets.assetId))
    .where(eq(postAssets.postId, postId))
    .orderBy(asc(postAssets.position));
  return rows.map((r) => ({
    assetId: r.assetId,
    role: r.role,
    position: r.position,
    kind: r.kind,
    altText: r.altText,
    name: r.localPath?.split("/").pop() ?? `asset ${r.assetId}`,
  }));
}

async function markPublished(
  post: Post,
  account: SocialAccount,
  ctx: PublishContext,
  mediaId: string,
  used: PlanAsset[],
  now: Date,
): Promise<PublishOutcome> {
  await db
    .update(posts)
    .set({
      status: "published",
      publishedAt: now,
      externalMediaId: mediaId,
      externalContainerId: null,
      publishError: null,
      updatedAt: now,
    })
    .where(eq(posts.id, post.id));
  if (used.length) {
    await db
      .update(assets)
      .set({ status: "used", updatedAt: now })
      .where(
        and(
          inArray(
            assets.id,
            used.map((a) => a.assetId),
          ),
          inArray(assets.status, ["new", "approved"]),
        ),
      );
  }

  // The post is live; nothing below may turn it into a failure.
  const platform = account.platform as "instagram" | "facebook";
  const notes: string[] = [];
  let permalink: string | null = null;
  try {
    permalink = await fetchPermalink(ctx.writer, platform, mediaId);
  } catch (err) {
    notes.push(`the permalink could not be read (${message(err)}); meta:sync fills it later`);
  }
  const draft = validatePostDraft(post.body).ok ? (post.body as PostDraft) : null;
  const comment = (post.firstComment ?? draft?.firstComment ?? "").trim();
  if (comment) {
    try {
      await postComment(ctx.writer, mediaId, comment);
    } catch (err) {
      notes.push(`the first comment failed (${message(err)}); post it by hand`);
    }
  }
  const note = notes.length ? `Published, but ${notes.join("; ")}.` : null;
  await db
    .update(posts)
    .set({ permalink: permalink ?? post.permalink, publishError: note?.slice(0, 1024) ?? null })
    .where(eq(posts.id, post.id));
  return { postId: post.id, result: "published", permalink, message: note ?? undefined };
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function failed(
  post: Post,
  err: unknown,
  integrationId: number | null,
  now: Date,
): Promise<PublishOutcome> {
  let text = message(err);
  let temporary = false;
  let keepContainer = false;
  if (err instanceof PublishFailure) {
    temporary = err.temporary;
    keepContainer = err.keepContainer;
  } else if (err instanceof MetaGraphError) {
    if (err.isTokenError) {
      text = `Meta rejected the login (${err.message}). Reconnect in Settings → Meta.`;
      if (integrationId) await setIntegrationStatus(integrationId, "expired", text);
    } else if (isTransient(err)) {
      temporary = true;
    } else {
      text = `Meta refused: ${err.message}`;
    }
  } else if (!(err instanceof Refusal)) {
    text = `Unexpected error: ${text}`;
  }

  // A resumed container that fails for a temporary reason keeps its container.
  const [current] = await db
    .select({ externalContainerId: posts.externalContainerId })
    .from(posts)
    .where(eq(posts.id, post.id));
  const container = current?.externalContainerId ?? null;
  const keep = keepContainer || (temporary && container !== null);

  const retries = temporary && post.publishAttempts < MAX_ATTEMPTS && post.scheduledFor !== null;
  const stored = retries
    ? `${TEMPORARY_PREFIX}${text}`
    : temporary
      ? `${text} Gave up after ${post.publishAttempts} attempt(s).`
      : text;
  await db
    .update(posts)
    .set({
      status: "failed",
      publishError: stored.slice(0, 1024),
      externalContainerId: keep ? container : null,
      updatedAt: now,
    })
    .where(eq(posts.id, post.id));
  return { postId: post.id, result: "failed", message: stored };
}

// --- the due run ---------------------------------------------------------------

export type DueReport = {
  busy: boolean;
  considered: number;
  outcomes: PublishOutcome[];
  interrupted: number[];
};

/**
 * Publish every post whose time has come, resume reels Meta was still
 * processing, retry temporary failures after their backoff, and mark posts a
 * crashed run left in `publishing` as failed (never re-publish them: they may
 * already be live).
 */
export async function publishDue(
  options: PublishOptions & { limit?: number } = {},
): Promise<DueReport> {
  const now = options.now ?? new Date();
  const limit = options.limit ?? 10;
  const run = await withLease(PUBLISH_LEASE, PUBLISH_LEASE_TTL_MS, async () => {
    const candidates = await db
      .select()
      .from(posts)
      .where(
        or(
          and(eq(posts.status, "scheduled"), lte(posts.scheduledFor, now)),
          eq(posts.status, "publishing"),
          and(
            eq(posts.status, "failed"),
            lte(posts.scheduledFor, now),
            like(posts.publishError, `${TEMPORARY_PREFIX}%`),
            lt(posts.publishAttempts, MAX_ATTEMPTS),
          ),
        ),
      )
      .orderBy(asc(posts.scheduledFor), asc(posts.id));

    const report: DueReport = { busy: false, considered: 0, outcomes: [], interrupted: [] };
    for (const post of candidates) {
      if (report.outcomes.length >= limit) break;
      if (post.status === "publishing" && !post.externalContainerId) {
        if (await markInterrupted(post, now)) report.interrupted.push(post.id);
        continue;
      }
      if (post.status === "failed" && !retryDue(post, now)) continue;
      report.considered++;
      report.outcomes.push(await publishPost(post.id, { ...options, now, trigger: "due" }));
    }
    return report;
  });
  return run.acquired ? run.value : { busy: true, considered: 0, outcomes: [], interrupted: [] };
}

async function markInterrupted(post: Post, now: Date): Promise<boolean> {
  const started = post.lastPublishAttemptAt?.getTime() ?? 0;
  if (now.getTime() - started < STUCK_AFTER_MS) return false;
  const run = await withLease(postLeaseName(post.id), POST_LEASE_TTL_MS, async () => {
    const [row] = await db
      .update(posts)
      .set({
        status: "failed",
        publishError:
          "Publishing was interrupted before Meta confirmed it. Check the account before publishing again.",
        updatedAt: now,
      })
      .where(and(eq(posts.id, post.id), eq(posts.status, "publishing")))
      .returning({ id: posts.id });
    return Boolean(row);
  });
  return run.acquired && run.value;
}

/** One line for a cron log. */
export function summarizeDue(report: DueReport): string {
  if (report.busy) return "Another publish run holds the lease; skipped.";
  const count = (r: PublishOutcome["result"]) =>
    report.outcomes.filter((o) => o.result === r).length;
  return (
    `${count("published")} published, ${count("pending")} processing, ${count("failed")} failed, ` +
    `${count("skipped")} skipped, ${report.interrupted.length} interrupted`
  );
}
