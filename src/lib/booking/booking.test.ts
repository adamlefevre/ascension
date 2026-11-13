import { beforeEach, describe, expect, it } from "vitest";
import { getDb, resetDbForTests, schema } from "@/db/client";
import { setProviderForTests } from "../calendar";
import { FakeGoogle } from "../calendar/fake-google";
import { syncAll } from "../calendar/sync";
import * as svc from "../services";
import { computeSlots, createBooking, SlotTaken, slotsForLink } from "./availability";
import { book } from "./book";

const NY = "America/New_York";
const MON_8 = Date.UTC(2026, 10, 16, 13, 0);
const ny = (d: number, h: number, m = 0) => Date.UTC(2026, 10, d, h + 5, m);
const hours = [1, 2, 3, 4, 5].map((day) => ({ day, start: 540, end: 1020 }));
const link = { durationMinutes: 30, bufferMinutes: 0, daysAhead: 7, minNoticeHours: 0, dailyLimit: null as number | null };

describe("computeSlots", () => {
  it("offers working-hour slots that avoid busy time and respect notice", () => {
    const slots = computeSlots({ link: { ...link, minNoticeHours: 2 }, settings: { timezone: NY, workingHours: hours }, busy: [{ start: ny(16, 10), end: ny(16, 11) }], bookedStarts: [], now: MON_8 });
    expect(slots[0]).toBe(ny(16, 11)); // 08:00 + 2h notice = 10:00, busy until 11:00
    for (const s of slots) expect(s >= ny(16, 10, 30) || s + 30 * 60_000 <= ny(16, 10)).toBe(true);
    expect(slots.every((s) => new Date(s - 5 * 3600_000).getUTCDay() % 6 !== 0)).toBe(true); // no weekends
  });

  it("keeps a buffer around busy time and caps bookings per day", () => {
    const withBuffer = computeSlots({ link: { ...link, bufferMinutes: 15 }, settings: { timezone: NY, workingHours: hours }, busy: [{ start: ny(16, 9), end: ny(16, 10) }], bookedStarts: [], now: MON_8 });
    expect(withBuffer[0]).toBe(ny(16, 10, 15));
    const capped = computeSlots({ link: { ...link, dailyLimit: 1 }, settings: { timezone: NY, workingHours: hours }, busy: [], bookedStarts: [ny(16, 9)], now: MON_8 });
    expect(capped[0]).toBe(ny(17, 9));
  });
});

describe("booking", () => {
  let google: FakeGoogle;
  beforeEach(async () => {
    resetDbForTests();
    process.env.DEFAULT_TIMEZONE = NY;
    google = new FakeGoogle();
    setProviderForTests(google);
    await svc.updateSettings({ bufferMinutes: 0 });
  });

  it("rejects a slot that is no longer free, including a double booking", async () => {
    const l = await svc.saveBookingLink(null, { slug: "chat", title: "Chat", durationMinutes: 30, minNoticeHours: 0, bufferMinutes: 0 });
    await createBooking(l, ny(16, 9), { name: "A", email: "a@example.com" }, MON_8);
    await expect(createBooking(l, ny(16, 9), { name: "B", email: "b@example.com" }, MON_8)).rejects.toBeInstanceOf(SlotTaken);
    await expect(createBooking(l, ny(16, 9, 7), { name: "B", email: "b@example.com" }, MON_8)).rejects.toBeInstanceOf(SlotTaken);
    const { slots } = await slotsForLink(l, MON_8);
    expect(slots).not.toContain(ny(16, 9));
  });

  it("allows only one of two simultaneous requests for the same slot", async () => {
    const l = await svc.saveBookingLink(null, { slug: "chat", title: "Chat", durationMinutes: 30, minNoticeHours: 0, bufferMinutes: 0 });
    const results = await Promise.allSettled([
      createBooking(l, ny(16, 9), { name: "A", email: "a@example.com" }, MON_8),
      createBooking(l, ny(16, 9), { name: "B", email: "b@example.com" }, MON_8),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await (await getDb()).select().from(schema.bookings)).toHaveLength(1);
  });

  it("invites the guest, adds a video link and moves tasks out of the way", async () => {
    await svc.createTask({ title: "Deep work", durationMinutes: 60, priority: 1 });
    await syncAll();
    const db = await getDb();
    const [block] = await db.select().from(schema.taskBlocks);
    const l = await svc.saveBookingLink(null, { slug: "chat", title: "Chat", durationMinutes: 60, minNoticeHours: 0, bufferMinutes: 0 });
    const { slots } = await slotsForLink(l);
    // Task blocks do not hide availability: some slot overlaps the block.
    const pick = slots.find((s) => s < block.end.getTime() && s + 3600_000 > block.start.getTime());
    expect(pick).toBeDefined();

    const b = await book(l, pick!, { name: "Guest", email: "guest@example.com" });
    expect(b.meetLink).toContain("meet.example.com");
    const ev = [...google.events.get("primary@example.com")!.values()];
    expect(ev.map((e) => e.title)).toEqual(["Chat with Guest"]);
    const [moved] = await db.select().from(schema.taskBlocks);
    expect(moved.end <= b.start || moved.start >= b.end).toBe(true);
  });

  it("validates link settings", async () => {
    await expect(svc.saveBookingLink(null, { slug: "Bad Slug!", title: "x", durationMinutes: 30 })).rejects.toThrow();
    await svc.saveBookingLink(null, { slug: "taken", title: "x", durationMinutes: 30 });
    await expect(svc.saveBookingLink(null, { slug: "taken", title: "y", durationMinutes: 30 })).rejects.toThrow("already used");
  });
});
