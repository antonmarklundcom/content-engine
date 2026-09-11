import {
  FinishReason,
  GenerateContentResponse,
  JobState,
  type BatchJob,
  type GenerateContentParameters,
  type GenerateContentResponseUsageMetadata,
  type InlinedRequest,
  type InlinedResponse,
  type JobError,
} from "@google/genai";

/**
 * The Gemini test double (PLAN.md §1.16, §5.O5.1).
 *
 * Build 1 shipped every paid path unverified because no session could reach the
 * API. This is what makes them verifiable without one: `GEMINI_FAKE=1` swaps
 * `geminiClient()` for this object, and everything downstream — the spend
 * arithmetic, the parsers, the route contracts, the batch state machine — runs
 * for real against canned responses.
 *
 * Three properties are what make it worth trusting, and each one is load-bearing:
 *
 *  - **Schema-valid by construction.** Every canned payload is validated, at
 *    call time, against the very `responseJsonSchema` the caller sent
 *    (`validate()` below). A fake that answers with a shape the real API would
 *    have been constrained away from is a fake that green-lights a parser bug.
 *    An unrecognised schema throws rather than guessing — silence there would
 *    let a new call site quietly test nothing.
 *  - **Realistic `usageMetadata` and `groundingMetadata`.** §1.16's whole point:
 *    the money math must be *exercised*, not skipped. The figures are asymmetric
 *    on purpose — a non-zero `cachedContentTokenCount` proves `readUsage`
 *    subtracts it out of `promptTokenCount`, and a non-zero
 *    `thoughtsTokenCount` proves reasoning is billed as output.
 *  - **The right prototypes in the right places.** Interactive calls return real
 *    `GenerateContentResponse` instances, so the SDK's `text` getter is the code
 *    path under test. Batch results come back through `JSON.parse`, exactly as
 *    the SDK delivers `inlinedResponses`, so `responseText`'s parts fallback is
 *    the code path under test there. See the comment on `responseText`: getting
 *    this backwards is how a batch bills for analyses it then marks failed.
 *
 * Nothing here is imported by production code paths other than the one branch in
 * `geminiClient()`.
 */

// ---------------------------------------------------------------------------
// which call is this?
// ---------------------------------------------------------------------------

/**
 * The five request shapes this app makes, named by what they ask for.
 *
 * Identified from the schema's own property names rather than by importing the
 * five schema constants: two of them (`IDEAS_JSON_SCHEMA`, `ADAPT_JSON_SCHEMA`)
 * are module-private to `ai.ts`, and importing the other three would point this
 * module back at half the app for no gain.
 */
export type FakeResponseKind = "ideas" | "adapt" | "analysis" | "screening" | "outline";

type JsonObject = Record<string, unknown>;

function propertyNames(schema: unknown): Set<string> {
  const properties = (schema as JsonObject | undefined)?.["properties"];
  if (typeof properties !== "object" || properties === null) return new Set();
  return new Set(Object.keys(properties as JsonObject));
}

export function classifySchema(schema: unknown): FakeResponseKind {
  const keys = propertyNames(schema);
  const has = (...names: string[]) => names.every((n) => keys.has(n));

  if (has("ideas", "researchNotes")) return "ideas";
  if (has("summary", "takeaways", "content_type")) return "analysis";
  if (has("score", "reason")) return "screening";
  if (has("hook", "rehook", "cta")) return "outline";
  if (has("title", "angle", "draftCopy")) return "adapt";

  throw new Error(
    "ai-fake: no canned response for a request whose responseJsonSchema has properties " +
      `[${[...keys].join(", ")}]. Add one to PAYLOADS — a new paid call site must not ` +
      "silently test nothing.",
  );
}

// ---------------------------------------------------------------------------
// a JSON Schema subset, just enough to keep the canned answers honest
// ---------------------------------------------------------------------------

/**
 * Validate a canned payload against the schema the caller sent.
 *
 * Deliberately not a dependency: the five schemas in this repo use nine
 * keywords between them (`type`, `properties`, `required`, `items`, `enum`,
 * `minItems`, `maxItems`, `minimum`, `maximum`, `additionalProperties`), and a
 * validator for exactly those is shorter than the argument for adding ajv to a
 * production bundle. Anything it does not understand it ignores, so a schema
 * that grows a keyword loses coverage rather than failing spuriously — the one
 * keyword worth being strict about, `additionalProperties: false`, is
 * implemented.
 */
export function validate(value: unknown, schema: unknown, path = "$"): void {
  const fail = (why: string): never => {
    throw new Error(`ai-fake: canned response is not valid against the caller's schema at ${path}: ${why}`);
  };
  if (typeof schema !== "object" || schema === null) return;
  const s = schema as JsonObject;

  const type = s["type"];
  if (type === "object") {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return void fail(`expected an object, got ${Array.isArray(value) ? "an array" : typeof value}`);
    }
    const object = value as JsonObject;
    const properties = (s["properties"] ?? {}) as JsonObject;

    for (const name of (s["required"] as string[] | undefined) ?? []) {
      if (object[name] === undefined) fail(`missing required property "${name}"`);
    }
    if (s["additionalProperties"] === false) {
      for (const name of Object.keys(object)) {
        if (!(name in properties)) fail(`property "${name}" is not in the schema`);
      }
    }
    for (const [name, child] of Object.entries(properties)) {
      if (object[name] !== undefined) validate(object[name], child, `${path}.${name}`);
    }
    return;
  }

  if (type === "array") {
    if (!Array.isArray(value)) return void fail(`expected an array, got ${typeof value}`);
    const min = s["minItems"];
    const max = s["maxItems"];
    if (typeof min === "number" && value.length < min) fail(`${value.length} items, minimum ${min}`);
    if (typeof max === "number" && value.length > max) fail(`${value.length} items, maximum ${max}`);
    value.forEach((item, i) => validate(item, s["items"], `${path}[${i}]`));
    return;
  }

  const enumeration = s["enum"];
  if (Array.isArray(enumeration) && !enumeration.includes(value)) {
    fail(`${JSON.stringify(value)} is not one of ${JSON.stringify(enumeration)}`);
  }

  if (type === "string" && typeof value !== "string") fail(`expected a string, got ${typeof value}`);

  if (type === "integer" || type === "number") {
    if (typeof value !== "number") return void fail(`expected a number, got ${typeof value}`);
    if (type === "integer" && !Number.isInteger(value)) fail(`${value} is not an integer`);
    const minimum = s["minimum"];
    const maximum = s["maximum"];
    if (typeof minimum === "number" && value < minimum) fail(`${value} is below minimum ${minimum}`);
    if (typeof maximum === "number" && value > maximum) fail(`${value} is above maximum ${maximum}`);
  }
}

// ---------------------------------------------------------------------------
// the canned answers
// ---------------------------------------------------------------------------

/**
 * One payload per request shape. Plausible rather than lorem ipsum, because
 * these strings end up in `ideas.draft_copy` and on a rendered page during a
 * screenshot run, and "string" tells a reader nothing about whether the column
 * is wide enough.
 */
export const PAYLOADS: Record<FakeResponseKind, unknown> = {
  ideas: {
    // Empty on purpose: /api/generate falls back to [brandId] when a note names
    // no brands, which is the branch worth exercising, and it keeps the note
    // attached to whichever brand the caller actually asked about.
    researchNotes: [
      {
        topic: "Residency paperwork timelines",
        summary:
          "Processing times published by the migraciones office moved from 90 to 45 days for complete applications.",
        sources: ["https://example.gov.py/migraciones/plazos", "https://example.com/py-residency-2026"],
        relatedBrandIds: [],
      },
    ],
    ideas: [
      {
        title: "The 45-day timeline, start to finish",
        angle: "Everyone still quotes 90 days. Show the current figure and where it comes from.",
        format: "carousel",
        platform: "instagram",
        draftCopy:
          "45 días. Ese es el plazo actual para una solicitud completa.\n\nLa mayoría todavía repite 90 — y planifica el viaje con el número equivocado.\n\nGuardá esto antes de comprar el pasaje.\n\n#residencia #paraguay",
        visualNotes: "Six slides, one per stage, dates in the corner.",
        citations: [
          {
            claim: "Complete applications are now processed in 45 days.",
            sources: ["https://example.gov.py/migraciones/plazos", "https://example.com/py-residency-2026"],
          },
        ],
      },
      {
        title: "What 'complete' actually means",
        angle: "The timeline only holds for a complete file; name the four documents people forget.",
        format: "reel",
        platform: "instagram",
        draftCopy:
          "El plazo de 45 días es para expedientes completos.\n\nCuatro documentos son los que faltan casi siempre. Te los muestro en orden.\n\n#tramites #paraguay",
        visualNotes: "Hands laying four documents on a desk, one at a time.",
      },
      {
        title: "Apostille before you fly",
        angle: "The one step that cannot be fixed from inside the country.",
        format: "image_post",
        platform: "instagram",
        draftCopy:
          "La apostilla se hace en tu país. No después.\n\nEs el único paso que no se arregla desde acá.\n\n#apostilla #residencia",
      },
      {
        title: "Police certificate expiry",
        angle: "A certificate that expires mid-process is the most common restart.",
        format: "story",
        platform: "instagram",
        draftCopy: "Tu certificado de antecedentes vence. Revisá la fecha antes de presentar. #residencia",
      },
      {
        title: "Cost breakdown, line by line",
        angle: "People budget for the fee and nothing else.",
        format: "carousel",
        platform: "instagram",
        draftCopy:
          "El arancel no es el costo total.\n\nTraducciones, apostillas, gestoría: acá está el desglose completo.\n\n#costos #residenciaparaguay",
        visualNotes: "Plain table, one line per cost, total at the bottom.",
      },
    ],
  },

  adapt: {
    title: "Residency timeline, for this audience",
    angle: "The source names a rule change; this brand's readers plan trips around it.",
    draftCopy:
      "45 días, no 90.\n\nSi estás planificando el viaje con el número viejo, vas a llegar con los papeles vencidos.\n\nRevisá las fechas antes de comprar.\n\n#residencia #paraguay",
    visualNotes: "Calendar with the old figure struck through.",
  },

  analysis: {
    summary:
      "A walkthrough of the Paraguayan residency process as it stands after the 2026 processing-time change, with a stage-by-stage account of the paperwork and the two places applications stall.",
    takeaways: [
      "Complete applications are now processed in about 45 days, not 90.",
      "The apostille must be obtained in the applicant's home country before travelling.",
      "Police certificates expire and are the most common cause of a restart.",
      "Translation and gestoría costs roughly double the headline fee.",
    ],
    hook: {
      technique: "Contradiction of a widely repeated number",
      first_30s: "Opens by stating that the 90-day figure everyone quotes has been wrong since the rule change.",
      why_it_works: "The viewer's existing plan is suddenly suspect, so the rest of the video is about their own file.",
    },
    timeline: [
      { ts: "00:00", topic: "The 90-day myth", beat: "States the current figure and cites the source." },
      { ts: "02:15", topic: "Document checklist", beat: "Walks the four documents applicants forget." },
      { ts: "07:40", topic: "Apostille", beat: "Explains why it cannot be done locally." },
      { ts: "12:05", topic: "Costs", beat: "Breaks the total into fee, translation and gestoría." },
    ],
    gaps: [
      {
        gap: "Never says what happens when a certificate expires mid-process.",
        counter_angle: "Cover the restart procedure and what carries over.",
      },
      {
        gap: "Costs are quoted in dollars with no guaraní figure.",
        counter_angle: "Publish the same table in guaraníes at a stated exchange rate.",
      },
    ],
    ideas: [
      {
        title: "The four forgotten documents",
        premise: "Each of the four gets its own beat, with what it looks like.",
        why_now: "The shortened timeline only applies to complete files.",
      },
      {
        title: "Restarting after an expiry",
        premise: "What happens to a file when the police certificate lapses.",
        why_now: "The gap the source video leaves open.",
      },
    ],
    topics: ["residency", "immigration paperwork", "paraguay", "relocation costs"],
    entities: ["Dirección General de Migraciones", "apostille", "cédula"],
    content_type: "tutorial",
  },

  screening: {
    score: 72,
    reason:
      "Names a specific rule change with a date and walks the paperwork stage by stage, which is the kind of detail the corpus is short on.",
  },

  outline: {
    hook: "Everyone still says 90 days. That number changed and nobody updated the advice.",
    rehook: "And the new figure only applies if your file is complete — which most are not.",
    teaching_points: [
      "Where the 45-day figure is published and how to check it yourself.",
      "The four documents that make a file incomplete.",
      "Why the apostille has to happen before you fly.",
      "What a lapsed police certificate costs you in time.",
    ],
    twist: "The fastest applicants are not the ones who rush — they are the ones who file once.",
    cta: "Check the expiry date on your police certificate before you book anything.",
  },
};

/**
 * What each call reports having used.
 *
 * Chosen so every branch of `readUsage` and `costUsdAtRates` is exercised by at
 * least one call: `analysis` carries a cached prefix (so the subtraction from
 * `promptTokenCount` is provable from the stored `analyses` columns), `ideas`
 * carries reasoning tokens (so billing them at the output rate is provable from
 * `spend_log`), and the two cheap calls carry neither, which is the ordinary
 * case. Every figure is plausible for the prompt that produced it — a
 * transcript-sized input for an analysis, a couple of paragraphs for an adapt.
 */
export const USAGE: Record<FakeResponseKind, GenerateContentResponseUsageMetadata> = {
  ideas: {
    promptTokenCount: 4_200,
    candidatesTokenCount: 3_100,
    thoughtsTokenCount: 1_900,
    cachedContentTokenCount: 0,
    totalTokenCount: 9_200,
  },
  adapt: {
    promptTokenCount: 1_200,
    candidatesTokenCount: 480,
    thoughtsTokenCount: 0,
    cachedContentTokenCount: 0,
    totalTokenCount: 1_680,
  },
  analysis: {
    promptTokenCount: 7_400,
    candidatesTokenCount: 2_400,
    thoughtsTokenCount: 0,
    cachedContentTokenCount: 1_400,
    totalTokenCount: 9_800,
  },
  screening: {
    promptTokenCount: 900,
    candidatesTokenCount: 60,
    thoughtsTokenCount: 0,
    cachedContentTokenCount: 0,
    totalTokenCount: 960,
  },
  outline: {
    promptTokenCount: 500,
    candidatesTokenCount: 650,
    thoughtsTokenCount: 0,
    cachedContentTokenCount: 0,
    totalTokenCount: 1_150,
  },
};

/**
 * The searches a grounded call reports having run — three, per §5.O5.1.
 *
 * Billed per query at $14/1,000, so the count is money: a test that asserts
 * `spend_log` is asserting that `groundingQueryCount` read this list correctly.
 */
export const WEB_SEARCH_QUERIES = [
  "paraguay residency processing time 2026",
  "migraciones paraguay plazo residencia",
  "apostille requirement paraguay residency",
] as const;

// ---------------------------------------------------------------------------
// building responses
// ---------------------------------------------------------------------------

function textOf(kind: FakeResponseKind): string {
  return JSON.stringify(PAYLOADS[kind]);
}

/** Is this request asking for Search grounding? Only `/api/generate` does. */
function isGrounded(params: GenerateContentParameters): boolean {
  return (params.config?.tools ?? []).some((tool) => "googleSearch" in tool);
}

type ResponseParts = {
  text: string;
  usageMetadata?: GenerateContentResponseUsageMetadata;
  webSearchQueries?: readonly string[];
  finishReason?: FinishReason;
};

/**
 * A real `GenerateContentResponse` instance — not a plain object with the same
 * fields. The SDK's `text` getter lives on the prototype, and the interactive
 * paths read it; a lookalike would exercise `responseText`'s fallback branch
 * instead and leave the branch that actually runs in production untested.
 */
function sdkResponse(parts: ResponseParts): GenerateContentResponse {
  return Object.assign(new GenerateContentResponse(), {
    modelVersion: "fake-gemini",
    responseId: `fake-${nextId()}`,
    candidates: [
      {
        content: { role: "model", parts: [{ text: parts.text }] },
        finishReason: parts.finishReason ?? FinishReason.STOP,
        index: 0,
        ...(parts.webSearchQueries
          ? { groundingMetadata: { webSearchQueries: [...parts.webSearchQueries] } }
          : {}),
      },
    ],
    ...(parts.usageMetadata ? { usageMetadata: parts.usageMetadata } : {}),
  });
}

let counter = 0;
function nextId(): number {
  return ++counter;
}

/**
 * Split a string into `n` roughly equal pieces, so a streamed answer arrives in
 * fragments the way a real one does — the concatenation, not any single chunk,
 * is the JSON.
 */
function fragments(text: string, n: number): string[] {
  const size = Math.ceil(text.length / n);
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out.length ? out : [""];
}

// ---------------------------------------------------------------------------
// the fake client
// ---------------------------------------------------------------------------

export type FakeCall = {
  kind: "generateContent" | "generateContentStream" | "batches.create" | "batches.get";
  /** The request shape, as classified from its schema. Null for batch calls. */
  responseKind: FakeResponseKind | null;
  model?: string;
  /** Exactly what the caller sent, for asserting the prompt reached the model. */
  params: unknown;
  /** What this call reported using, so a test can price it with `pricing.ts`. */
  usageMetadata?: GenerateContentResponseUsageMetadata;
  /** How many Search queries the response claimed. 0 for an ungrounded call. */
  groundingQueries: number;
};

/** Levers a test pulls to drive a path that is not the happy one. */
export type FakeControls = {
  /**
   * The state `batches.get` reports. `JOB_STATE_SUCCEEDED` (the default) is the
   * only state `mapProviderStatus` calls collectable; set it to anything else to
   * exercise the still-in-flight branch.
   */
  batchState: JobState;
  /** `custom_id` → error, to fail individual entries of an otherwise fine batch. */
  batchEntryErrors: Map<string, JobError>;
};

export class FakeGemini {
  /** Every call, in order. */
  readonly calls: FakeCall[] = [];
  readonly controls: FakeControls = {
    batchState: JobState.JOB_STATE_SUCCEEDED,
    batchEntryErrors: new Map(),
  };

  /** Requests as submitted, keyed by the job name `batches.create` handed back. */
  private readonly submitted = new Map<string, InlinedRequest[]>();

  readonly models = {
    generateContent: async (params: GenerateContentParameters): Promise<GenerateContentResponse> => {
      const kind = this.record(params);
      return sdkResponse({
        text: textOf(kind),
        usageMetadata: USAGE[kind],
        webSearchQueries: isGrounded(params) ? WEB_SEARCH_QUERIES : undefined,
      });
    },

    generateContentStream: async (
      params: GenerateContentParameters,
    ): Promise<AsyncGenerator<GenerateContentResponse>> => {
      const kind = this.record(params, "generateContentStream");
      const grounded = isGrounded(params);
      const pieces = fragments(textOf(kind), 3);

      // Grounding metadata is split across chunks on purpose. Whether the real
      // API repeats the full list on every chunk or dribbles it out is not
      // documented either way, which is why generateContentPlan unions the
      // queries it sees as well as taking the per-chunk maximum. Splitting here
      // is what proves the union half of that is doing something: no single
      // chunk carries all three.
      const queriesByChunk: (readonly string[] | undefined)[] = grounded
        ? [WEB_SEARCH_QUERIES.slice(0, 2), WEB_SEARCH_QUERIES.slice(2), undefined]
        : [undefined, undefined, undefined];

      async function* stream(): AsyncGenerator<GenerateContentResponse> {
        for (const [index, piece] of pieces.entries()) {
          const last = index === pieces.length - 1;
          yield sdkResponse({
            text: piece,
            // Usage arrives cumulatively, with the totals on the final chunk —
            // the assumption generateContentPlan's "last one seen" is built on.
            usageMetadata: last ? USAGE[kind] : undefined,
            webSearchQueries: queriesByChunk[index],
            finishReason: last ? FinishReason.STOP : undefined,
          });
        }
      }
      return stream();
    },
  };

  readonly batches = {
    create: async (params: { model: string; src: unknown }): Promise<BatchJob> => {
      const requests = (Array.isArray(params.src) ? params.src : []) as InlinedRequest[];
      // Validated at submission, not at collection: a batch whose requests carry
      // a schema this fake cannot answer should fail where it was built.
      for (const request of requests) classifySchema(request.config?.responseJsonSchema);

      const name = `batches/fake-${nextId()}`;
      this.submitted.set(name, requests);
      this.calls.push({
        kind: "batches.create",
        responseKind: null,
        model: params.model,
        params,
        groundingQueries: 0,
      });

      return { name, model: params.model, state: JobState.JOB_STATE_PENDING, createTime: new Date().toISOString() };
    },

    get: async (params: { name: string }): Promise<BatchJob> => {
      const requests = this.submitted.get(params.name);
      if (!requests) throw new Error(`ai-fake: no such batch job "${params.name}"`);

      this.calls.push({
        kind: "batches.get",
        responseKind: null,
        params,
        groundingQueries: 0,
      });

      const state = this.controls.batchState;
      if (state !== JobState.JOB_STATE_SUCCEEDED) {
        return { name: params.name, state };
      }

      const inlinedResponses: InlinedResponse[] = requests.map((request) => {
        const metadata = request.metadata ?? {};
        const customId = metadata["custom_id"];
        const failure = customId === undefined ? undefined : this.controls.batchEntryErrors.get(customId);
        if (failure) return { metadata, error: failure };

        const kind = classifySchema(request.config?.responseJsonSchema);
        const payload = PAYLOADS[kind];
        validate(payload, request.config?.responseJsonSchema);

        // Round-tripped through JSON, which is what the SDK hands back for
        // `inlinedResponses` and is the whole reason `responseText` has a parts
        // fallback: a prototype-less object's `text` getter is `undefined`, and
        // reading that as an empty answer would fail every analysis in the batch
        // while still billing for it.
        const response = JSON.parse(
          JSON.stringify(sdkResponse({ text: JSON.stringify(payload), usageMetadata: USAGE[kind] })),
        ) as GenerateContentResponse;

        return { metadata, response };
      });

      return {
        name: params.name,
        state,
        dest: { inlinedResponses },
        endTime: new Date().toISOString(),
      };
    },
  };

  /** Forget every recorded call and every submitted batch. */
  reset(): void {
    this.calls.length = 0;
    this.submitted.clear();
    this.controls.batchState = JobState.JOB_STATE_SUCCEEDED;
    this.controls.batchEntryErrors.clear();
  }

  /** Calls of one kind, for the common "what did the app send?" assertion. */
  callsOf(kind: FakeCall["kind"]): FakeCall[] {
    return this.calls.filter((call) => call.kind === kind);
  }

  private record(
    params: GenerateContentParameters,
    as: FakeCall["kind"] = "generateContent",
  ): FakeResponseKind {
    const schema = params.config?.responseJsonSchema;
    const kind = classifySchema(schema);
    // The canned answer is checked against the caller's own schema on every
    // call, not once at module load: the schema travels with the request, and
    // this is the only place both halves are in the same scope.
    validate(PAYLOADS[kind], schema);

    this.calls.push({
      kind: as,
      responseKind: kind,
      model: params.model,
      params,
      usageMetadata: USAGE[kind],
      groundingQueries: isGrounded(params) ? WEB_SEARCH_QUERIES.length : 0,
    });
    return kind;
  }
}

// ---------------------------------------------------------------------------
// the seam
// ---------------------------------------------------------------------------

/**
 * Whether this process talks to the fake instead of Google (§1.16).
 *
 * Two ways in. `GEMINI_FAKE=1` is the explicit one, and the one CI sets. The
 * second — no key at all under `NODE_ENV=test` — exists so a test run that
 * forgets the flag fails on an assertion rather than reaching for a credential
 * it does not have, or worse, finding one.
 */
export function fakeGeminiEnabled(): boolean {
  if (process.env.GEMINI_FAKE === "1") return true;
  return process.env.NODE_ENV === "test" && !process.env.GEMINI_API_KEY;
}

let shared: FakeGemini | undefined;

/**
 * The process-wide fake. One instance, so a test can read `calls` after driving
 * a route that constructed its own client reference several modules away.
 */
export function fakeGeminiClient(): FakeGemini {
  shared ??= new FakeGemini();
  return shared;
}

/** Drop every recorded call — call it between tests, as `resetTables` is called. */
export function resetFakeGemini(): void {
  shared?.reset();
}
