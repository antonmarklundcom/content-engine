import { INNERTUBE_CLIENTS, listTracksViaInnertube } from "./innertube";
import { countWords, fetchTrack, segmentsToText, selectTrack } from "./track";
import { listTracksViaWatchPage } from "./watch-page";
import { fetchTranscriptViaLibrary, listTracksViaLibrary } from "./youtubei-lib";
import {
  CaptionError,
  type CaptionResult,
  type CaptionTrack,
  type ListTracksOptions,
  type StrategyName,
  type StrategyOutcome,
} from "./types";

export * from "./types";
export { selectTrack, segmentsToText, countWords } from "./track";
export { parseVideoId, parseYouTubeUrl } from "../url";

/**
 * Strategy order matters: cheapest and least-blocked first. The innertube JSON
 * clients never touch the HTML watch page, so they survive consent walls and
 * datacenter-IP heuristics that the scrape-based strategies do not.
 *
 * PR-01 runs every strategy to build the evidence table. PR-05 onward runs them
 * in order and stops at the first success — with CAPTION_STRATEGIES in env
 * pinning the order once the Hostinger box has told us which ones actually work.
 */
export const STRATEGY_ORDER: StrategyName[] = [
  "innertube-android",
  "innertube-ios",
  "innertube-tv",
  "innertube-web",
  "youtubei-lib",
  "watch-page",
];

async function runStrategy(
  strategy: StrategyName,
  videoId: string,
  preferredLanguages: string[],
  opts: ListTracksOptions,
): Promise<CaptionResult> {
  // The library strategy can bypass timedtext entirely, so it gets its own path.
  if (strategy === "youtubei-lib") {
    try {
      const tracks = await listTracksViaLibrary(videoId);
      const track = selectTrack(tracks, preferredLanguages);
      if (track) return await downloadTrack(strategy, track, opts);
    } catch (err) {
      // Fall through to the transcript endpoint — it sometimes works when the
      // timedtext URLs are refused.
      if (err instanceof CaptionError && err.reason === "unavailable") throw err;
    }
    const { segments, languageCode } = await fetchTranscriptViaLibrary(videoId);
    const text = segmentsToText(segments);
    return {
      strategy,
      languageCode,
      kind: "asr",
      segments,
      text,
      wordCount: countWords(text),
    };
  }

  const tracks =
    strategy === "watch-page"
      ? await listTracksViaWatchPage(videoId, opts)
      : await listTracksViaInnertube(videoId, clientFor(strategy), opts);

  const track = selectTrack(tracks, preferredLanguages);
  if (!track) throw new CaptionError("no track survived selection", "no_captions", "list");
  return await downloadTrack(strategy, track, opts);
}

async function downloadTrack(
  strategy: StrategyName,
  track: CaptionTrack,
  opts: ListTracksOptions,
): Promise<CaptionResult> {
  const segments = await fetchTrack(track, opts.timeoutMs);
  const text = segmentsToText(segments);
  return {
    strategy,
    languageCode: track.languageCode,
    kind: track.kind,
    segments,
    text,
    wordCount: countWords(text),
  };
}

function clientFor(strategy: StrategyName) {
  const key = strategy.replace("innertube-", "");
  const client = INNERTUBE_CLIENTS[key];
  if (!client) throw new CaptionError(`unknown strategy ${strategy}`, "unavailable", "list");
  return client;
}

/** Run one strategy and capture the outcome instead of throwing — used by the probe. */
export async function tryStrategy(
  strategy: StrategyName,
  videoId: string,
  preferredLanguages: string[] = ["en"],
  opts: ListTracksOptions = {},
): Promise<StrategyOutcome> {
  const started = Date.now();
  try {
    const result = await runStrategy(strategy, videoId, preferredLanguages, opts);
    return {
      ok: true,
      strategy,
      result,
      ms: Date.now() - started,
      trackCount: result.segments.length,
    };
  } catch (err) {
    const captionErr =
      err instanceof CaptionError
        ? err
        : new CaptionError(err instanceof Error ? err.message : String(err), "network", "list");
    return {
      ok: false,
      strategy,
      reason: captionErr.reason,
      stage: captionErr.stage,
      error: captionErr.message,
      ms: Date.now() - started,
      trackCount: 0,
    };
  }
}

export type FetchCaptionsResult =
  | { ok: true; result: CaptionResult; attempts: StrategyOutcome[] }
  | { ok: false; reason: "no_captions" | "blocked" | "error"; attempts: StrategyOutcome[] };

/**
 * The production entry point (PR-05): walk the strategy list, return the first
 * success.
 *
 * A `no_captions` verdict short-circuits the remaining strategies — that is a
 * property of the video, not of the network path, so retrying with a different
 * client only burns requests and makes us look more like a scraper.
 */
export async function fetchCaptions(
  videoId: string,
  options: {
    preferredLanguages?: string[];
    strategies?: StrategyName[];
    timeoutMs?: number;
  } = {},
): Promise<FetchCaptionsResult> {
  const strategies = options.strategies?.length ? options.strategies : STRATEGY_ORDER;
  const preferred = options.preferredLanguages ?? ["en"];
  const attempts: StrategyOutcome[] = [];

  for (const strategy of strategies) {
    const outcome = await tryStrategy(strategy, videoId, preferred, {
      timeoutMs: options.timeoutMs,
    });
    attempts.push(outcome);
    if (outcome.ok) return { ok: true, result: outcome.result, attempts };
    if (outcome.reason === "no_captions") return { ok: false, reason: "no_captions", attempts };
  }

  const blocked = attempts.some((a) => !a.ok && a.reason === "blocked");
  return { ok: false, reason: blocked ? "blocked" : "error", attempts };
}
