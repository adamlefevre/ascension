import { addDays, ceilTo, localDay, localToInstant, MIN } from "../time";
import { merge, subtract, subtractAll, type Interval } from "./intervals";

/**
 * The scheduling engine. A pure function: same inputs, same plan.
 * All times are epoch milliseconds.
 */

export type SchedulerTask = {
  id: string;
  durationMinutes: number;
  priority: number; // 1 urgent .. 4 low
  deadline: number | null;
  earliestStart: number | null;
  blockedByTaskId: string | null;
  splittable: boolean;
  createdAt: number;
};

/** A block the engine must leave where it is (pinned by the user, or already under way). */
export type FixedBlock = { taskId: string; start: number; end: number };

export type SchedulerSettings = {
  timezone: string;
  workingHours: { day: number; start: number; end: number }[];
  minBlockMinutes: number;
  maxBlockMinutes: number;
  bufferMinutes: number;
  horizonDays: number;
};

export type PlannedBlock = { taskId: string; start: number; end: number; fixed: boolean };

export type ScheduleResult = {
  blocks: PlannedBlock[];
  unscheduled: { taskId: string; reason: string }[];
  atRisk: { taskId: string; finishesAt: number; deadline: number }[];
};

export type ScheduleInput = {
  tasks: SchedulerTask[];
  busy: Interval[];
  fixedBlocks: FixedBlock[];
  settings: SchedulerSettings;
  now: number;
};

const GRID_MINUTES = 15;

/** Working-hours windows from `now` to the end of the horizon. */
export function workingWindows(settings: SchedulerSettings, now: number): Interval[] {
  const start = ceilTo(now, GRID_MINUTES);
  const today = localDay(start, settings.timezone);
  const out: Interval[] = [];
  for (let i = 0; i < settings.horizonDays; i++) {
    const day = addDays(today, i);
    for (const wh of settings.workingHours) {
      if (wh.day !== day.weekday || wh.end <= wh.start) continue;
      const s = Math.max(localToInstant(day, wh.start, settings.timezone), start);
      const e = localToInstant(day, wh.end, settings.timezone);
      if (e > s) out.push({ start: s, end: e });
    }
  }
  return merge(out);
}

/** Urgent first, then earliest deadline, then priority, then oldest. */
function compareTasks(a: SchedulerTask, b: SchedulerTask): number {
  const ua = a.priority === 1 ? 0 : 1;
  const ub = b.priority === 1 ? 0 : 1;
  if (ua !== ub) return ua - ub;
  const da = a.deadline ?? Infinity;
  const db = b.deadline ?? Infinity;
  if (da !== db) return da - db;
  if (a.priority !== b.priority) return a.priority - b.priority;
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return a.id < b.id ? -1 : 1;
}

export function schedule(input: ScheduleInput): ScheduleResult {
  const { settings, now } = input;
  const buffer = settings.bufferMinutes * MIN;
  const minBlock = Math.max(settings.minBlockMinutes, GRID_MINUTES) * MIN;
  const maxBlock = Math.max(settings.maxBlockMinutes, settings.minBlockMinutes) * MIN;

  const taskIds = new Set(input.tasks.map((t) => t.id));
  const fixed = input.fixedBlocks.filter((b) => taskIds.has(b.taskId));

  let free = subtractAll(workingWindows(settings, now), merge(input.busy));
  for (const b of fixed) free = subtract(free, { start: b.start - buffer, end: b.end + buffer });

  const blocks: PlannedBlock[] = fixed.map((b) => ({ ...b, fixed: true }));
  const unscheduled: ScheduleResult["unscheduled"] = [];
  const finishAt = new Map<string, number>(); // taskId -> end of its last block
  const failed = new Set<string>();

  const pending = [...input.tasks].sort(compareTasks);
  while (pending.length) {
    // First task (in priority order) whose blocker is already settled.
    let idx = pending.findIndex((t) => {
      const dep = t.blockedByTaskId;
      return !dep || !taskIds.has(dep) || finishAt.has(dep) || failed.has(dep);
    });
    const cyclic = idx === -1;
    if (cyclic) idx = 0;
    const task = pending.splice(idx, 1)[0];

    if (cyclic) {
      failed.add(task.id);
      unscheduled.push({ taskId: task.id, reason: "Circular dependency between tasks" });
      continue;
    }
    const dep = task.blockedByTaskId && taskIds.has(task.blockedByTaskId) ? task.blockedByTaskId : null;
    if (dep && failed.has(dep)) {
      failed.add(task.id);
      unscheduled.push({ taskId: task.id, reason: "Waiting on a task that could not be scheduled" });
      continue;
    }

    const mine = fixed.filter((b) => b.taskId === task.id);
    const fixedMs = mine.reduce((sum, b) => sum + (b.end - b.start), 0);
    let need = task.durationMinutes * MIN - fixedMs;
    const earliest = Math.max(now, task.earliestStart ?? 0, dep ? finishAt.get(dep)! + buffer : 0);

    const placed: Interval[] = [];
    let trial = free;
    if (need > 0) {
      const usable = () =>
        trial
          .map((f) => ({ start: ceilTo(Math.max(f.start, earliest), GRID_MINUTES), end: f.end }))
          .filter((f) => f.end > f.start);
      if (!task.splittable || need <= minBlock) {
        const slot = usable().find((f) => f.end - f.start >= need);
        if (slot) {
          placed.push({ start: slot.start, end: slot.start + need });
          need = 0;
        }
      } else {
        // Each pass re-reads the free list, so the buffer after a chunk is honoured.
        for (;;) {
          const slot = usable().find((f) => f.end - f.start >= Math.min(need, minBlock));
          if (!slot) break;
          const len = Math.min(need, maxBlock, slot.end - slot.start);
          const chunk = { start: slot.start, end: slot.start + len };
          placed.push(chunk);
          trial = subtract(trial, { start: chunk.start - buffer, end: chunk.end + buffer });
          need -= len;
          if (need <= 0) break;
        }
      }
    }

    if (need > 0) {
      failed.add(task.id);
      unscheduled.push({
        taskId: task.id,
        reason: `No free time in the next ${settings.horizonDays} days`,
      });
      continue;
    }

    for (const p of placed) {
      free = subtract(free, { start: p.start - buffer, end: p.end + buffer });
      blocks.push({ taskId: task.id, start: p.start, end: p.end, fixed: false });
    }
    const ends = [...mine, ...placed].map((b) => b.end);
    finishAt.set(task.id, ends.length ? Math.max(...ends) : now);
  }

  const atRisk: ScheduleResult["atRisk"] = [];
  for (const t of input.tasks) {
    const end = finishAt.get(t.id);
    if (t.deadline != null && end != null && end > t.deadline) {
      atRisk.push({ taskId: t.id, finishesAt: end, deadline: t.deadline });
    }
  }

  blocks.sort((a, b) => a.start - b.start || (a.taskId < b.taskId ? -1 : 1));
  return { blocks, unscheduled, atRisk };
}
