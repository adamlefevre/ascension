/** Display helpers. Pass the owner's timezone on the server; omit it in the browser to use local time. */

export function fmtTime(d: Date, tz?: string) {
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz });
}

export function fmtDay(d: Date, tz?: string) {
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: tz });
}

export function fmtDayTime(d: Date, tz?: string) {
  return `${fmtDay(d, tz)}, ${fmtTime(d, tz)}`;
}

export function fmtDuration(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** Date -> value for <input type="datetime-local"> in the browser's timezone. */
export function toLocalInput(d: Date | null | undefined) {
  if (!d) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fromLocalInput(v: string): string | null {
  return v ? new Date(v).toISOString() : null;
}

export const PRIORITIES = [
  { value: 1, label: "Urgent" },
  { value: 2, label: "High" },
  { value: 3, label: "Normal" },
  { value: 4, label: "Low" },
] as const;

export function minutesToClock(min: number) {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

export function clockToMinutes(v: string) {
  const [h, m] = v.split(":").map(Number);
  return h * 60 + (m || 0);
}
