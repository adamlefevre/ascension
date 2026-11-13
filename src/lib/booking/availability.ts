import { and, eq, gt, lt } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import type { BookingLink, Settings } from "@/db/schema";
import { merge, subtractAll, type Interval } from "../scheduler/intervals";
import { getSettings } from "../settings";
import { DAY, MIN, dayKey, localDay } from "../time";
import { workingWindows } from "../scheduler/engine";

/**
 * Bookable slots for a link. Busy = real events and existing bookings (with the
 * link's buffer). Task blocks are deliberately ignored: they move out of the
 * way when someone books over them.
 */
export function computeSlots(opts: {
  link: Pick<BookingLink, "durationMinutes" | "bufferMinutes" | "daysAhead" | "minNoticeHours" | "dailyLimit">;
  settings: Pick<Settings, "timezone" | "workingHours">;
  busy: Interval[];
  bookedStarts: number[];
  now: number;
}): number[] {
  const { link, settings, now } = opts;
  const dur = link.durationMinutes * MIN;
  const buf = link.bufferMinutes * MIN;
  const step = (link.durationMinutes <= 30 ? 15 : 30) * MIN;
  const earliest = now + link.minNoticeHours * 60 * MIN;
  const windows = workingWindows(
    { ...settings, horizonDays: link.daysAhead, minBlockMinutes: 15, maxBlockMinutes: 600, bufferMinutes: 0 },
    now,
  );
  const free = subtractAll(windows, merge(opts.busy.map((b) => ({ start: b.start - buf, end: b.end + buf }))));
  const perDay = new Map<string, number>();
  for (const s of opts.bookedStarts) {
    const k = dayKey(localDay(s, settings.timezone));
    perDay.set(k, (perDay.get(k) ?? 0) + 1);
  }
  const out: number[] = [];
  for (const f of free) {
    for (let t = Math.ceil(Math.max(f.start, earliest) / step) * step; t + dur <= f.end; t += step) {
      if (link.dailyLimit != null && (perDay.get(dayKey(localDay(t, settings.timezone))) ?? 0) >= link.dailyLimit) continue;
      out.push(t);
    }
  }
  return out;
}

export async function getActiveLink(slug: string) {
  const db = await getDb();
  const [link] = await db.select().from(schema.bookingLinks).where(and(eq(schema.bookingLinks.slug, slug), eq(schema.bookingLinks.active, true)));
  return link ?? null;
}

async function loadBusy(from: Date, to: Date) {
  const db = await getDb();
  const events = await db
    .select({ start: schema.events.start, end: schema.events.end })
    .from(schema.events)
    .innerJoin(schema.calendars, eq(schema.events.calendarId, schema.calendars.id))
    .where(and(eq(schema.calendars.countsAsBusy, true), eq(schema.calendars.isAscension, false), eq(schema.events.allDay, false), eq(schema.events.transparent, false), gt(schema.events.end, from), lt(schema.events.start, to)));
  const bookings = await db.select().from(schema.bookings).where(and(gt(schema.bookings.end, from), lt(schema.bookings.start, to)));
  return { events, bookings };
}

export async function slotsForLink(link: BookingLink, now = Date.now()) {
  const settings = await getSettings();
  const { events, bookings } = await loadBusy(new Date(now - DAY), new Date(now + (link.daysAhead + 1) * DAY));
  const slots = computeSlots({
    link,
    settings,
    now,
    busy: [...events, ...bookings].map((e) => ({ start: e.start.getTime(), end: e.end.getTime() })),
    bookedStarts: bookings.filter((b) => b.linkId === link.id).map((b) => b.start.getTime()),
  });
  return { timezone: settings.timezone, slots };
}

export class SlotTaken extends Error {
  constructor() {
    super("That time was just taken. Please pick another.");
  }
}

/** Re-check and record a booking. Serialised so two guests cannot take the same slot. */
const g = globalThis as unknown as { __ascensionBooking?: Promise<unknown> };
export function createBooking(link: BookingLink, start: number, guest: { name: string; email: string; note?: string | null }, now = Date.now()) {
  const run = (g.__ascensionBooking ?? Promise.resolve()).catch(() => {}).then(async () => {
    const { slots } = await slotsForLink(link, now);
    if (!slots.includes(start)) throw new SlotTaken();
    const db = await getDb();
    const end = new Date(start + link.durationMinutes * MIN);
    // Final guard against a booking written by another server instance.
    const clash = await db.select({ id: schema.bookings.id }).from(schema.bookings).where(and(lt(schema.bookings.start, end), gt(schema.bookings.end, new Date(start))));
    if (clash.length) throw new SlotTaken();
    const [booking] = await db.insert(schema.bookings).values({ linkId: link.id, guestName: guest.name, guestEmail: guest.email, note: guest.note ?? null, start: new Date(start), end }).returning();
    return booking;
  });
  g.__ascensionBooking = run;
  return run;
}

