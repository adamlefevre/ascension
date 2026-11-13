import { describe, expect, it } from "vitest";
import { schedule, type ScheduleInput, type SchedulerSettings, type SchedulerTask } from "./engine";
import { overlaps } from "./intervals";
import { MIN } from "../time";

const NY = "America/New_York";
const settings: SchedulerSettings = {
  timezone: NY,
  workingHours: [1, 2, 3, 4, 5].map((day) => ({ day, start: 9 * 60, end: 17 * 60 })),
  minBlockMinutes: 30,
  maxBlockMinutes: 120,
  bufferMinutes: 0,
  horizonDays: 14,
};

// Monday 2026-11-16 08:00 New York (EST, UTC-5)
const MON_8 = Date.UTC(2026, 10, 16, 13, 0);
const ny = (day: number, h: number, m = 0) => Date.UTC(2026, 10, day, h + 5, m);

let seq = 0;
const task = (over: Partial<SchedulerTask> & { id: string }): SchedulerTask => ({
  durationMinutes: 60,
  priority: 3,
  deadline: null,
  earliestStart: null,
  blockedByTaskId: null,
  splittable: true,
  createdAt: seq++,
  ...over,
});
const run = (over: Partial<ScheduleInput>) =>
  schedule({ tasks: [], busy: [], fixedBlocks: [], settings, now: MON_8, ...over });
const blocksOf = (r: ReturnType<typeof run>, id: string) => r.blocks.filter((b) => b.taskId === id);

describe("schedule", () => {
  it("places a task at the start of working hours", () => {
    const r = run({ tasks: [task({ id: "a" })] });
    expect(r.blocks).toEqual([{ taskId: "a", start: ny(16, 9), end: ny(16, 10), fixed: false }]);
  });

  it("never overlaps busy events or leaves working hours", () => {
    const busy = [
      { start: ny(16, 9, 30), end: ny(16, 11) },
      { start: ny(16, 13), end: ny(16, 16, 30) },
    ];
    const tasks = Array.from({ length: 8 }, (_, i) => task({ id: `t${i}`, durationMinutes: 90 }));
    const r = run({ tasks, busy });
    expect(r.unscheduled).toEqual([]);
    for (const b of r.blocks) {
      for (const e of busy) expect(overlaps(b, e)).toBe(false);
      const h = new Date(b.start - 5 * 60 * MIN).getUTCHours();
      const endH = new Date(b.end - 5 * 60 * MIN - 1).getUTCHours();
      expect(h).toBeGreaterThanOrEqual(9);
      expect(endH).toBeLessThan(17);
      const wd = new Date(b.start - 5 * 60 * MIN).getUTCDay();
      expect(wd).toBeGreaterThanOrEqual(1);
      expect(wd).toBeLessThanOrEqual(5);
    }
    const sorted = [...r.blocks].sort((a, b) => a.start - b.start);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i].start).toBeGreaterThanOrEqual(sorted[i - 1].end);
  });

  it("orders by urgency, then deadline, then priority", () => {
    const r = run({
      tasks: [
        task({ id: "low", priority: 4 }),
        task({ id: "deadline", priority: 3, deadline: ny(17, 12) }),
        task({ id: "urgent", priority: 1 }),
        task({ id: "high", priority: 2 }),
      ],
    });
    expect(r.blocks.map((b) => b.taskId)).toEqual(["urgent", "deadline", "high", "low"]);
  });

  it("schedules a dependent task after its blocker", () => {
    const r = run({
      tasks: [task({ id: "second", priority: 1, blockedByTaskId: "first" }), task({ id: "first", priority: 4 })],
    });
    expect(blocksOf(r, "second")[0].start).toBeGreaterThanOrEqual(blocksOf(r, "first")[0].end);
  });

  it("reports circular dependencies instead of looping", () => {
    const r = run({
      tasks: [task({ id: "a", blockedByTaskId: "b" }), task({ id: "b", blockedByTaskId: "a" })],
    });
    expect(r.blocks).toEqual([]);
    expect(r.unscheduled.map((u) => u.taskId).sort()).toEqual(["a", "b"]);
  });

  it("splits long tasks into chunks no longer than the maximum", () => {
    const r = run({ tasks: [task({ id: "big", durationMinutes: 300 })], settings: { ...settings, bufferMinutes: 15 } });
    const bs = blocksOf(r, "big");
    expect(bs.map((b) => (b.end - b.start) / MIN)).toEqual([120, 120, 60]);
    expect(bs[1].start - bs[0].end).toBe(15 * MIN);
  });

  it("keeps an unsplittable task in one piece", () => {
    const r = run({
      tasks: [task({ id: "solid", durationMinutes: 180, splittable: false })],
      busy: [{ start: ny(16, 10), end: ny(16, 15) }],
    });
    expect(blocksOf(r, "solid")).toEqual([{ taskId: "solid", start: ny(17, 9), end: ny(17, 12), fixed: false }]);
  });

  it("leaves fixed blocks alone and only schedules the remainder", () => {
    const fixedBlocks = [{ taskId: "a", start: ny(18, 14), end: ny(18, 15) }];
    const r = run({ tasks: [task({ id: "a", durationMinutes: 150 }), task({ id: "b" })], fixedBlocks });
    expect(r.blocks.find((b) => b.fixed)).toEqual({ ...fixedBlocks[0], fixed: true });
    const rest = blocksOf(r, "a").filter((b) => !b.fixed);
    expect(rest.reduce((s, b) => s + (b.end - b.start), 0)).toBe(90 * MIN);
    for (const b of blocksOf(r, "b")) expect(overlaps(b, fixedBlocks[0])).toBe(false);
  });

  it("respects earliest start", () => {
    const r = run({ tasks: [task({ id: "later", earliestStart: ny(19, 13) })] });
    expect(blocksOf(r, "later")[0].start).toBe(ny(19, 13));
  });

  it("flags tasks that finish after their deadline", () => {
    const r = run({
      tasks: [task({ id: "late", durationMinutes: 240, deadline: ny(16, 11) })],
    });
    expect(r.atRisk).toEqual([{ taskId: "late", finishesAt: ny(16, 13), deadline: ny(16, 11) }]);
  });

  it("reports tasks that do not fit in the horizon", () => {
    const r = run({
      tasks: [task({ id: "fits", durationMinutes: 60 }), task({ id: "huge", durationMinutes: 60 * 100 })],
      settings: { ...settings, horizonDays: 2 },
    });
    expect(r.unscheduled.map((u) => u.taskId)).toEqual(["huge"]);
    expect(blocksOf(r, "huge")).toEqual([]);
    expect(blocksOf(r, "fits")).toHaveLength(1);
  });

  it("starts from now, rounded to the grid, when the day is under way", () => {
    const r = run({ tasks: [task({ id: "a" })], now: ny(16, 10, 7) });
    expect(blocksOf(r, "a")[0].start).toBe(ny(16, 10, 15));
  });

  it("keeps local working hours across a daylight-saving change", () => {
    // Clocks go back on Sunday 2026-11-01. Friday is EDT (UTC-4), Monday is EST (UTC-5).
    const fri = Date.UTC(2026, 9, 30, 12, 0); // 08:00 EDT
    const r = run({
      now: fri,
      tasks: [task({ id: "fri", durationMinutes: 480, splittable: false }), task({ id: "mon" })],
    });
    expect(blocksOf(r, "fri")[0].start).toBe(Date.UTC(2026, 9, 30, 13, 0)); // 09:00 EDT
    expect(blocksOf(r, "mon")[0].start).toBe(Date.UTC(2026, 10, 2, 14, 0)); // 09:00 EST
  });

  it("is stable: rerunning with the same input gives the same plan", () => {
    const tasks = Array.from({ length: 12 }, (_, i) =>
      task({ id: `t${i}`, durationMinutes: 45 + i * 15, priority: (i % 4) + 1 }),
    );
    const input = { tasks, busy: [{ start: ny(16, 12), end: ny(16, 13) }] };
    expect(run(input)).toEqual(run(input));
  });
});
