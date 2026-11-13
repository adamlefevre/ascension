import { TZDate } from "@date-fns/tz";

export const MIN = 60_000;
export const DAY = 24 * 60 * MIN;

export type LocalDay = { y: number; m: number; d: number; weekday: number };

/** The calendar day that instant `t` falls on in `tz`. */
export function localDay(t: number, tz: string): LocalDay {
  const z = new TZDate(t, tz);
  return { y: z.getFullYear(), m: z.getMonth(), d: z.getDate(), weekday: z.getDay() };
}

/** Instant for `minutes` after local midnight of a calendar day in `tz` (DST-safe). */
export function localToInstant(day: { y: number; m: number; d: number }, minutes: number, tz: string): number {
  return new TZDate(day.y, day.m, day.d, Math.floor(minutes / 60), minutes % 60, 0, tz).getTime();
}

/** Calendar day `n` days after `day` (weekday recomputed). */
export function addDays(day: LocalDay, n: number): LocalDay {
  const u = new Date(Date.UTC(day.y, day.m, day.d + n));
  return { y: u.getUTCFullYear(), m: u.getUTCMonth(), d: u.getUTCDate(), weekday: u.getUTCDay() };
}

export function dayKey(day: { y: number; m: number; d: number }): string {
  return `${day.y}-${String(day.m + 1).padStart(2, "0")}-${String(day.d).padStart(2, "0")}`;
}

export function ceilTo(t: number, stepMinutes: number): number {
  const step = stepMinutes * MIN;
  return Math.ceil(t / step) * step;
}
