/**
 * Which Postgres driver a connection string wants (PLAN.md §1.13).
 *
 * Production is Neon over HTTP; CI and a developer's laptop are a plain
 * Postgres server that has no HTTP endpoint at all. Both speak the same SQL and
 * run the same migrations, so the only thing that has to change between them is
 * the transport — and the connection string already says which one it is.
 *
 * Kept in its own module, free of any driver import, so the rule can be unit
 * tested without a database or a network: `src/db/driver.test.ts` is the proof
 * that `*.neon.tech` still picks neon and `localhost` still picks pg, which is
 * the one thing about this file that must never quietly drift.
 */

export type DbDriver = "neon" | "pg";

/** Neon's HTTP endpoints all live under this domain. */
const NEON_HOST_SUFFIX = ".neon.tech";

/**
 * `DB_DRIVER` overrides the hostname rule in both directions — a Neon branch
 * proxied through a local tunnel, or a self-hosted Postgres that happens to sit
 * behind a neon.tech CNAME. An unrecognised value throws rather than falling
 * back: a typo'd override that silently picked the wrong driver would surface
 * as a confusing connection error much further downstream.
 */
export function resolveDriver(
  url: string | undefined,
  override: string | undefined = process.env.DB_DRIVER,
): DbDriver {
  const forced = override?.trim().toLowerCase();
  if (forced) {
    if (forced === "neon" || forced === "pg") return forced;
    throw new Error(`DB_DRIVER must be "neon" or "pg", got "${override}".`);
  }

  if (!url) {
    throw new Error(
      "DATABASE_URL is not set — see .env.example (a Neon connection string in " +
        "production, a local postgres:// URL for tests).",
    );
  }

  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    throw new Error(
      `DATABASE_URL is not a valid connection URL. Expected postgres://user:pass@host/db.`,
    );
  }

  return host === "neon.tech" || host.endsWith(NEON_HOST_SUFFIX) ? "neon" : "pg";
}
