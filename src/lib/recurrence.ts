import { and, eq, inArray, lt } from "drizzle-orm";
import * as rrulePkg from "rrule";
import { getDb, schema } from "@/db/client";
import type { Settings } from "@/db/schema";
import { addDays, dayKey, localDay, localToInstant } from "./time";

// rrule ships CommonJS; depending on the bundler the exports sit on the namespace or on .default.
const rr = ((rrulePkg as unknown as { default?: typeof rrulePkg }).default ?? rrulePkg) as typeof rrulePkg;

/** Local calendar days (YYYY-MM-DD) on which `rule` occurs, between two local days inclusive. */
export function occurrenceDays(rule: string, firstDay: string, from: string, to: string): string[] {
  const utc = (k: string) => new Date(`${k}T00:00:00Z`);
  const set = rr.rrulestr(rule.replace(/^RRULE:/i, ""), { dtstart: utc(firstDay) });
  return set.between(utc(from), utc(to), true).map((d) => d.toISOString().slice(0, 10));
}

export function isValidRule(rule: string): boolean {
  try {
    rr.rrulestr(rule.replace(/^RRULE:/i, ""), { dtstart: new Date(Date.UTC(2026, 0, 1)) });
    return true;
  } catch {
    return false;
  }
}

/**
 * Turn recurring templates into concrete tasks for each occurrence inside the
 * horizon. Missed occurrences from earlier days are dropped, not carried over.
 */
export async function materializeRecurring(settings: Settings, now: number) {
  const db = await getDb();
  const tz = settings.timezone;
  const today = localDay(now, tz);
  const todayKey = dayKey(today);
  const lastKey = dayKey(addDays(today, settings.horizonDays - 1));

  await db
    .delete(schema.tasks)
    .where(
      and(
        eq(schema.tasks.status, "todo"),
        eq(schema.tasks.isTemplate, false),
        lt(schema.tasks.instanceDate, todayKey),
      ),
    );

  const templates = await db.select().from(schema.tasks).where(eq(schema.tasks.isTemplate, true));
  if (!templates.length) return;
  const existing = await db
    .select({ templateId: schema.tasks.templateId, instanceDate: schema.tasks.instanceDate })
    .from(schema.tasks)
    .where(inArray(schema.tasks.templateId, templates.map((t) => t.id)));
  const have = new Set(existing.map((e) => `${e.templateId}|${e.instanceDate}`));

  for (const t of templates) {
    if (!t.recurrenceRule) continue;
    const first = dayKey(localDay(t.createdAt.getTime(), tz));
    let days: string[] = [];
    try {
      days = occurrenceDays(t.recurrenceRule, first, todayKey, lastKey);
    } catch {
      continue;
    }
    for (const k of days) {
      if (have.has(`${t.id}|${k}`)) continue;
      const [y, m, d] = k.split("-").map(Number);
      const day = { y, m: m - 1, d };
      await db.insert(schema.tasks).values({
        title: t.title,
        notes: t.notes,
        durationMinutes: t.durationMinutes,
        priority: t.priority,
        projectId: t.projectId,
        splittable: t.splittable,
        templateId: t.id,
        instanceDate: k,
        earliestStart: new Date(localToInstant(day, 0, tz)),
        deadline: new Date(localToInstant({ ...day, d: d + 1 }, 0, tz)),
        deadlineHard: false,
      });
    }
  }
}
