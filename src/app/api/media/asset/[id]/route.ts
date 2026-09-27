import { getAsset } from "@/lib/bridge/assets";
import { notFound, ownerOnly, serveMediaFile } from "@/lib/media/serve";

/**
 * GET /api/media/asset/<id> — a media library file by asset id (PLAN.md
 * §5.O10.5). Owner-only; a 404 for an unknown id, an asset with no file on the
 * drive, or a path that no longer resolves inside `MEDIA_ROOT`; a 503 with
 * `code: "missing"` while the media drive is not connected.
 *
 * Build 2's `/api/media/<script id>/<…>` paths are a separate route and keep
 * working: a script id is a number, never the literal `asset`.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await ownerOnly();
  if (denied) return denied;

  const { id } = await context.params;
  if (!/^\d{1,9}$/.test(id)) return notFound();
  const asset = await getAsset(Number(id));
  if (!asset?.localPath) return notFound();
  return serveMediaFile(request, asset.localPath, asset.mime);
}
