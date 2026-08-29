import { GoogleGenAI, ThinkingLevel, type GenerateContentResponse } from "@google/genai";
import type { Brand } from "@/db/schema";
import {
  costUsdAtRates,
  GROUNDING_USD_PER_QUERY,
  ideationRates,
  type TokenUsage,
} from "@/lib/analysis/pricing";
import { recordSpend, withSpendCap } from "@/lib/spend";

/**
 * One Gemini client for the whole app — shared by the brand-ideation path
 * (below) and the YouTube analysis/screening pipelines (src/lib/analysis,
 * src/lib/screening), which otherwise would each construct their own SDK
 * client. Lazy so importing this module never requires GEMINI_API_KEY at build
 * time (route analysis during `next build` loads modules without env).
 *
 * PLAN.md §5.O3: this is the one module every paid call goes through, which is
 * what made the Anthropic → Gemini swap one module's job. Keep it that way —
 * a new call site uses the helpers here, never its own client.
 */
let cachedClient: GoogleGenAI | undefined;

export function geminiClient(): GoogleGenAI {
  if (!cachedClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "Missing GEMINI_API_KEY. Create a key at aistudio.google.com/apikey and set it in .env.",
      );
    }
    cachedClient = new GoogleGenAI({ apiKey });
  }
  return cachedClient;
}

/**
 * The Pro seat — the model that has to research, verify and write publishable
 * copy in the brand's own language. Overridable, and the rates for anything it
 * can be set to live in IDEATION_MODEL_RATES (an unlisted model bills at the
 * most expensive rate on file, so the cap over-counts rather than under-counts).
 */
const MODEL = process.env.GEMINI_MODEL ?? "gemini-3.1-pro-preview";

/**
 * Ceilings this call is allowed to reach — and, because they are ceilings, the
 * numbers the spend estimate is built from (PLAN.md §1.10: this path's cost
 * joins the YouTube half's cap rather than running beside it).
 */
const MAX_OUTPUT_TOKENS = 16_000;

/**
 * Reasoning tokens, which Gemini bills at the output rate and reports
 * separately from the response itself (`thoughtsTokenCount`). Counted in the
 * reservation because a thinking model can spend more on deciding what to write
 * than on writing it, and a reservation that ignored them would hold back less
 * than the call can bill.
 */
const ESTIMATED_THINKING_TOKENS = 8_000;

/**
 * How many Search groundings this call is expected to be worth reserving for.
 *
 * Not a ceiling, unlike the `max_uses` the Anthropic `web_search` tool took:
 * Gemini's Search grounding has no cap parameter, so this is an estimate for
 * the reservation and a line in the prompt, nothing more. What is actually
 * billed comes from the response's own query list (see groundingQueryCount), so
 * a run that searches more than this bills correctly — it just reserved less
 * than it spent, which is the one direction this file otherwise avoids. See
 * KNOWN-ISSUES.md.
 */
const MAX_GROUNDING_QUERIES = 8;

/**
 * The prompt this route sends: brand, portfolio, existing research, and an
 * optional analysis to ground from. Rounded up on purpose — an over-estimate
 * trips the cap early, which is the safe direction for a guard (see the same
 * reasoning in lib/spend.ts).
 *
 * Search results are NOT in this figure, and that is not an omission: Google
 * does not charge for the tokens Grounding with Google Search feeds back into
 * the prompt. They are billed by the query instead.
 */
const PROMPT_OVERHEAD_TOKENS = 4_000;

/**
 * The worst case this call can bill, reserved against the monthly cap before a
 * request is sent. The reservation is released the moment the call returns;
 * what is actually billed is recorded from `usageMetadata` (see
 * generateContentPlan).
 */
export function estimateContentPlanCostUsd(model: string = MODEL): number {
  const tokens = costUsdAtRates(ideationRates(model), {
    inputTokens: PROMPT_OVERHEAD_TOKENS,
    outputTokens: MAX_OUTPUT_TOKENS + ESTIMATED_THINKING_TOKENS,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  });
  return tokens + MAX_GROUNDING_QUERIES * GROUNDING_USD_PER_QUERY;
}

/**
 * What a Gemini response actually used, in the four buckets the schema records
 * and `costUsdAtRates` prices. Every paid path in the app reads its usage
 * through this function, so the mapping from Google's counters to money exists
 * once.
 *
 * Three details decide whether the stored cost matches the bill:
 *
 *  - `promptTokenCount` INCLUDES the cached prefix, unlike the Anthropic field
 *    it replaces. Subtracting `cachedContentTokenCount` is what stops cached
 *    tokens being counted twice.
 *  - `thoughtsTokenCount` is billed at the output rate and is NOT part of
 *    `candidatesTokenCount`. Dropping it would under-report every call on a
 *    thinking model, which is most of them.
 *  - `toolUsePromptTokenCount` is deliberately excluded. The only tool this app
 *    enables is Grounding with Google Search, and Google states that the input
 *    tokens grounding provides are not charged — they are billed per query
 *    instead (GROUNDING_USD_PER_QUERY). Counting them as input would inflate a
 *    grounded run by tens of thousands of tokens it never paid for.
 *
 * Gemini has no cache-write token counter, so that bucket is always 0 here;
 * it stays in the shape because the `analyses` columns still record it.
 */
export function readUsage(response: GenerateContentResponse): TokenUsage {
  const usage = response.usageMetadata;
  const cacheReadTokens = usage?.cachedContentTokenCount ?? 0;
  const promptTokens = usage?.promptTokenCount ?? 0;
  return {
    inputTokens: Math.max(0, promptTokens - cacheReadTokens),
    outputTokens: (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0),
    cacheReadTokens,
    cacheWriteTokens: 0,
  };
}

/**
 * The model's answer, as text.
 *
 * `GenerateContentResponse.text` is a prototype getter, so it only exists on a
 * value the SDK actually instantiated. A batch job's `inlinedResponses` carry
 * responses that have been through JSON, and a plain object with the right
 * fields but no prototype would make this getter `undefined` — which would read
 * as an empty response, mark every analysis in the batch failed, and still bill
 * for it. Falling back to the parts themselves costs one branch and removes
 * that whole failure mode.
 *
 * Thought parts are excluded, matching what the getter does: they are the
 * model's reasoning, not its answer.
 */
export function responseText(response: GenerateContentResponse): string {
  const viaGetter = response.text;
  if (typeof viaGetter === "string") return viaGetter;
  return (response.candidates?.[0]?.content?.parts ?? [])
    .filter((part) => !part.thought && typeof part.text === "string")
    .map((part) => part.text)
    .join("");
}

/**
 * How many Grounding Queries a response issued — the billable unit for Search
 * grounding ($14/1,000, one request can issue several).
 *
 * `webSearchQueries` is per candidate; this app asks for one. A call that
 * grounded nothing has no metadata at all and costs nothing extra, which is why
 * the promote call can share the same cost function.
 */
export function groundingQueryCount(response: GenerateContentResponse): number {
  return response.candidates?.[0]?.groundingMetadata?.webSearchQueries?.length ?? 0;
}

/**
 * What a finished call actually cost: tokens at the given model's rates, plus
 * the per-query grounding fee for however many searches it chose to run (a call
 * with no Search tool grounds nothing and pays nothing for it, which is why the
 * promote call shares this function rather than having its own).
 */
export function messageCostUsd(
  usage: TokenUsage,
  groundingQueries: number,
  model: string = MODEL,
): number {
  return (
    costUsdAtRates(ideationRates(model), usage) + groundingQueries * GROUNDING_USD_PER_QUERY
  );
}

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

/**
 * A stored analysis used as grounding for a generation run (PLAN.md §5.O2.4).
 *
 * The corpus the YouTube half has already paid to read is better evidence than
 * a fresh web search for "what is happening in this niche" — it is what Anton
 * actually watched. Passed as context, not as instructions: the system prompt's
 * verification rule still applies to anything checkable inside it.
 */
export type AnalysisGrounding = {
  videoTitle: string;
  channelTitle?: string | null;
  summary?: string | null;
  takeaways?: string[] | null;
  topics?: string[] | null;
  ideas?: { title?: string; premise?: string; why_now?: string }[] | null;
};

export type GenerateResult = {
  ideas: GeneratedIdea[];
  researchNotes: GeneratedResearchNote[];
  /** What this call billed, already written to `spend_log`. */
  costUsd: number;
};

/**
 * The content plan's shape, as JSON Schema.
 *
 * Ported field for field from the Anthropic tool definition this replaces
 * (PLAN.md §5.O3.5). It is a response schema rather than a function
 * declaration because Gemini 3 constrains structured output directly, and does
 * so alongside Search grounding in the same request — which removes the failure
 * mode the tool version had, where a model could research and then answer in
 * prose without ever calling the tool.
 */
const IDEAS_JSON_SCHEMA = {
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
            description:
              "Brand ids (from the provided list) this topic is relevant to, including this brand.",
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
          platform: {
            type: "string",
            description: "One of the brand's platforms this is written for.",
          },
          draftCopy: {
            type: "string",
            description:
              "The FULL ready-to-post caption in the brand's voice/language: hook line, body, call-to-action, hashtags. Not a placeholder or summary — actual publishable text.",
          },
          visualNotes: {
            type: "string",
            description:
              "Optional: what the accompanying photo/video should show, for whoever shoots or designs it.",
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
} as const;

export async function generateContentPlan(
  brand: Brand,
  allBrands: Brand[],
  existingResearch: { topic: string; summary: string }[],
  grounding?: AnalysisGrounding | null,
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

  const groundingContext = grounding
    ? `\n\nGROUNDING — a video from this portfolio's own research corpus, already analysed. Build the ideas from THIS material first; use web search only to verify facts in it or to fill a gap it leaves.
Video: ${grounding.videoTitle}${grounding.channelTitle ? ` (${grounding.channelTitle})` : ""}
${grounding.summary ? `Summary: ${grounding.summary}\n` : ""}${
        grounding.takeaways?.length
          ? `Takeaways:\n${grounding.takeaways.map((t) => `- ${t}`).join("\n")}\n`
          : ""
      }${grounding.topics?.length ? `Topics: ${grounding.topics.join(", ")}\n` : ""}${
        grounding.ideas?.length
          ? `Ideas the analysis already proposed (adapt for THIS brand, do not copy):\n${grounding.ideas
              .map((i) => `- ${[i.title, i.premise, i.why_now].filter(Boolean).join(" — ")}`)
              .join("\n")}\n`
          : ""
      }`
    : "";

  const system = `You are a social media researcher and copywriter for a portfolio of small businesses in Paraguay and abroad. Your job for each brand is to: (1) research current, real, relevant trends/news/topics for its niche and market using Google Search, (2) turn that research into concrete content ideas, and (3) write full, ready-to-post captions for each idea — not placeholders. Copy must be in the brand's own language and voice. Never invent facts, prices, laws, or statistics — verify anything checkable with at least 2 independent web sources and attach them as citations. If you can't verify a claim, drop it or write around it instead of guessing. If research surfaces something relevant to OTHER brands in the portfolio too, report it as a shared research note so it isn't re-researched per brand. Every search costs money: use at most ${MAX_GROUNDING_QUERIES} searches, and make them count. Answer with JSON matching the required schema and nothing else.`;

  const userPrompt = `Brand: ${brand.name} (id: ${brand.id})
Niche: ${brand.niche}
Market: ${brand.market}
Language for copy: ${brand.language}
Voice: ${brand.voice ?? "no voice notes on file — write in a plain, concrete house voice"}
Platforms: ${brand.platforms.join(", ")}

Other brands in this portfolio (for cross-brand research notes only — do not write ideas for them):
${otherBrandList}
${researchContext}${groundingContext}

Research current trends/news relevant to this brand's niche and market, then propose 5-10 concrete content ideas with full ready-to-post copy.`;

  // The whole paid call sits inside the cap: the estimate is held against the
  // monthly budget before the request goes out, and the real figure is logged
  // as soon as it comes back — the same shape the analysis pipeline uses, so
  // both halves of the app share one budget rather than one each (PLAN.md
  // §1.10). Streaming, because 16k output tokens plus reasoning on a Pro model
  // is a long time to hold a request open with nothing coming back.
  const { text, costUsd, finishReason } = await withSpendCap(
    estimateContentPlanCostUsd(),
    async () => {
      const stream = await geminiClient().models.generateContentStream({
        model: MODEL,
        contents: userPrompt,
        config: {
          systemInstruction: system,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          // Gemini 3 allows a built-in tool and structured output in the same
          // request, which is what makes this one call rather than two.
          tools: [{ googleSearch: {} }],
          responseMimeType: "application/json",
          responseJsonSchema: IDEAS_JSON_SCHEMA,
        },
      });

      let body = "";
      let usage: TokenUsage | null = null;
      let stopReason: string | undefined;
      let queries = 0;
      const seenQueries = new Set<string>();

      for await (const chunk of stream) {
        body += responseText(chunk);
        // Usage arrives cumulatively, with the totals on the final chunk that
        // carries it; the last one seen is therefore the whole call.
        if (chunk.usageMetadata) usage = readUsage(chunk);
        const candidate = chunk.candidates?.[0];
        if (candidate?.finishReason) stopReason = candidate.finishReason;
        // Whether grounding metadata arrives once with every query or is split
        // across chunks is not documented either way, so count it both ways and
        // bill the larger: over-counting a $0.014 query is survivable, silently
        // dropping one from the ledger is the thing this file exists to prevent.
        const chunkQueries = candidate?.groundingMetadata?.webSearchQueries ?? [];
        for (const q of chunkQueries) seenQueries.add(q);
        queries = Math.max(queries, chunkQueries.length, seenQueries.size);
      }

      // A call that produced output but reported no usage must not be recorded
      // as free — that is the silent under-report the cap cannot survive. Bill
      // the reservation instead, which is the figure already held against the
      // budget, and say so.
      if (!usage) {
        console.warn(
          "Gemini returned no usageMetadata for a content plan; billing the reservation estimate instead.",
        );
        const fallback = estimateContentPlanCostUsd();
        await recordSpend(fallback);
        return { text: body, costUsd: fallback, finishReason: stopReason };
      }

      // Billed whether or not the response parses below: the tokens were spent.
      const cost = messageCostUsd(usage, queries);
      await recordSpend(cost);
      return { text: body, costUsd: cost, finishReason: stopReason };
    },
  );

  let input: { ideas?: GeneratedIdea[]; researchNotes?: GeneratedResearchNote[] };
  try {
    input = JSON.parse(text) as typeof input;
  } catch {
    throw new Error(
      `Gemini didn't return a parseable content plan (finish reason: ${finishReason ?? "unknown"}). Try again.`,
    );
  }
  if (!Array.isArray(input.ideas) || input.ideas.length === 0) {
    throw new Error(
      `Gemini returned no ideas (finish reason: ${finishReason ?? "unknown"}). Try again.`,
    );
  }

  return { ideas: input.ideas, researchNotes: input.researchNotes ?? [], costUsd };
}

// ---------------------------------------------------------------------------
// promote — adapting one unit of an analysis into a brand's voice
// ---------------------------------------------------------------------------

/**
 * The cheap model. Promoting rewrites one paragraph in a known voice from
 * material that is already on file — no research, no judgement about what is
 * true, nothing the analysis pipeline's own default model cannot do (PLAN.md
 * §5.O2.3 calls for "one cheap call"). Overridable for the same reason
 * GEMINI_MODEL is.
 */
const PROMOTE_MODEL = process.env.GEMINI_PROMOTE_MODEL ?? "gemini-3.1-flash-lite";

/** Enough for a caption with hashtags, not enough for an essay. */
const PROMOTE_MAX_TOKENS = 2_000;
const PROMOTE_PROMPT_OVERHEAD_TOKENS = 1_500;

export type AdaptedIdea = {
  title: string;
  angle: string;
  draftCopy: string;
  visualNotes?: string;
};

export type AdaptIdeaInput = {
  /** What was marked or proposed, as it reads in the analysis. */
  sourceText: string;
  /** Where it came from, for the angle line. */
  videoTitle: string;
  format: string;
  platform: string;
};

/** Ported field for field from the Anthropic `submit_adapted_idea` tool. */
const ADAPT_JSON_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "Short internal name for the idea." },
    angle: {
      type: "string",
      description: "Why this works for THIS brand's audience, one or two sentences.",
    },
    draftCopy: {
      type: "string",
      description:
        "The FULL ready-to-post caption in the brand's language and voice: hook line, body, call-to-action, hashtags. Actual publishable text, not a summary.",
    },
    visualNotes: {
      type: "string",
      description: "Optional: what the photo/video should show.",
    },
  },
  required: ["title", "angle", "draftCopy"],
} as const;

export function estimateAdaptCostUsd(model: string = PROMOTE_MODEL): number {
  return costUsdAtRates(ideationRates(model), {
    inputTokens: PROMOTE_PROMPT_OVERHEAD_TOKENS,
    outputTokens: PROMOTE_MAX_TOKENS,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  });
}

/**
 * Rewrite one piece of an analysis as a post for a brand — the paid half of
 * the promote endpoint, and optional per request: promoting verbatim must
 * work at zero cost (§5.O2.3).
 *
 * No Search grounding on purpose. The source material is already on file and
 * already paid for; grounding here would turn a $0.001 call into a $0.10 one
 * and re-open the verification question the analysis already answered.
 */
export async function adaptIdeaToBrand(
  brand: Brand,
  input: AdaptIdeaInput,
): Promise<{ idea: AdaptedIdea; costUsd: number }> {
  const system = `You adapt research findings into ready-to-post social copy for one specific brand. Write in the brand's language and voice. Never invent facts, prices, laws or statistics that are not in the source material — if the source does not support a claim, write around it. Answer with JSON matching the required schema and nothing else.`;

  const userPrompt = `Brand: ${brand.name} (${brand.niche})
Market: ${brand.market}
Language for copy: ${brand.language}
Voice: ${brand.voice ?? "plain, concrete, no hype"}
Format: ${input.format}
Platform: ${input.platform}

Source material, from an analysis of "${input.videoTitle}":
${input.sourceText}

Adapt it into one post for this brand.`;

  return withSpendCap(estimateAdaptCostUsd(), async () => {
    const response = await geminiClient().models.generateContent({
      model: PROMOTE_MODEL,
      contents: userPrompt,
      config: {
        systemInstruction: system,
        maxOutputTokens: PROMOTE_MAX_TOKENS,
        // One paragraph rewritten from material already on file is not a
        // reasoning problem, and reasoning tokens bill at the output rate —
        // the same call the Anthropic version made by not asking for thinking
        // at all.
        thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
        responseMimeType: "application/json",
        responseJsonSchema: ADAPT_JSON_SCHEMA,
      },
    });

    const costUsd = messageCostUsd(
      readUsage(response),
      groundingQueryCount(response),
      PROMOTE_MODEL,
    );
    await recordSpend(costUsd);

    const raw = responseText(response);
    let idea: AdaptedIdea;
    try {
      idea = JSON.parse(raw) as AdaptedIdea;
    } catch {
      throw new Error(
        `The model returned no adapted idea (finish reason: ${
          response.candidates?.[0]?.finishReason ?? "unknown"
        }).`,
      );
    }

    return { idea, costUsd };
  });
}
