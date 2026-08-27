import { NextResponse } from "next/server";
import { db, schema } from "../../../db";
import { eq, desc } from "drizzle-orm";

export async function GET(request: Request) {
  const brandId = new URL(request.url).searchParams.get("brandId");
  if (!brandId) {
    return NextResponse.json({ error: "brandId query param required" }, { status: 400 });
  }
  const rows = await db
    .select()
    .from(schema.ideas)
    .where(eq(schema.ideas.brandId, brandId))
    .orderBy(desc(schema.ideas.createdAt));
  return NextResponse.json(rows);
}
