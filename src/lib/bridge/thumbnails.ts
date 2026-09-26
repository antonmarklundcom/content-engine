import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { scripts, type Script } from "@/db/schema";

/**
 * The thumbnail Anton picked for a script (build 2b, idea 10): a path under
 * `media/<id>/thumbnails/`, or null to clear it. The caller checks the file
 * exists; this only writes the column. Null if the script does not exist.
 */
export async function setScriptThumbnail(id: number, file: string | null): Promise<Script | null> {
  const [row] = await db
    .update(scripts)
    .set({ thumbnailFile: file, updatedAt: sql`now()` })
    .where(eq(scripts.id, id))
    .returning();
  return row ?? null;
}
