import { eq, notInArray } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { LocalProvider } from "./local";
import type { CalendarProvider } from "./provider";

const g = globalThis as unknown as { __ascensionProvider?: CalendarProvider | null };

/** Tests can inject a provider; pass null to go back to automatic selection. */
export function setProviderForTests(p: CalendarProvider | null) {
  g.__ascensionProvider = p;
}

export async function getProvider(): Promise<CalendarProvider> {
  if (g.__ascensionProvider) return g.__ascensionProvider;
  const db = await getDb();
  const [account] = await db.select().from(schema.googleAccount).where(eq(schema.googleAccount.id, 1));
  if (account?.refreshToken && process.env.AUTH_GOOGLE_ID) {
    const { GoogleProvider } = await import("./google");
    return new GoogleProvider();
  }
  return new LocalProvider();
}

/**
 * Bring our calendars table in line with the provider: add new calendars,
 * drop ones that no longer exist (their mirrored events go with them), and
 * make sure the Ascension calendar exists.
 */
export async function ensureCalendars(provider: CalendarProvider) {
  const db = await getDb();
  const asc = await provider.ensureAscensionCalendar();
  const list = await provider.listCalendars();
  const all = [...list.filter((c) => c.id !== asc.id), asc];
  for (const c of all) {
    const isAscension = c.id === asc.id;
    await db
      .insert(schema.calendars)
      .values({ id: c.id, name: c.name, color: c.color, isPrimary: c.isPrimary, isAscension, countsAsBusy: !isAscension })
      .onConflictDoUpdate({
        target: schema.calendars.id,
        set: { name: c.name, color: c.color, isPrimary: c.isPrimary, isAscension },
      });
  }
  await db.delete(schema.calendars).where(notInArray(schema.calendars.id, all.map((c) => c.id)));
  return { ascensionId: asc.id, primaryId: list.find((c) => c.isPrimary)?.id ?? list[0]?.id ?? asc.id };
}

/** Ids of the Ascension and primary calendars, from our table when known (no provider round trip). */
export async function calendarIds(provider: CalendarProvider) {
  const db = await getDb();
  const rows = await db.select().from(schema.calendars);
  const mine = rows.filter((r) => r.id.startsWith("local-") === (provider.kind === "local"));
  const asc = mine.find((r) => r.isAscension);
  const primary = mine.find((r) => r.isPrimary);
  if (asc && primary) return { ascensionId: asc.id, primaryId: primary.id };
  return ensureCalendars(provider);
}
