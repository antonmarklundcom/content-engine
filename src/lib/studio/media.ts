import { lstat, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";

/**
 * The `media/` folder (PLAN.md §1.34): what Claude Code saved from Higgsfield,
 * next to the repo, never in git. The app only reads it — to show thumbnails
 * and serve them to the owner through `/api/media/[...path]`.
 *
 * Every read goes through `resolveMediaFile`, which is the whole security
 * boundary: a request path is segments, never a string joined blindly, and the
 * final file's real path (symlinks followed) must still be inside the real
 * media root.
 */

/** `MEDIA_ROOT` (tests, or a media folder elsewhere on the PC), else `<repo>/media`. */
export function mediaRoot(): string {
  return path.resolve(process.env.MEDIA_ROOT || path.join(process.cwd(), "media"));
}

/** One path segment a URL may carry: a plain name, nothing that climbs, roots or separates. */
export function isSafeSegment(segment: string): boolean {
  if (!segment || segment === "." || segment === "..") return false;
  if (/[/\\\0]/.test(segment)) return false;
  if (/^[a-zA-Z]:/.test(segment)) return false; // a Windows drive
  return true;
}

function inside(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/**
 * The absolute path of a regular file under the media root, or null — for a
 * bad segment, a path that leaves the root, a symlink (anywhere along the way)
 * that resolves outside it, a directory, or a file that does not exist.
 */
export async function resolveMediaFile(segments: string[]): Promise<string | null> {
  if (!segments.length || !segments.every(isSafeSegment)) return null;
  const root = mediaRoot();
  const candidate = path.resolve(root, ...segments);
  if (!inside(root, candidate)) return null;
  try {
    const [realRoot, realFile] = await Promise.all([realpath(root), realpath(candidate)]);
    if (!inside(realRoot, realFile)) return null;
    const info = await stat(realFile);
    return info.isFile() ? realFile : null;
  } catch {
    return null;
  }
}

const TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".json": "application/json",
};

/** The media type to serve a file as; null for anything not an image, a video or a manifest. */
export function mediaContentType(file: string): string | null {
  return TYPES[path.extname(file).toLowerCase()] ?? null;
}

const IMAGE = /\.(png|jpe?g|webp|gif)$/i;

/** Where a script's thumbnails are saved, relative to the repo (as `scripts.thumbnail_file` stores it). */
export function thumbnailDir(scriptId: number): string {
  return `media/${scriptId}/thumbnails`;
}

/**
 * The image files in `media/<id>/thumbnails/`, in natural order (`1.png`,
 * `1-2.png`, `2.png`, … `10.png`). Symlinks and anything not an image are
 * left out; a missing folder is an empty list.
 */
export async function listThumbnails(scriptId: number): Promise<string[]> {
  if (!Number.isInteger(scriptId) || scriptId <= 0) return [];
  const dir = path.join(mediaRoot(), String(scriptId), "thumbnails");
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const name of names) {
    if (!IMAGE.test(name) || !isSafeSegment(name)) continue;
    const info = await lstat(path.join(dir, name)).catch(() => null);
    if (info?.isFile()) files.push(name);
  }
  // Compared without the extension, so "1.png" (the first variant) sorts before "1-2.png".
  const stem = (name: string) => name.slice(0, name.length - path.extname(name).length);
  return files.sort((a, b) => stem(a).localeCompare(stem(b), "en", { numeric: true }) || a.localeCompare(b));
}
