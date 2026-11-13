export type Interval = { start: number; end: number };

/** Sort and merge overlapping or touching intervals. */
export function merge(list: Interval[]): Interval[] {
  const sorted = list.filter((i) => i.end > i.start).sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
    else out.push({ ...i });
  }
  return out;
}

/** Remove `cut` from every interval in `free` (free must be sorted, non-overlapping). */
export function subtract(free: Interval[], cut: Interval): Interval[] {
  if (cut.end <= cut.start) return free;
  const out: Interval[] = [];
  for (const f of free) {
    if (cut.end <= f.start || cut.start >= f.end) {
      out.push(f);
      continue;
    }
    if (cut.start > f.start) out.push({ start: f.start, end: cut.start });
    if (cut.end < f.end) out.push({ start: cut.end, end: f.end });
  }
  return out;
}

export function subtractAll(free: Interval[], cuts: Interval[]): Interval[] {
  return cuts.reduce(subtract, free);
}

export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}
