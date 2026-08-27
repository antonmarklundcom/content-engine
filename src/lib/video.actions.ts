"use server";

/** Per-video mutations from the UI: read state, pinning, and deletion. */

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { analyses, outlines, transcripts, videoReads, videos } from "@/db/schema";
import { requireOwner, requireUser } from "@/lib/auth/session";

/**
 * Pinning is the counterweight to an unbounded feed: the corpus only grows, and
 * without it the videos worth returning to sink below the fold within a week.
 */
export async function setVideoPinned(videoId: number, pinned: boolean): Promise<void> {
  // Per-user since PR-25: pinning is one reader's shortlist, not a property of
  // the video. The upsert is needed because pinning can precede reading.
  const user = await requireUser();
  await db
    .insert(videoReads)
    .values({ videoId, userId: user.id, pinned })
    .onConflictDoUpdate({
      target: [videoReads.videoId, videoReads.userId],
      set: { pinned },
    });
  revalidatePath("/youtube");
  revalidatePath(`/youtube/video/${videoId}`);
}

/** Explicit unread, so a video opened by accident can be put back in the queue. */
export async function setVideoUnread(videoId: number): Promise<void> {
  const user = await requireUser();
  // An UPDATE, not an upsert: with no row the video is already unread, and
  // inserting one would only record that fact more expensively.
  await db
    .update(videoReads)
    .set({ readAt: null })
    .where(and(eq(videoReads.videoId, videoId), eq(videoReads.userId, user.id)));
  revalidatePath("/youtube");
  revalidatePath(`/youtube/video/${videoId}`);
}

/**
 * Delete a video and everything derived from it, in one transaction (PR-31).
 *
 * Still ordered children-first inside the transaction. Outlines hang off
 * analyses rather than off the video, so their ids are collected before the
 * analyses rows go — the ordering is what makes the statements expressible at
 * all, the transaction is what makes them atomic.
 */
export async function deleteVideo(videoId: number): Promise<void> {
  // Reading, pinning and marking unread are free and stay open to an employee.
  // Deleting destroys analyses the owner paid for, so it does not.
  await requireOwner("delete a video");

  await db.transaction(async (tx) => {
    const analysisRows = await tx
      .select({ id: analyses.id })
      .from(analyses)
      .where(eq(analyses.videoId, videoId));
    const analysisIds = analysisRows.map((row) => row.id);

    if (analysisIds.length > 0) {
      await tx.delete(outlines).where(inArray(outlines.analysisId, analysisIds));
    }
    await tx.delete(analyses).where(eq(analyses.videoId, videoId));
    await tx.delete(transcripts).where(eq(transcripts.videoId, videoId));
    await tx.delete(videoReads).where(eq(videoReads.videoId, videoId));
    await tx.delete(videos).where(eq(videos.id, videoId));
  });

  revalidatePath("/youtube");
  // Outside the transaction on purpose: redirect() throws a control-flow error
  // that Next catches, and throwing it inside the callback would roll back a
  // delete that had already succeeded.
  redirect("/youtube");
}
