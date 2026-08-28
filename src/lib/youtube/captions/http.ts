import { CaptionError } from "./types";

export const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * fetch with a hard timeout, mapping transport failures onto CaptionError so
 * callers never have to distinguish "YouTube said no" from "the socket died".
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit & { timeoutMs?: number },
  stage: "list" | "fetch",
): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...rest, signal: controller.signal });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const aborted = controller.signal.aborted;
    throw new CaptionError(
      aborted ? `timed out after ${timeoutMs}ms` : `network error: ${msg}`,
      "network",
      stage,
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A 429/403 from YouTube on a datacenter IP is the exact failure PR-01 exists to
 * detect, so it gets its own reason rather than being lumped into "network".
 */
export function assertOkResponse(res: Response, stage: "list" | "fetch"): void {
  if (res.ok) return;
  const reason = res.status === 429 || res.status === 403 ? "blocked" : "network";
  throw new CaptionError(`HTTP ${res.status} ${res.statusText}`, reason, stage);
}
