import { constants } from "node:fs";
import { copyFile, mkdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { failure, type StorageDriver } from "./driver";
import {
  inside,
  mediaRoot,
  mediaRootMessage,
  mediaRootStatus,
  resolveMediaFile,
  splitRelative,
} from "./root";

/**
 * The primary tier (PLAN.md §1.41): files on the disk under `MEDIA_ROOT`.
 * Keys are paths relative to the root, forward slashes — what
 * `assets.local_path` stores. A root that is not there answers `missing`
 * rather than throwing.
 */
export function localDriver(root: string = mediaRoot()): StorageDriver {
  /** The absolute target for a write, or null when the key is unsafe or climbs out. */
  async function target(key: string): Promise<string | null> {
    const segments = splitRelative(key);
    if (!segments) return null;
    const candidate = path.resolve(root, ...segments);
    if (!inside(root, candidate)) return null;
    // The parent folders may exist already as symlinks; the real parent must still be inside.
    const parent = path.dirname(candidate);
    await mkdir(parent, { recursive: true });
    const [realRoot, realParent] = await Promise.all([realpath(root), realpath(parent)]);
    if (realParent !== realRoot && !inside(realRoot, realParent)) return null;
    return candidate;
  }

  async function notReady() {
    const status = await mediaRootStatus(root);
    return status === "ok"
      ? null
      : failure(status === "missing" ? "missing" : "unwritable", mediaRootMessage(status));
  }

  return {
    name: "local",

    async put(key, data, options = {}) {
      const down = await notReady();
      if (down) return down;
      try {
        const file = await target(key);
        if (!file) return failure("rejected", `Unsafe media path: ${key}`);
        const flag = options.overwrite ? "w" : "wx";
        let bytes: number;
        if (Buffer.isBuffer(data)) {
          await writeFile(file, data, { flag });
          bytes = data.length;
        } else {
          await copyFile(data.file, file, options.overwrite ? 0 : constants.COPYFILE_EXCL);
          bytes = (await stat(file)).size;
        }
        return { ok: true, key: splitRelative(key)!.join("/"), bytes };
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "EEXIST") return failure("rejected", `A file already exists at ${key}.`);
        if (code === "EACCES" || code === "EPERM" || code === "EROFS") {
          return failure("unwritable", mediaRootMessage("unwritable"));
        }
        return failure("error", (error as Error).message);
      }
    },

    async get(key) {
      const down = await notReady();
      if (down?.reason === "missing") return down;
      const segments = splitRelative(key);
      if (!segments) return failure("rejected", `Unsafe media path: ${key}`);
      const file = await resolveMediaFile(segments, root);
      if (!file) return failure("not_found", `No file at ${key}.`);
      try {
        return { ok: true, data: await readFile(file) };
      } catch (error) {
        return failure("error", (error as Error).message);
      }
    },

    async exists(key) {
      const down = await notReady();
      if (down?.reason === "missing") return down;
      const segments = splitRelative(key);
      if (!segments) return failure("rejected", `Unsafe media path: ${key}`);
      return { ok: true, exists: (await resolveMediaFile(segments, root)) !== null };
    },

    async remove(key) {
      const down = await notReady();
      if (down) return down;
      const segments = splitRelative(key);
      if (!segments) return failure("rejected", `Unsafe media path: ${key}`);
      const file = await resolveMediaFile(segments, root);
      if (!file) return { ok: true, removed: false };
      try {
        await rm(file);
        return { ok: true, removed: true };
      } catch (error) {
        return failure("error", (error as Error).message);
      }
    },
  };
}
