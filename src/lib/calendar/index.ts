import { eq } from "drizzle-orm";
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

/** Make sure our calendars table reflects the provider, including the Ascension calendar. */
export async function ensureCalendars(provider: CalendarProvider) {
  const db = await getDb();
  const asc = await provider.ensureAscensionCalendar();
  const list = await provider.listCalendars();
  const all = [...list.filter((c) => c.id !== asc.id), asc];
  for (const c of all) {
    const isAscension = c.id === asc.id;
    await db
      .insert(schema.calendars)
      .values({
        id: c.id,
        name: c.name,
        color: c.color,
        isPrimary: c.isPrimary,
        isAscension,
        countsAsBusy: !isAscension,
      })
      .onConflictDoUpdate({
        target: schema.calendars.id,
        set: { name: c.name, color: c.color, isPrimary: c.isPrimary, isAscension },
      });
  }
  return { ascensionId: asc.id, primaryId: list.find((c) => c.isPrimary)?.id ?? list[0]?.id ?? asc.id };
}
