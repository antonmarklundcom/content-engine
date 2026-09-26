import "server-only";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { facts, scripts, type Fact } from "@/db/schema";
import { scriptsNeedingCorrection, type ScriptNeedingCorrection } from "@/lib/studio/staleness";

/**
 * Fact sheets (build 2b, idea 3): checked claims per brand, grouped by topic,
 * each with its source and the date someone last checked it. Scripts are given
 * them (`scripts/brief.ts`), and a fact whose claim or source changes after a
 * script went out flags that script (`studio/staleness.ts`).
 *
 * `updatedAt` means "the fact itself changed" — it is what the out-of-date
 * check compares — so only a new claim or a new source bumps it. Re-filing a
 * fact under another topic, editing its notes or marking it checked do not:
 * none of those changes what a video said.
 */

export class InvalidFactError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidFactError";
  }
}

export type FactInput = {
  topic: string;
  claim: string;
  sourceUrl?: string | null;
  notes?: string | null;
};

type CleanFact = { topic: string; claim: string; sourceUrl: string | null; notes: string | null };

function clean(input: FactInput): CleanFact {
  const topic = input.topic.trim();
  const claim = input.claim.trim();
  if (!topic) throw new InvalidFactError("A fact needs a topic.");
  if (!claim) throw new InvalidFactError("A fact needs a claim.");
  const sourceUrl = input.sourceUrl?.trim() || null;
  if (sourceUrl) {
    if (sourceUrl.length > 1024)
      throw new InvalidFactError("The source URL is longer than 1024 characters.");
    let protocol = "";
    try {
      protocol = new URL(sourceUrl).protocol;
    } catch {
      // falls through to the error below
    }
    if (protocol !== "https:" && protocol !== "http:") {
      throw new InvalidFactError("The source must be an http(s) URL.");
    }
  }
  return { topic, claim, sourceUrl, notes: input.notes?.trim() || null };
}

/** Add a fact to a brand's sheet, checked as of now. */
export async function createFact(brandId: string, input: FactInput): Promise<Fact> {
  const [row] = await db
    .insert(facts)
    .values({ brandId, ...clean(input) })
    .returning();
  if (!row) throw new Error("Insert into facts returned no row");
  return row;
}

export async function getFact(id: number): Promise<Fact | null> {
  const [row] = await db.select().from(facts).where(eq(facts.id, id)).limit(1);
  return row ?? null;
}

/**
 * Edit a fact; null if it does not exist. `updatedAt` moves only when the
 * claim or the source URL actually changed (see the module comment).
 */
export async function updateFact(id: number, input: FactInput): Promise<Fact | null> {
  const next = clean(input);
  const current = await getFact(id);
  if (!current) return null;
  const changed = current.claim !== next.claim || (current.sourceUrl ?? null) !== next.sourceUrl;
  const [row] = await db
    .update(facts)
    .set({ ...next, ...(changed ? { updatedAt: sql`now()` } : {}) })
    .where(eq(facts.id, id))
    .returning();
  return row ?? null;
}

/** "Checked today": the claim still holds as of `at`. Does not touch `updatedAt`. */
export async function markFactChecked(id: number, at?: Date): Promise<Fact | null> {
  const [row] = await db
    .update(facts)
    .set({ lastCheckedAt: at ?? sql`now()` })
    .where(eq(facts.id, id))
    .returning();
  return row ?? null;
}

/** Remove a fact; true if it existed. */
export async function deleteFact(id: number): Promise<boolean> {
  const rows = await db.delete(facts).where(eq(facts.id, id)).returning({ id: facts.id });
  return rows.length > 0;
}

/** A brand's whole sheet, by topic, then oldest first within a topic. */
export async function listFacts(brandId: string): Promise<Fact[]> {
  return db
    .select()
    .from(facts)
    .where(eq(facts.brandId, brandId))
    .orderBy(asc(facts.topic), asc(facts.createdAt), asc(facts.id));
}

/** `listFacts`, grouped by topic in topic order. */
export async function listFactsByTopic(
  brandId: string,
): Promise<Array<{ topic: string; facts: Fact[] }>> {
  const groups: Array<{ topic: string; facts: Fact[] }> = [];
  for (const fact of await listFacts(brandId)) {
    const last = groups.at(-1);
    if (last && last.topic === fact.topic) last.facts.push(fact);
    else groups.push({ topic: fact.topic, facts: [fact] });
  }
  return groups;
}

/**
 * The brand's posted scripts that cite a fact's source which changed after
 * they were posted. Two reads (the posted scripts' source URLs, the brand's
 * sourced facts), then the pure rule.
 */
export async function brandScriptsNeedingCorrection(
  brandId: string,
): Promise<ScriptNeedingCorrection[]> {
  const [posted, sheet] = await Promise.all([
    db
      .select({
        id: scripts.id,
        title: scripts.title,
        status: scripts.status,
        postedAt: scripts.postedAt,
        // Only the URLs travel, not the whole body.
        sourceUrls: sql<string[]>`coalesce(
          (select array_agg(s->>'url') from jsonb_array_elements(
            case when jsonb_typeof(${scripts.body}->'sources') = 'array' then ${scripts.body}->'sources' else '[]'::jsonb end
          ) s where s->>'url' is not null),
          '{}'::text[]
        )`,
      })
      .from(scripts)
      .where(and(eq(scripts.brandId, brandId), eq(scripts.status, "posted")))
      .orderBy(desc(scripts.postedAt)),
    db
      .select({
        id: facts.id,
        claim: facts.claim,
        sourceUrl: facts.sourceUrl,
        updatedAt: facts.updatedAt,
      })
      .from(facts)
      .where(and(eq(facts.brandId, brandId), sql`${facts.sourceUrl} is not null`)),
  ]);
  return scriptsNeedingCorrection(posted, sheet);
}
