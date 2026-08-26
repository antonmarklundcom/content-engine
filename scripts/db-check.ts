import { db } from "../src/db";
import { sql } from "drizzle-orm";

const result = await db.execute(sql`SELECT 1 as ok`);
console.log("DB connection OK:", result.rows[0]);
process.exit(0);
