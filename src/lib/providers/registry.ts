import type { ContentProvider } from "./types";

// Registry of providers this pipeline knows about. Add a new provider by
// adding an entry here — no other code changes needed for the DB/planning
// layer. The orchestrating Claude Code agent reads `mcpToolMap` to know
// which MCP tool to actually call.
export const PROVIDERS: Record<string, ContentProvider> = {
  higgsfield: {
    id: "higgsfield",
    mcpToolMap: {
      image: "mcp__Higgsfield__generate_image",
      video: "mcp__Higgsfield__generate_video",
      audio: "mcp__Higgsfield__generate_audio",
    },
    notes:
      "Default provider — already connected via MCP. Good general quality, has batch generation, reframe/upscale/outpaint helpers, and direct TikTok publish tools. Use models_explore(action:'recommend') when unsure which model to pick.",
  },
  runway: {
    id: "runway",
    mcpToolMap: {
      // Not yet connected. Add an MCP server (or REST wrapper script) for
      // Runway's API and fill this in — the rest of the pipeline needs no
      // other changes to start using it.
    },
    notes:
      "Not yet wired up. Strong general video generation (Gen-4). Add via Runway's API + a thin MCP/script wrapper, then set calendar_items.provider = 'runway' on new items.",
  },
  kling: {
    id: "kling",
    mcpToolMap: {},
    notes:
      "Not yet wired up. Strong image-to-video, often cheaper than Runway. Available directly or via fal.ai.",
  },
  fal: {
    id: "fal",
    mcpToolMap: {},
    notes:
      "Not yet wired up. Hosting layer giving one API to many models (Kling, Luma, MiniMax, Flux, etc.) — consider wiring this instead of individual providers to get several swap options behind one adapter.",
  },
};

export function getProvider(id: string): ContentProvider {
  const provider = PROVIDERS[id];
  if (!provider) {
    throw new Error(`Unknown provider "${id}". Known: ${Object.keys(PROVIDERS).join(", ")}`);
  }
  return provider;
}
