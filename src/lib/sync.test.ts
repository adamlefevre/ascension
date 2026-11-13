import { beforeEach, describe, expect, it } from "vitest";
import { getDb, resetDbForTests, schema } from "@/db/client";
import { setProviderForTests } from "./calendar";
import { FakeGoogle } from "./calendar/fake-google";
import { toProviderEvent } from "./calendar/google";
import { syncAll } from "./calendar/sync";
import { reschedule } from "./reschedule";
import * as svc from "./services";
import { overlaps } from "./scheduler/intervals";

const PRIMARY = "primary@example.com";
const ASC = "ascension@example.com";
// Monday 2026-11-16, 08:00 in New York
const NOW = Date.UTC(2026, 10, 16, 13, 0);
const ny = (day: number, h: number, m = 0) => new Date(Date.UTC(2026, 10, day, h + 5, m));

let google: FakeGoogle;

beforeEach(async () => {
  resetDbForTests();
  process.env.DEFAULT_TIMEZONE = "America/New_York";
  google = new FakeGoogle();
  setProviderForTests(google);
  await svc.updateSettings({ bufferMinutes: 0 });
});

const blocks = async () => (await getDb()).select().from(schema.taskBlocks).orderBy(schema.taskBlocks.start);
const insertTask = async (v: Partial<typeof schema.tasks.$inferInsert> & { title: string }) =>
  (await (await getDb()).insert(schema.tasks).values(v).returning())[0];

describe("calendar sync", () => {
  it("mirrors events and schedules tasks around them", async () => {
    google.put(PRIMARY, { title: "Standup", start: ny(16, 9), end: ny(16, 10) });
    await insertTask({ title: "Write", durationMinutes: 60 });
    await syncAll(NOW);

    const db = await getDb();
    const events = await db.select().from(schema.events);
    expect(events.map((e) => e.title)).toEqual(["Standup"]);
    const [b] = await blocks();
    expect(b.start).toEqual(ny(16, 10));
  });

  it("removes events deleted in Google and reuses the freed time", async () => {
    const id = google.put(PRIMARY, { start: ny(16, 9), end: ny(16, 12) });
    await insertTask({ title: "Write", durationMinutes: 60 });
    await syncAll(NOW);
    expect((await blocks())[0].start).toEqual(ny(16, 12));

    google.events.get(PRIMARY)!.delete(id);
    await syncAll(NOW);
    expect(await (await getDb()).select().from(schema.events)).toEqual([]);
    expect((await blocks())[0].start).toEqual(ny(16, 9));
  });

  it("ignores events marked free, declined or all-day", async () => {
    google.put(PRIMARY, { start: ny(16, 9), end: ny(16, 17), transparent: true });
    google.put(PRIMARY, { start: new Date(Date.UTC(2026, 10, 16)), end: new Date(Date.UTC(2026, 10, 17)), allDay: true });
    await insertTask({ title: "Write", durationMinutes: 60 });
    await syncAll(NOW);
    expect((await blocks())[0].start).toEqual(ny(16, 9));
  });

  it("writes each block to the Ascension calendar exactly once", async () => {
    await insertTask({ title: "A", durationMinutes: 60 });
    await insertTask({ title: "B", durationMinutes: 60 });
    await syncAll(NOW);
    expect(google.calls.create).toBe(2);
    expect([...google.events.get(ASC)!.values()].map((e) => e.title).sort()).toEqual(["A", "B"]);

    await syncAll(NOW);
    await reschedule(NOW);
    expect(google.calls.create).toBe(2);
    expect(google.calls.delete).toBe(0);
    for (const b of await blocks()) expect(b.externalEventId).toBeTruthy();
  });

  it("does not treat its own blocks as busy time", async () => {
    await insertTask({ title: "A", durationMinutes: 120 });
    await syncAll(NOW);
    await syncAll(NOW);
    const all = await blocks();
    expect(all).toHaveLength(1);
    expect(all[0].start).toEqual(ny(16, 9));
    expect(await (await getDb()).select().from(schema.events)).toEqual([]);
  });

  it("moves the Google event when the plan changes", async () => {
    await insertTask({ title: "A", durationMinutes: 60 });
    await syncAll(NOW);
    google.put(PRIMARY, { start: ny(16, 9), end: ny(16, 11) });
    await syncAll(NOW);
    const remote = [...google.events.get(ASC)!.values()];
    expect(remote).toHaveLength(1);
    expect(remote[0].start).toEqual(ny(16, 11));
  });

  it("pins a block the owner moved in Google", async () => {
    await insertTask({ title: "A", durationMinutes: 60 });
    await insertTask({ title: "B", durationMinutes: 60 });
    await syncAll(NOW);
    const [first] = await blocks();
    const ev = google.events.get(ASC)!.get(first.externalEventId!)!;
    ev.start = ny(18, 14);
    ev.end = ny(18, 15);

    await syncAll(NOW);
    const all = await blocks();
    const moved = all.find((b) => b.id === first.id)!;
    expect(moved.pinned).toBe(true);
    expect(moved.start).toEqual(ny(18, 14));
    const other = all.find((b) => b.id !== first.id)!;
    expect(other.start).toEqual(ny(16, 9));
  });

  it("cleans up Ascension events that no longer match a block", async () => {
    google.put(ASC, { title: "Left over", start: ny(17, 9), end: ny(17, 10), blockId: "00000000-0000-0000-0000-000000000000" });
    await syncAll(NOW);
    expect(google.events.get(ASC)!.size).toBe(0);
  });

  it("removes the Google event when a task is completed or deleted", async () => {
    const a = await insertTask({ title: "A", durationMinutes: 60 });
    const b = await insertTask({ title: "B", durationMinutes: 60 });
    // Completing uses the real clock, so plan from the real now for this test.
    await syncAll();
    expect(google.events.get(ASC)!.size).toBe(2);
    await svc.setTaskDone(a.id, true);
    await svc.deleteTask(b.id);
    expect(google.events.get(ASC)!.size).toBe(0);
  });
});

describe("reschedule", () => {
  it("applies only the difference between the old and new plan", async () => {
    await insertTask({ title: "A", durationMinutes: 60 });
    await reschedule(NOW);
    const before = await blocks();
    await insertTask({ title: "B", durationMinutes: 60, priority: 4 });
    await reschedule(NOW);
    const after = await blocks();
    expect(after).toHaveLength(2);
    expect(after.find((x) => x.taskId === before[0].taskId)!.id).toBe(before[0].id);
  });

  it("records unscheduled and at-risk tasks in the report", async () => {
    await svc.updateSettings({ horizonDays: 1 });
    const late = await insertTask({ title: "Late", durationMinutes: 240, deadline: ny(16, 10) });
    const huge = await insertTask({ title: "Huge", durationMinutes: 6000, priority: 4 });
    await reschedule(NOW);
    const [s] = await (await getDb()).select().from(schema.settings);
    expect(s.scheduleReport!.atRisk.map((r) => r.taskId)).toEqual([late.id]);
    expect(s.scheduleReport!.unscheduled.map((r) => r.taskId)).toEqual([huge.id]);
  });

  it("creates instances for repeating tasks and never overlaps them", async () => {
    const db = await getDb();
    await db.insert(schema.tasks).values({
      title: "Review", durationMinutes: 30, isTemplate: true, recurrenceRule: "FREQ=WEEKLY;BYDAY=MO,WE,FR",
      createdAt: new Date(NOW - 30 * 24 * 3600 * 1000),
    });
    await reschedule(NOW);
    await reschedule(NOW);
    const instances = (await db.select().from(schema.tasks)).filter((t) => t.templateId);
    expect(instances.map((t) => t.instanceDate).sort()).toEqual(["2026-11-16", "2026-11-18", "2026-11-20", "2026-11-23", "2026-11-25", "2026-11-27"]);
    const all = await blocks();
    expect(all).toHaveLength(6);
    expect(all[1].start).toEqual(ny(18, 9));
    for (let i = 1; i < all.length; i++) expect(overlaps({ start: +all[i - 1].start, end: +all[i - 1].end }, { start: +all[i].start, end: +all[i].end })).toBe(false);
  });
});

describe("toProviderEvent", () => {
  it("maps timed, all-day, free and declined events", () => {
    expect(toProviderEvent({ id: "1", status: "cancelled" })).toBeNull();
    const timed = toProviderEvent({ id: "2", summary: " Sync ", start: { dateTime: "2026-11-16T09:00:00-05:00" }, end: { dateTime: "2026-11-16T10:00:00-05:00" } })!;
    expect(timed).toMatchObject({ title: "Sync", allDay: false, transparent: false, start: ny(16, 9) });
    expect(toProviderEvent({ id: "3", start: { date: "2026-11-16" }, end: { date: "2026-11-17" } })!.allDay).toBe(true);
    const declined = toProviderEvent({
      id: "4", start: { dateTime: "2026-11-16T09:00:00Z" }, end: { dateTime: "2026-11-16T10:00:00Z" },
      attendees: [{ self: true, responseStatus: "declined" }],
    })!;
    expect(declined.transparent).toBe(true);
    const block = toProviderEvent({
      id: "5", start: { dateTime: "2026-11-16T09:00:00Z" }, end: { dateTime: "2026-11-16T10:00:00Z" },
      extendedProperties: { private: { ascensionBlockId: "abc" } },
    })!;
    expect(block.blockId).toBe("abc");
  });
});
