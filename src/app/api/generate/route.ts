import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, schema } from "@/db";
import { generateContentPlan } from "@/lib/ai";
import { isOwner } from "@/lib/auth/roles";
import { getSession } from "@/lib/auth/session";
import { getAnalysisWithVideo, getBrand, listBrands } from "@/lib/bridge";
import { SpendCapExceededError } from "@/lib/spend";

export const maxDuration = 300; // research + generation can take a couple minutes

export async function POST(request: Request) {
  // Spend is owner-only, everywhere (PLAN.md §1.20): this is the app's most
  // expensive call. Same statuses and body shape as promote's `adapt` gate.
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!isOwner(user)) {
    return NextResponse.json(
      { error: "Generating ideas spends money, which is the owner's to spend." },
      { status: 403 },
    );
  }

  const body = await request.json().catch(() => ({}));
  const brandId = body.brandId as string | undefined;
  if (!brandId) {
    return NextResponse.json({ error: "brandId required" }, { status: 400 });
  }

  // The brands table is the source of truth (PLAN.md §1.5) — an unknown id is
  // now "no such row", not "not in a constant someone forgot to redeploy".
  const brand = await getBrand(brandId);
  if (!brand) {
    return NextResponse.json({ error: `unknown brandId "${brandId}"` }, { status: 400 });
  }
  const allBrands = await listBrands();

  // Optional grounding: generate from a video this portfolio already analysed
  // rather than from a cold web search (PLAN.md §5.O2.4). Ideas produced this
  // way carry `source_analysis_id`, so where they came from survives.
  const analysisId = body.analysisId === undefined ? null : Number(body.analysisId);
  if (analysisId !== null && (!Number.isInteger(analysisId) || analysisId <= 0)) {
    return NextResponse.json({ error: "analysisId must be an analysis id" }, { status: 400 });
  }

  let grounding = null;
  if (analysisId !== null) {
    const found = await getAnalysisWithVideo(analysisId);
    if (!found) {
      return NextResponse.json({ error: `unknown analysisId ${analysisId}` }, { status: 404 });
    }
    grounding = {
      videoTitle: found.video?.title ?? "an analysed video",
      channelTitle: found.video?.channelTitle,
      summary: found.analysis.summary,
      takeaways: found.analysis.takeaways,
      topics: found.analysis.topics,
      ideas: found.analysis.ideas,
    };
  }

  // Existing research relevant to this brand — check before asking the model
  // to research from scratch. Filtered in SQL with a jsonb containment rather
  // than loading every note: the table grows with every run of every brand.
  // (The column is `json`, hence the cast.)
  const existingResearch = await db
    .select({ topic: schema.researchNotes.topic, summary: schema.researchNotes.summary })
    .from(schema.researchNotes)
    .where(
      sql`${schema.researchNotes.relatedBrandIds}::jsonb @> ${JSON.stringify([brandId])}::jsonb`,
    );

  let plan;
  try {
    plan = await generateContentPlan(brand, allBrands, existingResearch, grounding);
  } catch (error) {
    // The one failure worth its own status code: nothing was spent, nothing is
    // broken, and the caller's next move is to raise the cap or wait — which a
    // 500 would not tell them (PLAN.md §1.10).
    if (error instanceof SpendCapExceededError) {
      return NextResponse.json(
        { error: error.message, spend: error.status },
        { status: 429 },
      );
    }
    throw error;
  }

  // Persist any new shared research notes. An idea links to one only when the
  // model itself tagged that note with this brand: a note it filed under other
  // brands is research this run happened to produce, not what the ideas were
  // spun from, and "the first note of the run" linked ideas to unrelated
  // research. No such note → null, which is honest.
  const insertedNoteIds: number[] = [];
  let researchNoteId: number | null = null;
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
    if (researchNoteId === null && note.relatedBrandIds.includes(brandId)) {
      researchNoteId = inserted.id;
    }
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
        researchNoteId,
        sourceAnalysisId: analysisId,
        status: "proposed" as const,
      })),
    )
    .returning();

  return NextResponse.json({
    ideas: insertedIdeas,
    researchNotesAdded: insertedNoteIds.length,
    costUsd: plan.costUsd,
  });
}
