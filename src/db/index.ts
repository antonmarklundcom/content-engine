import "dotenv/config";
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "./schema";

function createDb() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set — see .env.example (a Neon Postgres connection string).");
  }
  return drizzle(neon(url), { schema });
}

let cached: ReturnType<typeof createDb> | undefined;

// Lazy: avoids throwing at import time during `next build`'s route analysis,
// which loads this module without env vars available.
export const db = new Proxy({} as ReturnType<typeof createDb>, {
  get(_target, prop, receiver) {
    if (!cached) cached = createDb();
    return Reflect.get(cached, prop, receiver);
  },
});

export { schema };
