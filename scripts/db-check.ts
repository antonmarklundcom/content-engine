import { db } from "../src/db";
import { sql } from "drizzle-orm";

const [row] = await db.execute(sql`SELECT 1 as ok`);
console.log("DB connection OK:", row);
process.exit(0);
