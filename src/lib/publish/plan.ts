import type { AssetKind, PostAssetRole, PostFormat, SocialPlatform } from "@/db/schema";

/**
 * What one post becomes on one platform (PLAN.md §5.O13), decided before any
 * file is copied or any Graph call made. Pure, so every format × platform rule
 * is unit-tested and a post that cannot be published fails with a sentence
 * the owner can act on, not with Meta's error code.
 */

export type PlanAsset = {
  assetId: number;
  kind: AssetKind;
  role: PostAssetRole;
  position: number;
  name: string;
  altText: string | null;
};

export type PublishPlan =
  | { platform: "instagram"; kind: "image"; media: [PlanAsset] }
  | { platform: "instagram"; kind: "carousel"; media: PlanAsset[] }
  | { platform: "instagram"; kind: "reel"; media: [PlanAsset]; cover: PlanAsset | null }
  | { platform: "facebook"; kind: "photo"; media: [PlanAsset] }
  | { platform: "facebook"; kind: "album"; media: PlanAsset[] }
  | { platform: "facebook"; kind: "video"; media: [PlanAsset] }
  | { platform: "facebook"; kind: "text"; media: [] };

export type PlanResult = { ok: true; plan: PublishPlan } | { ok: false; error: string };

/** Instagram's caption ceiling. */
export const IG_CAPTION_MAX = 2200;
export const IG_HASHTAG_MAX = 30;
export const CAROUSEL_MIN = 2;
export const CAROUSEL_MAX = 10;

export const PUBLISHABLE_PLATFORMS: readonly SocialPlatform[] = ["instagram", "facebook"];

const fail = (error: string): PlanResult => ({ ok: false, error });

export function planPublish(input: {
  platform: SocialPlatform;
  format: PostFormat;
  caption: string;
  assets: PlanAsset[];
}): PlanResult {
  const { format, caption } = input;
  if (!PUBLISHABLE_PLATFORMS.includes(input.platform)) {
    return fail(
      `Publishing to ${input.platform} is not built yet; post it by hand with the post pack.`,
    );
  }
  const platform = input.platform as "instagram" | "facebook";
  const sorted = [...input.assets].sort((a, b) => a.position - b.position);
  // Slides and clips are what goes out; a cover is the reel's cover, or the
  // image of a single-image post that has nothing else.
  const body = sorted.filter((a) => a.role === "slide" || a.role === "clip");
  const cover = sorted.find((a) => a.role === "cover" && a.kind === "image") ?? null;
  const media = body.filter((a) => a.kind === "image" || a.kind === "video");

  if (platform === "instagram") {
    if (caption.length > IG_CAPTION_MAX) {
      return fail(
        `The caption is ${caption.length} characters; Instagram allows ${IG_CAPTION_MAX}.`,
      );
    }
    const tags = caption.match(/(^|\s)#[^\s#]+/g)?.length ?? 0;
    if (tags > IG_HASHTAG_MAX) {
      return fail(`The caption has ${tags} hashtags; Instagram allows ${IG_HASHTAG_MAX}.`);
    }
  }

  switch (format) {
    case "image_post": {
      const images = media.length ? media : cover ? [cover] : [];
      if (images.length !== 1 || images[0].kind !== "image") {
        return fail(
          `An image post needs exactly one image attached (it has ${describe(images)}). ` +
            "Use the carousel format for several.",
        );
      }
      const image: [PlanAsset] = [images[0]];
      return platform === "instagram"
        ? { ok: true, plan: { platform, kind: "image", media: image } }
        : { ok: true, plan: { platform, kind: "photo", media: image } };
    }
    case "carousel": {
      if (media.length < CAROUSEL_MIN || media.length > CAROUSEL_MAX) {
        return fail(
          `A carousel needs ${CAROUSEL_MIN}–${CAROUSEL_MAX} slides attached (it has ${describe(media)}).`,
        );
      }
      if (platform === "facebook") {
        if (media.some((m) => m.kind !== "image")) {
          return fail(
            "A Facebook Page album takes images only; remove the video slides or post it by hand.",
          );
        }
        return { ok: true, plan: { platform, kind: "album", media } };
      }
      return { ok: true, plan: { platform, kind: "carousel", media } };
    }
    case "reel":
    case "video": {
      const videos = media.filter((m) => m.kind === "video");
      if (videos.length !== 1) {
        return fail(`A ${format} needs exactly one video attached (it has ${describe(media)}).`);
      }
      const video = videos[0];
      return platform === "instagram"
        ? { ok: true, plan: { platform, kind: "reel", media: [video], cover } }
        : { ok: true, plan: { platform, kind: "video", media: [video] } };
    }
    case "text":
      if (platform === "facebook") {
        if (!caption.trim()) return fail("A text post needs a caption.");
        return { ok: true, plan: { platform, kind: "text", media: [] } };
      }
      return fail("Instagram has no text-only posts; choose an image, carousel or reel.");
    case "story":
      return fail(
        "Stories are not published automatically yet; post it by hand with the post pack.",
      );
  }
}

function describe(list: PlanAsset[]): string {
  if (!list.length) return "none";
  const images = list.filter((a) => a.kind === "image").length;
  const videos = list.filter((a) => a.kind === "video").length;
  const parts = [images && `${images} image(s)`, videos && `${videos} video(s)`].filter(Boolean);
  return parts.join(" and ") || `${list.length} file(s) of another kind`;
}

/** Every asset the plan needs a public URL for, in order. */
export function planAssets(plan: PublishPlan): PlanAsset[] {
  return plan.kind === "reel" && plan.cover ? [...plan.media, plan.cover] : [...plan.media];
}

// --- retry backoff ----------------------------------------------------------

/** Automatic attempts for a scheduled post before it stays failed. */
export const MAX_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 5 * 60 * 1000;

/** A temporary failure's `publish_error` starts with this; only those are retried by the due run. */
export const TEMPORARY_PREFIX = "Temporary: ";

/** 5, 10, 20 … minutes after the last attempt started. */
export function nextAttemptAt(attempts: number, lastAttemptAt: Date | null): Date | null {
  if (!lastAttemptAt || attempts <= 0) return null;
  return new Date(lastAttemptAt.getTime() + BACKOFF_BASE_MS * 2 ** (attempts - 1));
}

export function retryDue(
  post: { publishAttempts: number; lastPublishAttemptAt: Date | null; publishError: string | null },
  now: Date,
): boolean {
  if (!post.publishError?.startsWith(TEMPORARY_PREFIX)) return false;
  if (post.publishAttempts >= MAX_ATTEMPTS) return false;
  const next = nextAttemptAt(post.publishAttempts, post.lastPublishAttemptAt);
  return !next || next.getTime() <= now.getTime();
}
