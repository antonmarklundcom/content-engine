"use server";

/**
 * Posts, the calendar and the post pack, from the UI (PLAN.md §6.S15).
 *
 * Thin wrappers over O11's engine (`src/lib/posts/engine.ts`): every status
 * move goes through its `setStatus`/`updatePost`, so the legal-transition
 * table is the one in `status.ts` and never re-implemented here. The one
 * thing the engine has no writer for is `post_assets` (attach, reorder,
 * detach), which lives here.
 *
 * Every action returns `{ ok, … } | { ok: false, error }` rather than
 * throwing: production strips a thrown action's message, and the engine's
 * refusals ("A drafting post cannot become published…") are exactly the text
 * the person needs to see. Drafting and adapting spend, so they are owner-only
 * (§1.20); everything else is a free edit for any signed-in user.
 */

import { revalidatePath } from "next/cache";
import { and, asc, eq, max } from "drizzle-orm";

import { db } from "@/db";
import { POST_ASSET_ROLES, postAssets, type PostAssetRole, type PostStatus } from "@/db/schema";
import { PostGenerationError } from "@/lib/ai";
import { ForbiddenError } from "@/lib/auth/roles";
import { requireOwner, requireUser } from "@/lib/auth/session";
import { getAsset, getPost } from "@/lib/bridge";
import {
  adaptToFamily,
  createPostFromIdea,
  PostEngineError,
  setStatus,
  updatePost,
  type PostPatch,
} from "@/lib/posts/engine";
import { isPostStatus } from "@/lib/posts/status";
import { formatUsd, SpendCapExceededError } from "@/lib/spend";

export type PostActionResult<T = object> =
  ({ ok: true } & T) | { ok: false; error: string; errors?: string[] };

function isPositiveId(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/** The refusals a person can act on, as a result; anything else is a bug and rethrown. */
function refusal(error: unknown): { ok: false; error: string; errors?: string[] } {
  if (error instanceof PostEngineError) {
    return {
      ok: false,
      error: error.message,
      ...(error.errors.length ? { errors: error.errors } : {}),
    };
  }
  if (error instanceof PostGenerationError) {
    return { ok: false, error: error.message, errors: error.errors };
  }
  if (error instanceof SpendCapExceededError || error instanceof ForbiddenError) {
    return { ok: false, error: error.message };
  }
  throw error;
}

function revalidatePost(postId: number) {
  revalidatePath("/posts");
  revalidatePath("/calendar");
  revalidatePath(`/posts/${postId}`);
  revalidatePath(`/posts/${postId}/pack`);
}

// ---------------------------------------------------------------------------
// drafting (spends — owner only)
// ---------------------------------------------------------------------------

export type CreatePostActionInput = {
  accountId: number;
  ideaId?: number | null;
  topic?: string | null;
  format?: string | null;
  title?: string | null;
};

/** `/posts/new`: draft a post from an idea or a topic for one account (§5.O11.2). */
export async function createPostAction(
  input: CreatePostActionInput,
): Promise<PostActionResult<{ id: number; cost: string }>> {
  try {
    await requireOwner("write a post");
    if (!isPositiveId(input?.accountId)) return { ok: false, error: "Pick an account." };
    const ideaId = input.ideaId ?? null;
    if (ideaId !== null && !isPositiveId(ideaId)) {
      return { ok: false, error: "That is not an idea id." };
    }
    for (const field of ["topic", "format", "title"] as const) {
      const value = input[field];
      if (value != null && typeof value !== "string") {
        return { ok: false, error: `${field} must be text.` };
      }
    }
    const { post, costUsd } = await createPostFromIdea({
      accountId: input.accountId,
      ideaId,
      topic: input.topic || null,
      format: input.format || null,
      title: input.title || null,
    });
    revalidatePath("/posts");
    return { ok: true, id: post.id, cost: formatUsd(costUsd) };
  } catch (error) {
    return refusal(error);
  }
}

/** "Adapt to family" (§1.47): one sibling per other active account in the family. */
export async function adaptPostAction(postId: number): Promise<
  PostActionResult<{
    created: { id: number; accountId: number }[];
    skipped: { handle: string; reason: string }[];
    cost: string;
  }>
> {
  try {
    await requireOwner("adapt a post to its family");
    if (!isPositiveId(postId)) return { ok: false, error: "That is not a post id." };
    const result = await adaptToFamily(postId);
    revalidatePost(postId);
    return {
      ok: true,
      created: result.created.map((p) => ({ id: p.id, accountId: p.accountId })),
      skipped: result.skipped.map((s) => ({ handle: s.handle, reason: s.reason })),
      cost: formatUsd(result.costUsd),
    };
  } catch (error) {
    return refusal(error);
  }
}

// ---------------------------------------------------------------------------
// free edits
// ---------------------------------------------------------------------------

export type SavePostInput = {
  title?: string;
  /** A whole `PostDraft`; validated by the engine against the contract. */
  body?: unknown;
  notes?: string | null;
};

/** The editor's "Save": title, notes and the draft (which refreshes the caption and first comment). */
export async function savePostAction(
  postId: number,
  input: SavePostInput,
): Promise<PostActionResult> {
  await requireUser();
  if (!isPositiveId(postId)) return { ok: false, error: "That is not a post id." };
  const patch: PostPatch = {};
  if (input?.title !== undefined) {
    if (typeof input.title !== "string") return { ok: false, error: "The title must be text." };
    patch.title = input.title;
  }
  if (input?.notes !== undefined) {
    if (input.notes !== null && typeof input.notes !== "string") {
      return { ok: false, error: "Notes must be text." };
    }
    patch.notes = input.notes?.trim() ? input.notes : null;
  }
  if (input?.body !== undefined) patch.body = input.body;
  try {
    await updatePost(postId, patch);
    revalidatePost(postId);
    return { ok: true };
  } catch (error) {
    return refusal(error);
  }
}

/** A status button: the engine refuses illegal moves with the reason (`status.ts`). */
export async function setPostStatusAction(
  postId: number,
  status: PostStatus,
): Promise<PostActionResult<{ status: PostStatus }>> {
  await requireUser();
  if (!isPositiveId(postId)) return { ok: false, error: "That is not a post id." };
  if (!isPostStatus(status)) return { ok: false, error: `Unknown status "${String(status)}".` };
  try {
    const post = await setStatus(postId, status);
    revalidatePost(postId);
    return { ok: true, status: post.status };
  } catch (error) {
    return refusal(error);
  }
}

function parseWhen(value: unknown): Date | null | "invalid" {
  if (value === null) return null;
  if (typeof value !== "string" || !value.trim()) return "invalid";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "invalid" : date;
}

/**
 * Set (or clear) when a post goes out. `schedule: true` also moves it to
 * `scheduled` in the same request — the engine judges the move on the new
 * date. The calendar's drag-to-reschedule sends only the date: a scheduled
 * post stays scheduled, a draft just gets a date.
 */
export async function schedulePostAction(
  postId: number,
  when: string | null,
  options: { schedule?: boolean } = {},
): Promise<PostActionResult<{ scheduledFor: string | null; status: PostStatus }>> {
  await requireUser();
  if (!isPositiveId(postId)) return { ok: false, error: "That is not a post id." };
  const scheduledFor = parseWhen(when);
  if (scheduledFor === "invalid") return { ok: false, error: "That is not a date and time." };
  const current = await getPost(postId);
  if (!current) return { ok: false, error: `No post ${postId}.` };
  if (["published", "publishing"].includes(current.status)) {
    return { ok: false, error: `A ${current.status} post cannot be rescheduled.` };
  }
  if (scheduledFor === null && current.status === "scheduled") {
    return { ok: false, error: "Move the post back to ready before clearing its date." };
  }
  try {
    const post = await updatePost(postId, {
      scheduledFor,
      ...(options.schedule ? { status: "scheduled" as const } : {}),
    });
    revalidatePost(postId);
    return {
      ok: true,
      scheduledFor: post.scheduledFor?.toISOString() ?? null,
      status: post.status,
    };
  } catch (error) {
    return refusal(error);
  }
}

/**
 * The post pack's "Mark posted" (§1.49): the permalink, if pasted, and the
 * move to `published` in one request. Calling it again on a published post
 * only updates the permalink.
 */
export async function markPostedAction(
  postId: number,
  permalink: string | null,
): Promise<PostActionResult<{ permalink: string | null }>> {
  await requireUser();
  if (!isPositiveId(postId)) return { ok: false, error: "That is not a post id." };
  const link = typeof permalink === "string" && permalink.trim() ? permalink.trim() : null;
  if (permalink !== null && typeof permalink !== "string") {
    return { ok: false, error: "The permalink must be text." };
  }
  if (link) {
    try {
      const { protocol } = new URL(link);
      if (protocol !== "https:" && protocol !== "http:") throw new Error();
    } catch {
      return { ok: false, error: "The permalink must be an http(s) link." };
    }
  }
  try {
    const post = await updatePost(postId, {
      ...(link ? { permalink: link } : {}),
      status: "published",
    });
    revalidatePost(postId);
    return { ok: true, permalink: post.permalink };
  } catch (error) {
    return refusal(error);
  }
}

// ---------------------------------------------------------------------------
// attachments (post_assets)
// ---------------------------------------------------------------------------

async function orderedAssetIds(postId: number) {
  return db
    .select({ assetId: postAssets.assetId, role: postAssets.role })
    .from(postAssets)
    .where(eq(postAssets.postId, postId))
    .orderBy(asc(postAssets.position));
}

/**
 * Rewrite a post's attachments as 1..n in the given order. Delete + insert in
 * one transaction: (post_id, position) is the primary key, so renumbering in
 * place would collide mid-way.
 */
async function writeOrder(postId: number, rows: { assetId: number; role: PostAssetRole }[]) {
  await db.transaction(async (tx) => {
    await tx.delete(postAssets).where(eq(postAssets.postId, postId));
    if (rows.length) {
      await tx
        .insert(postAssets)
        .values(
          rows.map((r, i) => ({ postId, assetId: r.assetId, role: r.role, position: i + 1 })),
        );
    }
  });
}

/** Attach a library file to the end of a post. The same file twice is refused. */
export async function attachAssetAction(
  postId: number,
  assetId: number,
  role: PostAssetRole = "slide",
): Promise<PostActionResult<{ position: number }>> {
  await requireUser();
  if (!isPositiveId(postId) || !isPositiveId(assetId)) {
    return { ok: false, error: "That is not a post or asset id." };
  }
  if (!(POST_ASSET_ROLES as readonly string[]).includes(role)) {
    return { ok: false, error: `Unknown role "${String(role)}".` };
  }
  const [post, asset] = await Promise.all([getPost(postId), getAsset(assetId)]);
  if (!post) return { ok: false, error: `No post ${postId}.` };
  if (!asset) return { ok: false, error: `No asset ${assetId}.` };
  if (asset.brandId && asset.brandId !== post.brandId) {
    return { ok: false, error: "That file belongs to another brand." };
  }
  const [dupe] = await db
    .select({ position: postAssets.position })
    .from(postAssets)
    .where(and(eq(postAssets.postId, postId), eq(postAssets.assetId, assetId)))
    .limit(1);
  if (dupe) return { ok: false, error: "That file is already attached." };
  const [{ last }] = await db
    .select({ last: max(postAssets.position) })
    .from(postAssets)
    .where(eq(postAssets.postId, postId));
  const position = (last ?? 0) + 1;
  await db.insert(postAssets).values({ postId, assetId, position, role });
  revalidatePost(postId);
  return { ok: true, position };
}

/** Put a post's attachments in this order; `assetIds` must be exactly the attached files. */
export async function reorderAssetsAction(
  postId: number,
  assetIds: number[],
): Promise<PostActionResult> {
  await requireUser();
  if (!isPositiveId(postId)) return { ok: false, error: "That is not a post id." };
  if (!Array.isArray(assetIds) || !assetIds.every(isPositiveId)) {
    return { ok: false, error: "Send the attached files' ids in their new order." };
  }
  const current = await orderedAssetIds(postId);
  const role = new Map(current.map((r) => [r.assetId, r.role]));
  const same =
    assetIds.length === current.length &&
    new Set(assetIds).size === assetIds.length &&
    assetIds.every((id) => role.has(id));
  if (!same) {
    return { ok: false, error: "The attachments changed since the page loaded; reload and retry." };
  }
  await writeOrder(
    postId,
    assetIds.map((assetId) => ({ assetId, role: role.get(assetId)! })),
  );
  revalidatePost(postId);
  return { ok: true };
}

/** Change what an attached file is for (slide, cover, clip…). */
export async function setAssetRoleAction(
  postId: number,
  assetId: number,
  role: PostAssetRole,
): Promise<PostActionResult> {
  await requireUser();
  if (!isPositiveId(postId) || !isPositiveId(assetId)) {
    return { ok: false, error: "That is not a post or asset id." };
  }
  if (!(POST_ASSET_ROLES as readonly string[]).includes(role)) {
    return { ok: false, error: `Unknown role "${String(role)}".` };
  }
  const updated = await db
    .update(postAssets)
    .set({ role })
    .where(and(eq(postAssets.postId, postId), eq(postAssets.assetId, assetId)))
    .returning({ position: postAssets.position });
  if (!updated.length) return { ok: false, error: "That file is not attached." };
  revalidatePost(postId);
  return { ok: true };
}

/** Detach a file; the rest close ranks so positions stay 1..n. The asset itself stays in the library. */
export async function detachAssetAction(
  postId: number,
  assetId: number,
): Promise<PostActionResult> {
  await requireUser();
  if (!isPositiveId(postId) || !isPositiveId(assetId)) {
    return { ok: false, error: "That is not a post or asset id." };
  }
  const current = await orderedAssetIds(postId);
  if (!current.some((r) => r.assetId === assetId)) {
    return { ok: false, error: "That file is not attached." };
  }
  await writeOrder(
    postId,
    current.filter((r) => r.assetId !== assetId),
  );
  revalidatePost(postId);
  return { ok: true };
}
