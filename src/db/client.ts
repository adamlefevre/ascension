import { mkdirSync } from "node:fs";
import path from "node:path";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import * as schema from "./schema";

/**
 * With DATABASE_URL set we talk to Postgres (Neon in production).
 * Without it we run an embedded Postgres (PGlite) stored in .data/, so the
 * app works locally with no setup. Both speak the same SQL and migrations.
 */
export type DB = PgliteDatabase<typeof schema>;

const MIGRATIONS = path.join(process.cwd(), "drizzle");
const g = globalThis as unknown as { __ascensionDb?: Promise<DB> };

async function create(): Promise<DB> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const { default: postgres } = await import("postgres");
    const client = postgres(url, { max: 5, prepare: false });
    return drizzle(client, { schema }) as unknown as DB;
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const dir = process.env.PGLITE_DIR ?? path.join(process.cwd(), ".data", "pglite");
  if (dir !== "memory") mkdirSync(dir, { recursive: true });
  const client = dir === "memory" ? new PGlite() : new PGlite(dir);
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  return db;
}

export function getDb(): Promise<DB> {
  return (g.__ascensionDb ??= create());
}

/** Tests only: swap in a fresh in-memory database. */
export function resetDbForTests() {
  process.env.PGLITE_DIR = "memory";
  delete process.env.DATABASE_URL;
  g.__ascensionDb = undefined;
}

export { schema };
