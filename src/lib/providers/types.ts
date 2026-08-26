// Every generation provider (Higgsfield today; Runway, Kling, fal.ai, etc.
// later) implements this shape. Nothing else in the pipeline should import a
// provider directly — go through `getProvider(providerId)` in ./index.ts so
// swapping providers is a config change (calendar_items.provider), not a
// code change.
//
// IMPORTANT: these adapters don't call HTTP APIs directly. Generation in
// this system happens as MCP tool calls made by the Claude Code agent
// running the pipeline (see the `content-engine` skill). Each adapter here
// documents which MCP tool(s) to call and how to shape the request/response,
// so the agent (or a future non-Claude worker) has one place to look.

export type GenerateImageRequest = {
  prompt: string;
  brandId: string;
  aspectRatio?: "1:1" | "4:5" | "9:16" | "16:9";
  referenceImageUrls?: string[]; // for brand-consistent style/elements
};

export type GenerateVideoRequest = {
  prompt: string;
  brandId: string;
  durationSeconds?: number;
  aspectRatio?: "9:16" | "16:9" | "1:1";
  startImageUrl?: string; // image-to-video
};

export type GeneratedMedia = {
  kind: "image" | "video" | "audio";
  url: string;
  providerJobId?: string;
  meta?: Record<string, unknown>;
};

export interface ContentProvider {
  id: string; // matches calendar_items.provider / assets.provider
  /** Which MCP tool(s) this provider maps to, for the orchestrating agent. */
  mcpToolMap: {
    image?: string;
    video?: string;
    audio?: string;
  };
  /** Human-readable notes on cost, strengths, quirks — shown to the agent before it picks a provider per idea. */
  notes: string;
}
