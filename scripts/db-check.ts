import { db } from "../src/db";
import { sql } from "drizzle-orm";

const result = db.get(sql`SELECT 1 as ok`);
console.log("DB connection OK:", result);
process.exit(0);
