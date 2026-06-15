import { defineConfig } from "drizzle-kit";

/**
 * Migration generation for the relational `nodes`/`edges` tables only.
 * The `vec_nodes` virtual table is bootstrapped in raw SQL (db/vec.ts), since
 * no ORM models sqlite-vec's vec0 — this keeps the libsql migration path open.
 */
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dbCredentials: {
    url: process.env.DB_PATH ?? "./brain.db",
  },
});
