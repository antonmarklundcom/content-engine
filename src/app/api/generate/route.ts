import { NextResponse } from "next/server";
import { db, schema } from "../../../db";
import { BRANDS } from "../../../lib/brands";
import { generateContentPlan } from "../../../lib/anthropic";

export const maxDuration = 300; // research + generation can take a couple minutes

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const brandId = body.brandId as string | undefined;
  if (!brandId) {
    return NextResponse.json({ error: "brandId required" }, { status: 400 });
  }

  const brand = BRANDS.find((b) => b.id === brandId);
  if (!brand) {
    return NextResponse.json({ error: `unknown brandId "${brandId}"` }, { status: 400 });
  }

  // Existing research relevant to this brand — check before asking Claude to
  // research from scratch.
  const allNotes = await db.select().from(schema.researchNotes);
  const existingResearch = allNotes
    .filter((n) => n.relatedBrandIds.includes(brandId))
    .map((n) => ({ topic: n.topic, summary: n.summary }));

  const plan = await generateContentPlan(brand, BRANDS, existingResearch);

  // Persist any new shared research notes.
  const insertedNoteIds: number[] = [];
  for (const note of plan.researchNotes) {
    const [inserted] = await db
      .insert(schema.researchNotes)
      .values({
        topic: note.topic,
        summary: note.summary,
        market: brand.market,
        relatedBrandIds: note.relatedBrandIds.length ? note.relatedBrandIds : [brandId],
        sources: note.sources,
      })
      .returning({ id: schema.researchNotes.id });
    insertedNoteIds.push(inserted.id);
  }

  // Persist ideas.
  const insertedIdeas = await db
    .insert(schema.ideas)
    .values(
      plan.ideas.map((idea) => ({
        brandId,
        title: idea.title,
        angle: idea.angle,
        format: idea.format,
        platform: idea.platform,
        draftCopy: idea.draftCopy,
        visualNotes: idea.visualNotes,
        citations: idea.citations,
        researchNoteId: insertedNoteIds[0], // best-effort link to this run's research, if any
        status: "proposed" as const,
      })),
    )
    .returning();

  return NextResponse.json({ ideas: insertedIdeas, researchNotesAdded: insertedNoteIds.length });
}
