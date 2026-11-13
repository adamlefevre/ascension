import { and, eq, gt, inArray, lt, lte } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import type { ScheduleReport } from "@/db/schema";
import { ensureCalendars, getProvider } from "./calendar";
import type { CalendarProvider } from "./calendar/provider";
import { materializeRecurring } from "./recurrence";
import { schedule, type ScheduleResult } from "./scheduler/engine";
import { getSettings } from "./settings";
import { DAY } from "./time";

const g = globalThis as unknown as { __ascensionReschedule?: Promise<unknown> };

/**
 * Recompute the plan and apply only what changed. Calls are serialised so two
 * triggers (say a webhook and a button click) cannot interleave.
 */
export function reschedule(now: number = Date.now()): Promise<ScheduleResult> {
  const run = (g.__ascensionReschedule ?? Promise.resolve()).catch(() => {}).then(() => doReschedule(now));
  g.__ascensionReschedule = run;
  return run;
}

async function doReschedule(now: number): Promise<ScheduleResult> {
  const db = await getDb();
  const settings = await getSettings();
  await materializeRecurring(settings, now);

  const nowDate = new Date(now);
  const horizonEnd = new Date(now + (settings.horizonDays + 1) * DAY);

  const todo = await db
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.status, "todo"), eq(schema.tasks.isTemplate, false)));
  const todoIds = todo.map((t) => t.id);

  const busyEvents = await db
    .select({ start: schema.events.start, end: schema.events.end })
    .from(schema.events)
    .innerJoin(schema.calendars, eq(schema.events.calendarId, schema.calendars.id))
    .where(
      and(
        eq(schema.calendars.countsAsBusy, true),
        eq(schema.calendars.isAscension, false),
        eq(schema.events.allDay, false),
        eq(schema.events.transparent, false),
        gt(schema.events.end, nowDate),
        lt(schema.events.start, horizonEnd),
      ),
    );
  const bookings = await db
    .select({ start: schema.bookings.start, end: schema.bookings.end })
    .from(schema.bookings)
    .where(gt(schema.bookings.end, nowDate));

  const existing = todoIds.length
    ? await db.select().from(schema.taskBlocks).where(inArray(schema.taskBlocks.taskId, todoIds))
    : [];

  // Blocks that ended without the task being completed are dropped; the work gets planned again.
  const stale = existing.filter((b) => b.end.getTime() <= now);
  const live = existing.filter((b) => b.end.getTime() > now);
  const isFixed = (b: (typeof existing)[number]) => b.pinned || b.start.getTime() <= now;
  const fixed = live.filter(isFixed);
  const movable = live.filter((b) => !isFixed(b));

  const result = schedule({
    now,
    settings,
    tasks: todo.map((t) => ({
      id: t.id,
      durationMinutes: t.durationMinutes,
      priority: t.priority,
      deadline: t.deadline?.getTime() ?? null,
      earliestStart: t.earliestStart?.getTime() ?? null,
      blockedByTaskId: t.blockedByTaskId,
      splittable: t.splittable,
      createdAt: t.createdAt.getTime(),
    })),
    busy: [...busyEvents, ...bookings].map((e) => ({ start: e.start.getTime(), end: e.end.getTime() })),
    fixedBlocks: fixed.map((b) => ({ taskId: b.taskId, start: b.start.getTime(), end: b.end.getTime() })),
  });

  const key = (b: { taskId: string; start: number; end: number }) => `${b.taskId}|${b.start}|${b.end}`;
  const planned = result.blocks.filter((b) => !b.fixed);
  const plannedKeys = new Set(planned.map(key));
  const keptKeys = new Set<string>();
  const toDelete = [...stale];
  for (const b of movable) {
    const k = key({ taskId: b.taskId, start: b.start.getTime(), end: b.end.getTime() });
    if (plannedKeys.has(k) && !keptKeys.has(k)) keptKeys.add(k);
    else toDelete.push(b);
  }
  const toInsert = planned.filter((b) => !keptKeys.has(key(b)));

  const report: ScheduleReport = {
    ranAt: nowDate.toISOString(),
    unscheduled: result.unscheduled,
    atRisk: result.atRisk.map((r) => ({
      taskId: r.taskId,
      finishesAt: new Date(r.finishesAt).toISOString(),
      deadline: new Date(r.deadline).toISOString(),
    })),
  };

  await db.transaction(async (tx) => {
    if (toDelete.length) {
      await tx.delete(schema.taskBlocks).where(inArray(schema.taskBlocks.id, toDelete.map((b) => b.id)));
    }
    if (toInsert.length) {
      await tx.insert(schema.taskBlocks).values(
        toInsert.map((b) => ({ taskId: b.taskId, start: new Date(b.start), end: new Date(b.end) })),
      );
    }
    await tx.update(schema.settings).set({ scheduleReport: report }).where(eq(schema.settings.id, 1));
  });

  await pushBlocks(toDelete.map((b) => b.externalEventId).filter((id): id is string => !!id));
  return result;
}

/**
 * Mirror task blocks to the provider's Ascension calendar: remove events for
 * deleted blocks and create events for blocks that do not have one yet.
 * Failures are logged, not thrown: the local plan is the source of truth and
 * the next run retries anything still missing.
 */
export async function pushBlocks(deletedEventIds: string[] = [], provider?: CalendarProvider) {
  try {
    const p = provider ?? (await getProvider());
    if (p.kind === "local") return;
    const db = await getDb();
    const { ascensionId } = await ensureCalendars(p);

    for (const id of deletedEventIds) {
      await p.deleteEvent(ascensionId, id).catch((e) => console.error("delete block event failed", e));
    }

    const pending = await db
      .select({ block: schema.taskBlocks, title: schema.tasks.title, notes: schema.tasks.notes })
      .from(schema.taskBlocks)
      .innerJoin(schema.tasks, eq(schema.taskBlocks.taskId, schema.tasks.id))
      .where(and(lte(schema.taskBlocks.start, new Date(Date.now() + 60 * DAY))));
    for (const { block, title, notes } of pending) {
      if (block.externalEventId) continue;
      const { id } = await p.createEvent(ascensionId, {
        title,
        description: notes ?? undefined,
        start: block.start,
        end: block.end,
        blockId: block.id,
      });
      await db.update(schema.taskBlocks).set({ externalEventId: id }).where(eq(schema.taskBlocks.id, block.id));
    }
  } catch (e) {
    console.error("pushBlocks failed", e);
  }
}
