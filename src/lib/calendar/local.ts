import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import type { CalendarProvider, EventInput, ProviderCalendar } from "./provider";

export const LOCAL_PRIMARY = "local-primary";
export const LOCAL_ASCENSION = "local-ascension";

/**
 * Used when no Google account is connected. Our events table is the calendar,
 * so there is nothing to sync; creating an event just writes a row.
 */
export class LocalProvider implements CalendarProvider {
  readonly kind = "local" as const;

  async listCalendars(): Promise<ProviderCalendar[]> {
    return [{ id: LOCAL_PRIMARY, name: "My calendar", color: "#0ea5e9", isPrimary: true }];
  }

  async ensureAscensionCalendar(): Promise<ProviderCalendar> {
    return { id: LOCAL_ASCENSION, name: "Ascension", color: "#6366f1", isPrimary: false };
  }

  async listEvents() {
    return [];
  }

  async createEvent(calendarId: string, input: EventInput) {
    const id = randomUUID();
    if (calendarId !== LOCAL_ASCENSION) {
      const db = await getDb();
      await db.insert(schema.events).values({
        calendarId,
        externalId: id,
        title: input.title,
        start: input.start,
        end: input.end,
      });
    }
    return { id };
  }

  async updateEvent(calendarId: string, eventId: string, input: EventInput) {
    if (calendarId === LOCAL_ASCENSION) return;
    const db = await getDb();
    await db
      .update(schema.events)
      .set({ title: input.title, start: input.start, end: input.end })
      .where(and(eq(schema.events.calendarId, calendarId), eq(schema.events.externalId, eventId)));
  }

  async deleteEvent(calendarId: string, eventId: string) {
    if (calendarId === LOCAL_ASCENSION) return;
    const db = await getDb();
    await db
      .delete(schema.events)
      .where(and(eq(schema.events.calendarId, calendarId), eq(schema.events.externalId, eventId)));
  }
}
