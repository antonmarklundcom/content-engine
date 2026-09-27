/**
 * Cloudflare Worker entry (PLAN.md §1.43). Runs on the free plan, so Telegram
 * capture works while Anton's PC is off. All logic lives in handler.ts.
 */

import { neon } from "@neondatabase/serverless";
import { handleWebhook, type Env, type Query } from "./handler";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!env.DATABASE_URL) return new Response("DATABASE_URL is not set", { status: 500 });
    const sql = neon(env.DATABASE_URL);
    const query: Query = (text, params) =>
      sql(text, params) as unknown as Promise<Record<string, unknown>[]>;
    return handleWebhook(request, env, query);
  },
};
