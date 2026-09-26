import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";

import { isOwner } from "@/lib/auth/roles";
import { getSession } from "@/lib/auth/session";
import { mediaContentType, resolveMediaFile } from "@/lib/studio/media";

/**
 * GET /api/media/<script id>/<…> — a file Claude Code saved under `media/`
 * (build 2b, idea 10), so the studio can show generated thumbnails.
 *
 * Owner-only: these are unpublished assets. Only files under the media root
 * are served — `..`, absolute or drive paths, separators inside a segment and
 * symlinks that resolve outside the root are all a 404, the same answer as a
 * missing file, so the route says nothing about what exists elsewhere. Only
 * images, videos and manifests; anything else is a 404 too.
 */
export async function GET(_request: Request, context: { params: Promise<{ path?: string[] }> }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!isOwner(user)) return NextResponse.json({ error: "Media files are the owner's." }, { status: 403 });

  const segments = (await context.params).path ?? [];
  const file = await resolveMediaFile(segments);
  const type = file ? mediaContentType(file) : null;
  if (!file || !type) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { size } = await stat(file);
  const body = Readable.toWeb(createReadStream(file)) as ReadableStream<Uint8Array>;
  return new NextResponse(body, {
    headers: {
      "content-type": type,
      "content-length": String(size),
      "cache-control": "private, no-cache",
      "x-content-type-options": "nosniff",
    },
  });
}
