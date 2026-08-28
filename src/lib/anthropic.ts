import Anthropic from "@anthropic-ai/sdk";
import type { BrandSeed } from "./brands";

/**
 * One Anthropic client for the whole app — shared by the brand-ideation path
 * (below) and the YouTube analysis/screening pipelines (src/lib/analysis,
 * src/lib/screening), which otherwise would each construct their own SDK
 * client. Lazy so importing this module never requires ANTHROPIC_API_KEY at
 * build time (route analysis during `next build` loads modules without env).
 */
let cachedClient: Anthropic | undefined;

export function anthropicClient(): Anthropic {
  if (!cachedClient) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error(
        "Missing ANTHROPIC_API_KEY. Create a key at console.anthropic.com and set it in .env.",
      );
    }
    cachedClient = new Anthropic();
  }
  return cachedClient;
}

const client = new Proxy({} as Anthropic, {
  get(_target, prop, receiver) {
    return Reflect.get(anthropicClient(), prop, receiver);
  },
});

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-5";

export type GeneratedIdea = {
  title: string;
  angle: string;
  format: "reel" | "carousel" | "image_post" | "story";
  platform: string;
  draftCopy: string;
  visualNotes?: string;
  citations?: { claim: string; sources: string[] }[];
};

export type GeneratedResearchNote = {
  topic: string;
  summary: string;
  sources: string[];
  relatedBrandIds: string[];
};

export type GenerateResult = {
  ideas: GeneratedIdea[];
  researchNotes: GeneratedResearchNote[];
};

const IDEAS_TOOL: Anthropic.Tool = {
  name: "submit_content_plan",
  description:
    "Submit the researched content ideas and any cross-brand research notes for this brand.",
  input_schema: {
    type: "object",
    properties: {
      researchNotes: {
        type: "array",
        description:
          "Research findings worth sharing with OTHER brands too (e.g. a market/law/news item relevant beyond this one brand). Omit if nothing found is cross-brand relevant.",
        items: {
          type: "object",
          properties: {
            topic: { type: "string" },
            summary: { type: "string" },
            sources: { type: "array", items: { type: "string" } },
            relatedBrandIds: {
              type: "array",
              items: { type: "string" },
              description: "Brand ids (from the provided list) this topic is relevant to, including this brand.",
            },
          },
          required: ["topic", "summary", "sources", "relatedBrandIds"],
        },
      },
      ideas: {
        type: "array",
        minItems: 5,
        maxItems: 10,
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            angle: { type: "string", description: "Why this idea, the hook, one or two sentences." },
            format: { type: "string", enum: ["reel", "carousel", "image_post", "story"] },
            platform: { type: "string", description: "One of the brand's platforms this is written for." },
            draftCopy: {
              type: "string",
              description:
                "The FULL ready-to-post caption in the brand's voice/language: hook line, body, call-to-action, hashtags. Not a placeholder or summary — actual publishable text.",
            },
            visualNotes: {
              type: "string",
              description: "Optional: what the accompanying photo/video should show, for whoever shoots or designs it.",
            },
            citations: {
              type: "array",
              description:
                "Required if the idea rests on a factual/verifiable claim (a law, price, program name, statistic). Each claim needs at least 2 independent sources.",
              items: {
                type: "object",
                properties: {
                  claim: { type: "string" },
                  sources: { type: "array", items: { type: "string" }, minItems: 2 },
                },
                required: ["claim", "sources"],
              },
            },
          },
          required: ["title", "angle", "format", "platform", "draftCopy"],
        },
      },
    },
    required: ["ideas"],
  },
};

export async function generateContentPlan(
  brand: BrandSeed,
  allBrands: BrandSeed[],
  existingResearch: { topic: string; summary: string }[],
): Promise<GenerateResult> {
  const otherBrandList = allBrands
    .filter((b) => b.id !== brand.id)
    .map((b) => `- ${b.id}: ${b.name} (${b.niche}, market: ${b.market})`)
    .join("\n");

  const researchContext = existingResearch.length
    ? `\n\nExisting shared research already on file that may be relevant — reuse it instead of re-researching if it fits:\n${existingResearch
        .map((r) => `- ${r.topic}: ${r.summary}`)
        .join("\n")}`
    : "";

  const system = `You are a social media researcher and copywriter for a portfolio of small businesses in Paraguay and abroad. Your job for each brand is to: (1) research current, real, relevant trends/news/topics for its niche and market using web search, (2) turn that research into concrete content ideas, and (3) write full, ready-to-post captions for each idea — not placeholders. Copy must be in the brand's own language and voice. Never invent facts, prices, laws, or statistics — verify anything checkable with at least 2 independent web sources and attach them as citations. If you can't verify a claim, drop it or write around it instead of guessing. If research surfaces something relevant to OTHER brands in the portfolio too, report it as a shared research note so it isn't re-researched per brand.`;

  const userPrompt = `Brand: ${brand.name} (id: ${brand.id})
Niche: ${brand.niche}
Market: ${brand.market}
Language for copy: ${brand.language}
Voice: ${brand.voice}
Platforms: ${brand.platforms.join(", ")}

Other brands in this portfolio (for cross-brand research notes only — do not write ideas for them):
${otherBrandList}
${researchContext}

Research current trends/news relevant to this brand's niche and market, then propose 5-10 concrete content ideas with full ready-to-post copy. Call submit_content_plan with the result.`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    system,
    thinking: { type: "adaptive" },
    tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 8 }, IDEAS_TOOL],
    tool_choice: { type: "auto" },
    messages: [{ role: "user", content: userPrompt }],
  });

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock =>
      block.type === "tool_use" && block.name === "submit_content_plan",
  );

  if (!toolUse) {
    throw new Error(
      `Claude didn't submit a content plan (stop_reason: ${response.stop_reason}). Try again.`,
    );
  }

  const input = toolUse.input as { ideas: GeneratedIdea[]; researchNotes?: GeneratedResearchNote[] };
  return { ideas: input.ideas, researchNotes: input.researchNotes ?? [] };
}
