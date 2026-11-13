import { connection } from "next/server";
import type { Project, Task } from "@/db/schema";
import { requireOwner } from "./auth-guard";
import { getProvider } from "./calendar";
import { syncAll } from "./calendar/sync";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { assistantConfigured, loadTranscript } from "./ai/chat";
import * as svc from "./services";
import { getSettings } from "./settings";
import { DAY } from "./time";

export type TaskVM = Task & {
  nextBlock: { start: Date; end: Date } | null;
  issue: { kind: "unscheduled" | "atRisk"; text: string } | null;
};

export type BlockVM = { id: string; taskId: string; start: Date; end: Date; pinned: boolean };
export type EventVM = { id: string; title: string; start: Date; end: Date; allDay: boolean; color: string | null };

/** One load for every screen: tasks with their place in the plan, plus the calendar contents. */
export async function loadBoard() {
  await connection();
  await requireOwner();
  await firstSync();
  const now = Date.now();
  const from = new Date(now - 21 * DAY);
  const to = new Date(now + 60 * DAY);
  const [settings, tasks, templates, projects, blocks, events] = await Promise.all([
    getSettings(),
    svc.listTasksForUi(),
    svc.listTemplates(),
    svc.listProjects(),
    svc.listBlocks(from, to),
    svc.listEvents(from, to),
  ]);

  const report = settings.scheduleReport;
  const unscheduled = new Map(report?.unscheduled.map((u) => [u.taskId, u.reason]));
  const atRisk = new Map(report?.atRisk.map((r) => [r.taskId, r]));
  const next = new Map<string, { start: Date; end: Date }>();
  for (const b of blocks) {
    if (b.end.getTime() > now && !next.has(b.taskId)) next.set(b.taskId, { start: b.start, end: b.end });
  }

  const taskVMs: TaskVM[] = tasks.map((t) => {
    let issue: TaskVM["issue"] = null;
    if (t.status === "todo") {
      const u = unscheduled.get(t.id);
      const r = atRisk.get(t.id);
      if (u) issue = { kind: "unscheduled", text: u };
      else if (r) issue = { kind: "atRisk", text: "Will finish after its deadline" };
    }
    return { ...t, nextBlock: next.get(t.id) ?? null, issue };
  });

  return {
    settings,
    tasks: taskVMs,
    templates,
    projects: projects as Project[],
    blocks: blocks.map((b): BlockVM => ({ id: b.id, taskId: b.taskId, start: b.start, end: b.end, pinned: b.pinned })),
    events: events.map((e): EventVM => ({ id: e.id, title: e.title, start: e.start, end: e.end, allDay: e.allDay, color: e.color })),
  };
}

export type Board = Awaited<ReturnType<typeof loadBoard>>;

/** Right after Google is connected nothing has been mirrored yet: do it before the first render. */
async function firstSync() {
  const provider = await getProvider();
  if (provider.kind !== "google") return;
  const db = await getDb();
  const cals = await db.select({ id: schema.calendars.id }).from(schema.calendars);
  if (cals.some((c) => !c.id.startsWith("local-"))) return;
  await syncAll().catch((e) => console.error("first sync failed", e));
}

/** What the assistant panel needs on first render. */
export async function loadAssistant() {
  await connection();
  await requireOwner();
  const db = await getDb();
  const [transcript, pending] = await Promise.all([
    loadTranscript(),
    db.select({ id: schema.pendingActions.id, summary: schema.pendingActions.summary }).from(schema.pendingActions).where(eq(schema.pendingActions.status, "pending")),
  ]);
  return { configured: assistantConfigured(), transcript, pending };
}
