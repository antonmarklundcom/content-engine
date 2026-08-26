// Bridge to the `yt` repo (YouTube Intelligence Workspace). That system
// ingests YouTube videos/channels and runs a structured AI analysis once per
// video, storing summary/takeaways/hook-breakdown/ideas/topics/entities
// forever (see yt's src/db/schema.ts `analyses` table). Rather than
// duplicating that pipeline, content-engine reads it read-only as a research
// source: track Paraguay-relevant channels in yt, then pull their analyses
// here as raw material for ideation.
//
// Usage: tsx scripts/pull-yt-insights.ts --keyword paraguay --keyword residency [--limit 20]
//
// Requires YT_DATABASE_URL in .env — point it at the SAME Hostinger MySQL
// instance yt uses (a separate read-only DB user is recommended: this script
// only ever SELECTs). The two repos stay decoupled — content-engine never
// writes to yt's tables, and yt has no dependency on content-engine at all.
import "dotenv/config";
import mysql from "mysql2/promise";

function args(name: string): string[] {
  const out: string[] = [];
  process.argv.forEach((a, i) => {
    if (a === `--${name}`) out.push(process.argv[i + 1]);
  });
  return out;
}

const keywords = args("keyword");
const limit = Number(process.argv.find((_, i) => process.argv[i - 1] === "--limit") ?? 20);

if (!process.env.YT_DATABASE_URL) {
  console.error("Set YT_DATABASE_URL in .env — point it at the `yt` repo's MySQL database.");
  process.exit(1);
}
if (keywords.length === 0) {
  console.error("Usage: pull-yt-insights -- --keyword paraguay --keyword residency [--limit 20]");
  process.exit(1);
}

const conn = await mysql.createConnection(process.env.YT_DATABASE_URL);

// Match against title, topics, entities and content_type — cheap LIKE scan,
// fine at yt's current scale. Revisit with a real search index if the video
// count grows large.
const likeClauses = keywords
  .map(() => `(v.title LIKE ? OR a.topics LIKE ? OR a.entities LIKE ? OR a.content_type LIKE ?)`)
  .join(" OR ");
const likeParams = keywords.flatMap((k) => Array(4).fill(`%${k}%`));

const [rows] = await conn.execute(
  `SELECT v.title, v.channel_title, v.youtube_id, v.published_at,
          a.summary, a.takeaways, a.hook_breakdown, a.ideas, a.topics, a.entities
   FROM analyses a
   JOIN videos v ON v.id = a.video_id
   WHERE a.status = 'ok' AND (${likeClauses})
   ORDER BY v.published_at DESC
   LIMIT ?`,
  [...likeParams, limit],
);

console.log(JSON.stringify(rows, null, 2));
await conn.end();
