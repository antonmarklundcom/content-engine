import { NextResponse } from "next/server";
import { db, schema } from "../../../../db";
import { eq } from "drizzle-orm";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ideaId = Number(id);
  if (!Number.isInteger(ideaId)) {
    return NextResponse.json({ error: "invalid idea id" }, { status: 400 });
  }

  const body = await request.json();
  const update: Partial<typeof schema.ideas.$inferInsert> = {};

  if (body.status !== undefined) {
    if (!schema.IDEA_STATUSES.includes(body.status)) {
      return NextResponse.json({ error: `status must be one of ${schema.IDEA_STATUSES.join(", ")}` }, { status: 400 });
    }
    update.status = body.status;
  }
  if (typeof body.draftCopy === "string") update.draftCopy = body.draftCopy;
  if (typeof body.title === "string") update.title = body.title;
  if (typeof body.angle === "string") update.angle = body.angle;

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }

  const [row] = await db.update(schema.ideas).set(update).where(eq(schema.ideas.id, ideaId)).returning();
  if (!row) {
    return NextResponse.json({ error: "idea not found" }, { status: 404 });
  }
  return NextResponse.json(row);
}
