import "server-only";
import { and, eq, inArray, isNull, or } from "drizzle-orm";

import { db } from "@/db";
import {
  lessons,
  POST_FORMATS,
  posts,
  type Post,
  type PostFormat,
  type PostStatus,
} from "@/db/schema";
import {
  adaptPost,
  draftPost,
  PostGenerationError,
  type PostSeed,
  type PostTarget,
  type PromptLesson,
  type PromptPostFact,
} from "@/lib/ai";
import {
  getAccount,
  getBrand,
  getBrandKit,
  getIdea,
  getPost,
  listFamilyFacts,
  listPostAssets,
  listSiblingAccounts,
  type AccountWithBrand,
} from "@/lib/bridge";
import { listFacts } from "@/lib/bridge/facts";
import { SpendCapExceededError } from "@/lib/spend";

import { mergeSection, partForFormat, type PostSection } from "./assemble";
import { validatePostDraft, type PostDraft } from "./contract";
import { loadPlaybook, loadPostStyleGuide } from "./guides";
import {
  briefMarkdown,
  buildBrief,
  buildPack,
  captionText,
  packMarkdown,
  type PostBrief,
  type PostPack,
} from "./export";
import { checkTransition } from "./status";

/**
 * The post engine (PLAN.md §1.46–§1.47, §5.O11.2): drafting a post for one
 * account from an idea or a topic, rewriting one section, adapting a post to
 * every sibling account in its family, and the free edits around them. The
 * routes under `src/app/api/posts/` and S15's actions call these; nothing here
 * checks who is asking — spending is gated by the caller (§1.20).
 */

/** A refusal the caller can show as-is: `status` is the HTTP status it maps to. */
export class PostEngineError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 = 400,
    readonly errors: string[] = [],
  ) {
    super(message);
    this.name = "PostEngineError";
  }
}

/** More than this and the prompt is a fact dump; the first ones by topic go. */
export const MAX_POST_FACTS = 40;
export const MAX_POST_LESSONS = 30;
/** Lesson kinds a post prompt learns from (§1.46): hooks, CTAs and caption patterns. */
const POST_LESSON_KINDS = ["hook", "cta", "caption_pattern"] as const;

/** The format a post gets when neither the idea nor the caller names one. */
export function defaultFormat(platform: string): PostFormat {
  switch (platform) {
    case "instagram":
      return "carousel";
    case "tiktok":
    case "youtube":
      return "reel";
    case "facebook":
      return "image_post";
    default:
      return "text";
  }
}

/**
 * Facts for a post on `account` (§1.48): the family's shared facts in the
 * account's language (falling back to the base language, `pt-BR` → `pt`),
 * then the brand's own sheet. Unverified facts travel flagged, so the prompt
 * can only hedge them.
 */
async function factsFor(account: AccountWithBrand): Promise<PromptPostFact[]> {
  const language = account.effectiveLanguage;
  const base = language.split("-")[0];
  const family = account.familyId
    ? (await listFamilyFacts(account.familyId)).filter(
        (f) => f.language === language || f.language === base,
      )
    : [];
  const own = await listFacts(account.brandId);
  return [...family, ...own].slice(0, MAX_POST_FACTS).map((f) => ({
    topic: f.topic,
    claim: f.claim,
    sourceUrl: f.sourceUrl,
    verified: f.verified,
  }));
}

/** The brand's, the family's and the portfolio-wide hook/CTA/caption lessons, newest first. */
async function lessonsFor(account: AccountWithBrand): Promise<PromptLesson[]> {
  return db
    .select({ kind: lessons.kind, text: lessons.text, sourceUrl: lessons.sourceUrl })
    .from(lessons)
    .where(
      and(
        inArray(lessons.kind, [...POST_LESSON_KINDS]),
        or(
          eq(lessons.brandId, account.brandId),
          account.familyId ? eq(lessons.familyId, account.familyId) : undefined,
          and(isNull(lessons.brandId), isNull(lessons.familyId)),
        ),
      ),
    )
    .orderBy(lessons.createdAt)
    .then((rows) => rows.reverse().slice(0, MAX_POST_LESSONS));
}

/** Everything a post prompt for `account` needs besides the seed. */
export async function postTarget(account: AccountWithBrand, format: PostFormat): Promise<PostTarget> {
  const brand = await getBrand(account.brandId);
  if (!brand) throw new PostEngineError(`Account @${account.handle} has no brand on file.`, 409);
  const [kit, facts, promptLessons, playbook, styleGuide] = await Promise.all([
    getBrandKit(brand.id),
    factsFor(account),
    lessonsFor(account),
    loadPlaybook(account.platform),
    loadPostStyleGuide(account.effectiveLanguage),
  ]);
  return {
    brand,
    platform: account.platform,
    handle: account.handle,
    language: account.effectiveLanguage,
    format,
    kit: kit
      ? {
          ctas: kit.ctas,
          hashtags: kit.hashtags,
          dos: kit.dos,
          donts: kit.donts,
          styleNotes: kit.higgsfield?.styleNotes ?? "",
        }
      : null,
    facts,
    lessons: promptLessons,
    playbook,
    styleGuide,
  };
}

function isPostFormat(value: unknown, formats: readonly string[]): value is PostFormat {
  return typeof value === "string" && formats.includes(value);
}

export type CreatePostInput = {
  accountId: number;
  ideaId?: number | null;
  topic?: string | null;
  format?: string | null;
  title?: string | null;
};

/**
 * Draft a post from an idea or a topic and save it as `drafting` (§5.O11.2).
 * Everything that can be refused for free is refused before the paid call.
 */
export async function createPostFromIdea(
  input: CreatePostInput,
): Promise<{ post: Post; costUsd: number }> {
  const account = await getAccount(input.accountId);
  if (!account) throw new PostEngineError(`No account ${input.accountId}.`, 404);

  const topic = input.topic?.trim() ?? "";
  if (!input.ideaId && !topic) throw new PostEngineError("Give an ideaId or a topic.");
  if (input.ideaId && topic) throw new PostEngineError("Give an ideaId or a topic, not both.");

  let seed: PostSeed;
  let ideaFormat: PostFormat | null = null;
  let title = input.title?.trim() ?? "";
  if (input.ideaId) {
    const idea = await getIdea(input.ideaId);
    if (!idea) throw new PostEngineError(`No idea ${input.ideaId}.`, 404);
    seed = {
      idea: {
        title: idea.title,
        angle: idea.angle,
        draftCopy: idea.draftCopy,
        visualNotes: idea.visualNotes,
        citations: idea.citations ?? null,
      },
    };
    ideaFormat = idea.format;
    title ||= idea.title;
  } else {
    seed = { topic };
    title ||= topic.slice(0, 120);
  }

  if (input.format != null && !isPostFormat(input.format, POST_FORMATS)) {
    throw new PostEngineError(`format must be one of ${POST_FORMATS.join(", ")}`);
  }
  const format: PostFormat =
    (input.format as PostFormat | null | undefined) ?? ideaFormat ?? defaultFormat(account.platform);

  const target = await postTarget(account, format);
  const { body, costUsd } = await draftPost(seed, target);

  const [post] = await db
    .insert(posts)
    .values({
      accountId: account.id,
      brandId: account.brandId,
      ideaId: input.ideaId ?? null,
      format,
      status: "drafting",
      title,
      body,
      caption: captionText(body),
      firstComment: body.firstComment ?? null,
    })
    .returning();
  return { post, costUsd };
}

async function requirePost(postId: number) {
  const post = await getPost(postId);
  if (!post) throw new PostEngineError(`No post ${postId}.`, 404);
  return post;
}

function storedDraft(post: Post): PostDraft {
  const verdict = validatePostDraft(post.body);
  if (!verdict.ok) {
    throw new PostEngineError(
      `Post ${post.id} has no valid draft to work from.`,
      409,
      verdict.errors,
    );
  }
  return post.body as PostDraft;
}

/**
 * Rewrite one section of a post's draft and keep the rest (§5.O11.2). The
 * model sees the whole draft; only `section` (and any new sources) is taken.
 */
export async function regenerateSection(
  postId: number,
  section: PostSection,
): Promise<{ post: Post; costUsd: number }> {
  const post = await requirePost(postId);
  const current = storedDraft(post);
  const part = partForFormat(current.format);
  if (["slides", "shots", "storyFrames"].includes(section) && section !== part) {
    throw new PostEngineError(`A ${current.format} has no ${section}.`);
  }
  const account = await getAccount(post.accountId);
  if (!account) throw new PostEngineError(`Post ${postId}'s account is gone.`, 409);

  const target = await postTarget(account, current.format);
  const { body: fresh, costUsd } = await draftPost(
    { topic: post.title || current.hook },
    { ...target, language: current.language },
    { current, section },
  );
  const next = mergeSection(current, fresh, section);
  const verdict = validatePostDraft(next);
  if (!verdict.ok) {
    throw new PostGenerationError("The rewritten section does not fit the post contract.", verdict.errors);
  }
  const [saved] = await db
    .update(posts)
    .set({
      body: next,
      caption: captionText(next),
      firstComment: next.firstComment ?? null,
      updatedAt: new Date(),
    })
    .where(eq(posts.id, postId))
    .returning();
  return { post: saved, costUsd };
}

export type AdaptResult = {
  created: Post[];
  /** Accounts that already have a version of this post, or failed to adapt. */
  skipped: { accountId: number; handle: string; reason: string }[];
  costUsd: number;
};

/**
 * "Adapt to family" (§1.47): one sibling post per other active account in the
 * same family and platform, rewritten for that brand's language, voice and
 * audience. Re-runnable: an account that already has a version of this post
 * (anywhere in its tree) is skipped, so a second click only fills the gaps.
 * One target failing does not undo the others; the spend cap stops the run.
 */
export async function adaptToFamily(postId: number): Promise<AdaptResult> {
  const post = await requirePost(postId);
  const source = storedDraft(post);
  const rootId = post.parentPostId ?? post.id;

  const targets = await listSiblingAccounts(post.accountId);
  const tree = await db
    .select({ accountId: posts.accountId })
    .from(posts)
    .where(or(eq(posts.id, rootId), eq(posts.parentPostId, rootId)));
  const covered = new Set(tree.map((r) => r.accountId));

  const result: AdaptResult = { created: [], skipped: [], costUsd: 0 };
  for (const account of targets) {
    if (covered.has(account.id)) {
      result.skipped.push({
        accountId: account.id,
        handle: account.handle,
        reason: "already has a version of this post",
      });
      continue;
    }
    try {
      const target = await postTarget(account, source.format);
      const { body, costUsd } = await adaptPost(source, target);
      result.costUsd += costUsd;
      const [sibling] = await db
        .insert(posts)
        .values({
          accountId: account.id,
          brandId: account.brandId,
          ideaId: post.ideaId,
          parentPostId: rootId,
          format: source.format,
          status: "drafting",
          title: post.title,
          body,
          caption: captionText(body),
          firstComment: body.firstComment ?? null,
        })
        .returning();
      result.created.push(sibling);
    } catch (error) {
      if (error instanceof SpendCapExceededError && result.created.length === 0) throw error;
      if (error instanceof PostGenerationError || error instanceof SpendCapExceededError) {
        result.skipped.push({ accountId: account.id, handle: account.handle, reason: error.message });
        if (error instanceof SpendCapExceededError) break;
        continue;
      }
      throw error;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// free edits
// ---------------------------------------------------------------------------

/** Move a post to `status` if the move is legal (`status.ts`); stamps `published_at` on publish. */
export async function setStatus(postId: number, status: PostStatus): Promise<Post> {
  const post = await requirePost(postId);
  const check = checkTransition(post.status, status, {
    hasBody: post.body != null,
    scheduledFor: post.scheduledFor,
  });
  if (!check.ok) throw new PostEngineError(check.error, 409);
  const [saved] = await db
    .update(posts)
    .set({
      status,
      ...(status === "published" && !post.publishedAt ? { publishedAt: new Date() } : {}),
      updatedAt: new Date(),
    })
    .where(eq(posts.id, postId))
    .returning();
  return saved;
}

export type PostPatch = {
  title?: string;
  body?: unknown;
  caption?: string | null;
  firstComment?: string | null;
  notes?: string | null;
  scheduledFor?: Date | null;
  permalink?: string | null;
  status?: PostStatus;
};

/**
 * The PATCH route's edit (§5.O11.3). A new body must pass the contract and
 * refreshes the caption and first comment unless those are sent too. The
 * status moves last, so "set a date and schedule" is one request.
 */
export async function updatePost(postId: number, patch: PostPatch): Promise<Post> {
  const post = await requirePost(postId);
  const set: Partial<typeof posts.$inferInsert> = {};

  if (patch.title !== undefined) set.title = patch.title.trim();
  if (patch.body !== undefined) {
    const verdict = validatePostDraft(patch.body);
    if (!verdict.ok) throw new PostEngineError("body does not match the post contract", 400, verdict.errors);
    const body = patch.body as PostDraft;
    if (body.format !== post.format) {
      throw new PostEngineError(`body.format must stay "${post.format}"`);
    }
    set.body = body;
    set.caption = captionText(body);
    set.firstComment = body.firstComment ?? null;
  }
  if (patch.caption !== undefined) set.caption = patch.caption;
  if (patch.firstComment !== undefined) set.firstComment = patch.firstComment;
  if (patch.notes !== undefined) set.notes = patch.notes;
  if (patch.scheduledFor !== undefined) set.scheduledFor = patch.scheduledFor;
  if (patch.permalink !== undefined) set.permalink = patch.permalink;

  if (Object.keys(set).length) {
    await db
      .update(posts)
      .set({ ...set, updatedAt: new Date() })
      .where(eq(posts.id, postId));
  }
  if (patch.status !== undefined) return setStatus(postId, patch.status);
  const updated = await getPost(postId);
  return updated!;
}

// ---------------------------------------------------------------------------
// exports
// ---------------------------------------------------------------------------

/** The generation brief (§1.45): Markdown for a person, JSON for `/higgsfield-post`. */
export async function exportBrief(postId: number): Promise<{ markdown: string; json: PostBrief }> {
  const post = await requirePost(postId);
  const draft = storedDraft(post);
  const json = buildBrief(post, draft, await getBrandKit(post.brandId));
  return { markdown: briefMarkdown(json), json };
}

/** The phone post pack (§1.49): caption, first comment and the files in order. */
export async function exportPack(postId: number): Promise<{ markdown: string; json: PostPack }> {
  const post = await requirePost(postId);
  const draft = storedDraft(post);
  const json = buildPack(post, draft, await listPostAssets(postId));
  return { markdown: packMarkdown(json), json };
}
