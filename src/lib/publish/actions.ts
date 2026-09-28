"use server";

import { revalidatePath } from "next/cache";

import { ForbiddenError } from "@/lib/auth/roles";
import { requireOwner } from "@/lib/auth/session";

import { publishPost, type PublishOutcome } from "./index";

/**
 * "Publish now" (PLAN.md §5.O13): the owner's explicit click. Publishing is
 * external and irreversible, so it is owner-only (§1.20) and goes through the
 * same per-post lease as the due run.
 */
export async function publishNowAction(
  postId: number,
): Promise<{ ok: true; outcome: PublishOutcome } | { ok: false; error: string }> {
  if (!Number.isInteger(postId) || postId <= 0)
    return { ok: false, error: "That is not a post id." };
  try {
    await requireOwner("publish a post");
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: "Only the owner can publish." };
    throw err;
  }
  const outcome = await publishPost(postId, { trigger: "manual" });
  revalidatePath("/posts");
  revalidatePath("/calendar");
  revalidatePath(`/posts/${postId}`);
  return { ok: true, outcome };
}
