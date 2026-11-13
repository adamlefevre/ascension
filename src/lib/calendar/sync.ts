import { randomUUID } from "node:crypto";
import { and, eq, gt, inArray, lt, notInArray } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { reschedule } from "../reschedule";
import { DAY } from "../time";
import { ensureCalendars, getProvider } from "./index";
import type { CalendarProvider } from "./provider";

/** How far back and forward we mirror events. */
const PAST_DAYS = 21;
const FUTURE_DAYS = 75;

const g = globalThis as unknown as { __ascensionSync?: Promise<unknown> };

export type SyncResult = { calendars: number; events: number; skipped?: string };

/**
 * Pull the provider's calendars and events into our tables, reconcile our own
 * task blocks with what is on the Ascension calendar, then re-plan.
 * Each run mirrors a fixed window in full, so it is self-healing: a missed
 * notification is corrected by the next run.
 */
export function syncAll(now: number = Date.now()): Promise<SyncResult> {
  const run = (g.__ascensionSync ?? Promise.resolve()).catch(() => {}).then(() => doSync(now));
  g.__ascensionSync = run;
  return run;
}

async function doSync(now: number): Promise<SyncResult> {
  const provider = await getProvider();
  if (provider.kind === "local") return { calendars: 0, events: 0, skipped: "No Google account connected" };

  const db = await getDb();
  const { ascensionId } = await ensureCalendars(provider);
  const from = new Date(now - PAST_DAYS * DAY);
  const to = new Date(now + FUTURE_DAYS * DAY);
  const cals = await db.select().from(schema.calendars);
  let count = 0;

  for (const c of cals) {
    if (c.isAscension) continue;
    const remote = await provider.listEvents(c.id, from, to);
    count += remote.length;
    for (const e of remote) {
      const values = { title: e.title, start: e.start, end: e.end, allDay: e.allDay, transparent: e.transparent };
      await db
        .insert(schema.events)
        .values({ calendarId: c.id, externalId: e.id, ...values })
        .onConflictDoUpdate({ target: [schema.events.calendarId, schema.events.externalId], set: values });
    }
    // Anything we hold in the window that the provider no longer returns was deleted or moved out.
    const inWindow = and(eq(schema.events.calendarId, c.id), lt(schema.events.start, to), gt(schema.events.end, from));
    const ids = remote.map((e) => e.id);
    await db.delete(schema.events).where(ids.length ? and(inWindow, notInArray(schema.events.externalId, ids)) : inWindow);
  }

  await reconcileBlocks(provider, ascensionId, now, to);
  await reschedule(now);
  await ensureWatches(provider, now).catch((e) => console.error("watch setup failed", e));
  return { calendars: cals.length, events: count };
}

/**
 * Compare the Ascension calendar with our task blocks:
 * - the owner moved a block in Google  -> adopt the new time and pin it
 * - the owner deleted a block in Google -> forget the event id so it is written again
 * - an event with no matching block     -> remove it (left over from an earlier plan)
 */
async function reconcileBlocks(provider: CalendarProvider, ascensionId: string, now: number, to: Date) {
  const db = await getDb();
  const remote = await provider.listEvents(ascensionId, new Date(now), to);
  const blocks = await db.select().from(schema.taskBlocks).where(gt(schema.taskBlocks.end, new Date(now)));
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const seen = new Set<string>();

  for (const e of remote) {
    const block = e.blockId ? byId.get(e.blockId) : undefined;
    if (!block || block.externalEventId !== e.id) {
      await provider.deleteEvent(ascensionId, e.id).catch((err) => console.error("orphan delete failed", err));
      continue;
    }
    seen.add(block.id);
    if (block.start.getTime() !== e.start.getTime() || block.end.getTime() !== e.end.getTime()) {
      await db.update(schema.taskBlocks).set({ start: e.start, end: e.end, pinned: true }).where(eq(schema.taskBlocks.id, block.id));
    }
  }

  const vanished = blocks.filter((b) => b.externalEventId && !seen.has(b.id) && b.start.getTime() > now && b.start < to);
  if (vanished.length) {
    await db
      .update(schema.taskBlocks)
      .set({ externalEventId: null, pinned: false })
      .where(inArray(schema.taskBlocks.id, vanished.map((b) => b.id)));
  }
}

/** Public https address of this deployment, needed for push notifications. */
export function webhookUrl(): string | null {
  const base = process.env.APP_URL ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : null);
  if (!base?.startsWith("https://")) return null;
  return `${base.replace(/\/$/, "")}/api/webhooks/google-calendar`;
}

/** Keep a live notification channel on every calendar, renewing those close to expiry. */
async function ensureWatches(provider: CalendarProvider, now: number) {
  const url = webhookUrl();
  if (!url || !provider.watch) return;
  const db = await getDb();
  const cals = await db.select().from(schema.calendars);
  for (const c of cals) {
    if (c.channelExpiry && c.channelExpiry.getTime() > now + 2 * DAY) continue;
    const token = randomUUID();
    let ch;
    try {
      ch = await provider.watch(c.id, url, token);
    } catch (e) {
      // Some calendars (holidays, other people's) do not allow watching; the daily sync still covers them.
      console.warn(`cannot watch calendar ${c.name}`, e instanceof Error ? e.message : e);
      continue;
    }
    if (c.channelId && c.channelResourceId) await provider.stopWatch?.(c.channelId, c.channelResourceId).catch(() => {});
    await db
      .update(schema.calendars)
      .set({ channelId: ch.channelId, channelResourceId: ch.resourceId, channelToken: token, channelExpiry: ch.expiry })
      .where(eq(schema.calendars.id, c.id));
  }
}
