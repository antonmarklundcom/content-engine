import "dotenv/config";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import mysql from "mysql2/promise";

const connection = await mysql.createConnection(process.env.DATABASE_URL as string);
const db = drizzle(connection);

await migrate(db, { migrationsFolder: "./drizzle" });
console.log("Migrations applied.");
await connection.end();
