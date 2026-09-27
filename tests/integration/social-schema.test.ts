import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

import { teardown } from "./setup";

/**
 * Migration 0007, the build 3 schema (PLAN.md §2, §5.O9.9).
 *
 * The shared test database is always fully migrated, so these tests make
 * their own throwaway databases on the same server: one empty, and one
 * stopped at build 2 (0006) with a `residency-guide` brand and rows pointing
 * at it, then migrated forward — the path every existing install takes.
 */

after(teardown);

const BUILD2_LAST = "0006_studio_extras";

function serverUrl(database: string): string {
  const url = new URL(process.env.DATABASE_URL ?? "");
  url.pathname = `/${database}`;
  return url.toString();
}

async function withDatabase(fn: (pool: Pool) => Promise<void>): Promise<void> {
  const name = `ce_o9_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
  const admin = new Pool({ connectionString: process.env.DATABASE_URL });
  await admin.query(`create database ${name}`);
  const pool = new Pool({ connectionString: serverUrl(name) });
  try {
    await fn(pool);
  } finally {
    await pool.end();
    await admin.query(`drop database if exists ${name} with (force)`);
    await admin.end();
  }
}

/** A copy of ./drizzle whose journal stops at `lastTag`. */
function migrationsUpTo(lastTag: string): string {
  const dir = mkdtempSync(join(tmpdir(), "ce-o9-"));
  cpSync("./drizzle", dir, { recursive: true });
  const journalPath = join(dir, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
    entries: Array<{ tag: string }>;
  };
  const end = journal.entries.findIndex((e) => e.tag === lastTag);
  assert.ok(end >= 0, `${lastTag} is in the journal`);
  journal.entries = journal.entries.slice(0, end + 1);
  writeFileSync(journalPath, JSON.stringify(journal));
  return dir;
}

test("the migrations apply to an empty database, and again as a no-op", async () => {
  await withDatabase(async (pool) => {
    await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
    await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
    const { rows } = await pool.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'public'`,
    );
    const tables = rows.map((r) => r.table_name);
    for (const table of [
      "brand_families",
      "brand_kits",
      "social_accounts",
      "integrations",
      "assets",
      "posts",
      "post_assets",
      "post_metrics",
      "account_metrics",
      "social_competitors",
      "competitor_posts",
    ]) {
      assert.ok(tables.includes(table), `${table} exists`);
    }
    assert.equal((await pool.query("select * from brands")).rowCount, 0, "no data on a fresh DB");
    assert.equal((await pool.query("select * from brand_families")).rowCount, 0);
  });
});

test("a build 2 database has residency-guide renamed to guide everywhere", async () => {
  const build2 = migrationsUpTo(BUILD2_LAST);
  try {
    await withDatabase(async (pool) => {
      await migrate(drizzle(pool), { migrationsFolder: build2 });

      // A build 2 install: the brand, and one row in every table that points at it.
      await pool.query(`
        insert into brands (id, name, domain, niche, market, language, voice, platforms)
        values ('residency-guide', 'Paraguay Residency Guide', 'paraguayresidencyguide.com',
                'residency', 'global', 'en', 'Tuned voice', '["instagram"]'),
               ('propia', 'Propia', 'propia.com.py', 'real estate', 'paraguay', 'es', null, '[]');
        insert into ideas (brand_id, title, angle, format, platform, draft_copy)
        values ('residency-guide', 'Idea', 'Angle', 'reel', 'instagram', 'Copy');
        insert into scripts (brand_id, title, language, body)
        values ('residency-guide', 'Script', 'en', '{}');
        insert into lessons (text, brand_id) values ('Lesson', 'residency-guide');
        insert into facts (brand_id, topic, claim) values ('residency-guide', 'visa', 'A claim');
        insert into facts (brand_id, topic, claim) values ('propia', 'tax', 'Un dato');
        insert into sources (kind, youtube_id, title, url)
        values ('channel', 'UC1', 'Channel', 'https://youtube.com/channel/UC1');
        insert into brand_sources (brand_id, source_id) values ('residency-guide', 1);
        insert into competitor_reports (brand_id, period_days, body)
        values ('residency-guide', 7, '{}');
        insert into audience_questions (brand_id, question) values ('residency-guide', 'Q?');
        insert into research_notes (topic, summary, market, related_brand_ids)
        values ('Visa', 'Summary', 'global', '["propia", "residency-guide"]');
        insert into clips (url) values ('https://example.com/clip');
      `);

      await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });

      const one = async (q: string) => (await pool.query(q)).rows;
      assert.deepEqual(
        await one(`select id, voice, family_id from brands where id like '%guide'`),
        [{ id: "guide", voice: "Tuned voice", family_id: "paraguay-residency" }],
      );
      for (const table of [
        "ideas",
        "scripts",
        "lessons",
        "brand_sources",
        "competitor_reports",
        "audience_questions",
      ]) {
        assert.deepEqual(
          await one(`select distinct brand_id from ${table}`),
          [{ brand_id: "guide" }],
          `${table} follows the rename`,
        );
      }
      assert.deepEqual(await one(`select related_brand_ids from research_notes`), [
        { related_brand_ids: ["propia", "guide"] },
      ]);
      assert.deepEqual(await one(`select name from brand_families`), [
        { name: "Paraguay residency" },
      ]);

      // Existing facts stay citable as they were: verified, in the brand's language.
      assert.deepEqual(
        await one(`select brand_id, language, verified, family_id from facts order by id`),
        [
          { brand_id: "guide", language: "en", verified: true, family_id: null },
          { brand_id: "propia", language: "es", verified: true, family_id: null },
        ],
      );

      // Old clips get the defaults, not nulls.
      assert.deepEqual(await one(`select purpose, source, tags, brand_id from clips`), [
        { purpose: "other", source: "web", tags: [], brand_id: null },
      ]);
    });
  } finally {
    rmSync(build2, { recursive: true, force: true });
  }
});

test("family facts are unique per key and language, hand-made facts are not constrained", async () => {
  await withDatabase(async (pool) => {
    await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
    await pool.query(`
      insert into facts (family_id, external_key, language, topic, claim)
      values ('f', 'k', 'en', 't', 'c'), ('f', 'k', 'es', 't', 'c');
      insert into facts (brand_id, topic, claim) values ('b', 't', 'same'), ('b', 't', 'same');
    `);
    await assert.rejects(
      pool.query(
        `insert into facts (family_id, external_key, language, topic, claim) values ('f', 'k', 'en', 't', 'c')`,
      ),
      /facts_family_key_language_idx/,
    );
  });
});
