import { NextResponse } from "next/server";
import { db, schema } from "../../../../db";
import { eq, sql, type SQL } from "drizzle-orm";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ideaId = Number(id);
  if (!Number.isInteger(ideaId)) {
    return NextResponse.json({ error: "invalid idea id" }, { status: 400 });
  }

  const body = await request.json();
  const update: Partial<typeof schema.ideas.$inferInsert> = {};
  let postedAt: SQL | null | undefined;

  if (body.status !== undefined) {
    if (!schema.IDEA_STATUSES.includes(body.status)) {
      return NextResponse.json({ error: `status must be one of ${schema.IDEA_STATUSES.join(", ")}` }, { status: 400 });
    }
    update.status = body.status;
    // posted_at describes the current status (PLAN.md §1.23): stamped on the
    // way into `posted`, cleared on the way out. Re-sending `posted` for an
    // idea already posted keeps the original stamp — decided in the UPDATE
    // itself, against the row's own status, so there is no read to race.
    postedAt =
      body.status === "posted"
        ? sql`case when ${schema.ideas.status} = 'posted' then ${schema.ideas.postedAt} else now() end`
        : null;
  }
  if (typeof body.draftCopy === "string") update.draftCopy = body.draftCopy;
  if (typeof body.title === "string") update.title = body.title;
  if (typeof body.angle === "string") update.angle = body.angle;

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }

  const set = postedAt === undefined ? update : { ...update, postedAt };
  const [row] = await db.update(schema.ideas).set(set).where(eq(schema.ideas.id, ideaId)).returning();
  if (!row) {
    return NextResponse.json({ error: "idea not found" }, { status: 404 });
  }
  return NextResponse.json(row);
}
