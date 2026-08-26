// Usage: npm run idea:approve -- --idea 12 [--idea 13 --idea 14]
//        npm run idea:approve -- --reject --idea 15
import { db, schema } from "../src/db";
import { inArray } from "drizzle-orm";

function args(name: string): number[] {
  const out: number[] = [];
  process.argv.forEach((a, i) => {
    if (a === `--${name}`) out.push(Number(process.argv[i + 1]));
  });
  return out;
}

const reject = process.argv.includes("--reject");
const ideaIds = args("idea");

if (ideaIds.length === 0) {
  console.error("Usage: idea:approve -- --idea <id> [--idea <id> ...] [--reject]");
  process.exit(1);
}

await db
  .update(schema.ideas)
  .set({ status: reject ? "rejected" : "approved" })
  .where(inArray(schema.ideas.id, ideaIds));

console.log(`${reject ? "Rejected" : "Approved"}: ideas ${ideaIds.join(", ")}`);
process.exit(0);
