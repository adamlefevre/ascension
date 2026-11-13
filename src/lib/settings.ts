import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import type { Settings, WorkingHours } from "@/db/schema";

export const DEFAULT_WORKING_HOURS: WorkingHours = [1, 2, 3, 4, 5].map((day) => ({
  day,
  start: 9 * 60,
  end: 17 * 60,
}));

export async function getSettings(): Promise<Settings> {
  const db = await getDb();
  const [row] = await db.select().from(schema.settings).where(eq(schema.settings.id, 1));
  if (row) return row;
  const [created] = await db
    .insert(schema.settings)
    .values({
      id: 1,
      timezone: process.env.DEFAULT_TIMEZONE ?? "America/New_York",
      workingHours: DEFAULT_WORKING_HOURS,
    })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  const [again] = await db.select().from(schema.settings).where(eq(schema.settings.id, 1));
  return again;
}
