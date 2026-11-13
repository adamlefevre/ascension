import { and, asc, desc, eq, gt, gte, inArray, lt, or } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db/client";
import { calendarIds, getProvider } from "./calendar";
import { isValidRule } from "./recurrence";
import { pushBlocks, reschedule } from "./reschedule";
import { getSettings } from "./settings";

/**
 * Core operations, shared by the UI (through server actions) and the AI
 * assistant (through tools). No auth checks here: callers do that.
 */

const isoDate = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), "Invalid date")
  .transform((s) => new Date(s));

export const taskInput = z.object({
  title: z.string().trim().min(1).max(200),
  notes: z.string().max(5000).nullish(),
  durationMinutes: z.number().int().min(5).max(60 * 40).default(30),
  priority: z.number().int().min(1).max(4).default(3),
  deadline: isoDate.nullish(),
  deadlineHard: z.boolean().default(false),
  earliestStart: isoDate.nullish(),
  projectId: z.string().uuid().nullish(),
  blockedByTaskId: z.string().uuid().nullish(),
  splittable: z.boolean().default(true),
  recurrenceRule: z.string().max(300).refine(isValidRule, "Invalid recurrence rule").nullish(),
});
export type TaskInput = z.input<typeof taskInput>;

export async function createTask(raw: TaskInput) {
  const input = taskInput.parse(raw);
  const db = await getDb();
  const { recurrenceRule, ...rest } = input;
  const [task] = await db
    .insert(schema.tasks)
    .values(recurrenceRule ? { ...rest, recurrenceRule, isTemplate: true, deadline: null, earliestStart: null } : rest)
    .returning();
  await reschedule();
  return task;
}

export async function updateTask(id: string, raw: Partial<TaskInput>) {
  const input = taskInput.partial().parse(raw);
  if (input.blockedByTaskId === id) throw new Error("A task cannot be blocked by itself");
  const db = await getDb();
  const [task] = await db.update(schema.tasks).set(input).where(eq(schema.tasks.id, id)).returning();
  if (!task) throw new Error("Task not found");
  if (task.isTemplate) {
    // Refresh upcoming instances so they pick up the new details.
    await removeTasks(
      await db
        .select({ id: schema.tasks.id })
        .from(schema.tasks)
        .where(and(eq(schema.tasks.templateId, id), eq(schema.tasks.status, "todo")))
        .then((rows) => rows.map((r) => r.id)),
    );
  }
  await reschedule();
  return task;
}

export async function setTaskDone(id: string, done: boolean) {
  const db = await getDb();
  const now = new Date();
  const [task] = await db
    .update(schema.tasks)
    .set({ status: done ? "done" : "todo", completedAt: done ? now : null })
    .where(and(eq(schema.tasks.id, id), eq(schema.tasks.isTemplate, false)))
    .returning();
  if (!task) throw new Error("Task not found");
  if (done) {
    // Free up time that was reserved for the rest of this task.
    const future = await db
      .delete(schema.taskBlocks)
      .where(and(eq(schema.taskBlocks.taskId, id), gt(schema.taskBlocks.start, now)))
      .returning();
    await pushBlocks(future.map((b) => b.externalEventId).filter((x): x is string => !!x));
  }
  await reschedule();
  return task;
}

async function removeTasks(ids: string[]) {
  if (!ids.length) return;
  const db = await getDb();
  const blocks = await db.delete(schema.taskBlocks).where(inArray(schema.taskBlocks.taskId, ids)).returning();
  await db.update(schema.tasks).set({ blockedByTaskId: null }).where(inArray(schema.tasks.blockedByTaskId, ids));
  await db.delete(schema.tasks).where(inArray(schema.tasks.id, ids));
  await pushBlocks(blocks.map((b) => b.externalEventId).filter((x): x is string => !!x));
}

export async function deleteTask(id: string) {
  const db = await getDb();
  const instances = await db
    .select({ id: schema.tasks.id })
    .from(schema.tasks)
    .where(and(eq(schema.tasks.templateId, id), eq(schema.tasks.status, "todo")));
  await removeTasks([id, ...instances.map((i) => i.id)]);
  await reschedule();
}

export const projectInput = z.object({
  name: z.string().trim().min(1).max(120),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#6366f1"),
  deadline: isoDate.nullish(),
  status: z.enum(["active", "archived"]).default("active"),
});
export type ProjectInput = z.input<typeof projectInput>;

export async function createProject(raw: ProjectInput) {
  const db = await getDb();
  const [p] = await db.insert(schema.projects).values(projectInput.parse(raw)).returning();
  return p;
}

export async function updateProject(id: string, raw: Partial<ProjectInput>) {
  const db = await getDb();
  const [p] = await db
    .update(schema.projects)
    .set(projectInput.partial().parse(raw))
    .where(eq(schema.projects.id, id))
    .returning();
  if (!p) throw new Error("Project not found");
  return p;
}

export async function deleteProject(id: string) {
  const db = await getDb();
  await db.delete(schema.projects).where(eq(schema.projects.id, id));
}

/** The user dragged or resized a block: keep it exactly there from now on. */
export async function moveBlock(id: string, start: Date, end: Date) {
  if (!(end > start)) throw new Error("Block must end after it starts");
  const db = await getDb();
  const [block] = await db
    .update(schema.taskBlocks)
    .set({ start, end, pinned: true })
    .where(eq(schema.taskBlocks.id, id))
    .returning();
  if (!block) throw new Error("Block not found");
  if (block.externalEventId) {
    const [task] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, block.taskId));
    const p = await getProvider();
    if (p.kind !== "local") {
      const { ascensionId } = await calendarIds(p);
      await p
        .updateEvent(ascensionId, block.externalEventId, { title: task.title, start, end, blockId: block.id })
        .catch((e) => console.error("update block event failed", e));
    }
  }
  await reschedule();
  return block;
}

/** Hand a pinned block back to the engine. */
export async function unpinBlock(id: string) {
  const db = await getDb();
  await db.update(schema.taskBlocks).set({ pinned: false }).where(eq(schema.taskBlocks.id, id));
  await reschedule();
}

export const settingsInput = z.object({
  timezone: z.string().refine((tz) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, "Unknown timezone"),
  workingHours: z
    .array(
      z
        .object({ day: z.number().int().min(0).max(6), start: z.number().int().min(0).max(1440), end: z.number().int().min(0).max(1440) })
        .refine((w) => w.end > w.start, "End must be after start"),
    )
    .max(21),
  minBlockMinutes: z.number().int().min(15).max(240),
  maxBlockMinutes: z.number().int().min(15).max(600),
  bufferMinutes: z.number().int().min(0).max(120),
  horizonDays: z.number().int().min(1).max(60),
});

export async function updateSettings(raw: Partial<z.input<typeof settingsInput>>) {
  const input = settingsInput.partial().parse(raw);
  await getSettings();
  const db = await getDb();
  await db.update(schema.settings).set(input).where(eq(schema.settings.id, 1));
  await reschedule();
  return getSettings();
}

export async function setCalendarBusy(id: string, countsAsBusy: boolean) {
  const db = await getDb();
  await db.update(schema.calendars).set({ countsAsBusy }).where(eq(schema.calendars.id, id));
  await reschedule();
}

export const eventInput = z
  .object({ title: z.string().trim().min(1).max(200), start: isoDate, end: isoDate })
  .refine((e) => e.end > e.start, "Event must end after it starts");

/** Create a meeting or appointment on the primary calendar. */
export async function createEvent(raw: z.input<typeof eventInput>) {
  const input = eventInput.parse(raw);
  const p = await getProvider();
  const { primaryId } = await calendarIds(p);
  const { id } = await p.createEvent(primaryId, input);
  const db = await getDb();
  await db
    .insert(schema.events)
    .values({ calendarId: primaryId, externalId: id, ...input })
    .onConflictDoNothing();
  await reschedule();
  return { id, ...input };
}

export async function deleteEvent(id: string) {
  const db = await getDb();
  const [ev] = await db.delete(schema.events).where(eq(schema.events.id, id)).returning();
  if (!ev) throw new Error("Event not found");
  const p = await getProvider();
  if (p.kind !== "local") await p.deleteEvent(ev.calendarId, ev.externalId);
  await reschedule();
}

// ---------- reads ----------

export async function listTasks(filter: { status?: "todo" | "done"; projectId?: string } = {}) {
  const db = await getDb();
  const conds = [eq(schema.tasks.isTemplate, false)];
  if (filter.status) conds.push(eq(schema.tasks.status, filter.status));
  if (filter.projectId) conds.push(eq(schema.tasks.projectId, filter.projectId));
  return db.select().from(schema.tasks).where(and(...conds)).orderBy(asc(schema.tasks.createdAt));
}

export async function listTemplates() {
  const db = await getDb();
  return db.select().from(schema.tasks).where(eq(schema.tasks.isTemplate, true)).orderBy(asc(schema.tasks.createdAt));
}

export async function listProjects() {
  const db = await getDb();
  return db.select().from(schema.projects).orderBy(asc(schema.projects.createdAt));
}

export async function listBlocks(from: Date, to: Date) {
  const db = await getDb();
  return db
    .select()
    .from(schema.taskBlocks)
    .where(and(lt(schema.taskBlocks.start, to), gt(schema.taskBlocks.end, from)))
    .orderBy(asc(schema.taskBlocks.start));
}

export async function listEvents(from: Date, to: Date) {
  const db = await getDb();
  return db
    .select({ event: schema.events, color: schema.calendars.color })
    .from(schema.events)
    .innerJoin(schema.calendars, eq(schema.events.calendarId, schema.calendars.id))
    .where(and(eq(schema.calendars.isAscension, false), lt(schema.events.start, to), gt(schema.events.end, from)))
    .orderBy(asc(schema.events.start))
    .then((rows) => rows.map((r) => ({ ...r.event, color: r.color })));
}

/** Everything the task panels need: open tasks plus recently finished ones. */
export async function listTasksForUi() {
  const db = await getDb();
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  return db
    .select()
    .from(schema.tasks)
    .where(
      and(
        eq(schema.tasks.isTemplate, false),
        or(eq(schema.tasks.status, "todo"), gte(schema.tasks.completedAt, weekAgo)),
      ),
    )
    .orderBy(desc(schema.tasks.status), asc(schema.tasks.createdAt));
}

/** Per-project totals across all time (the task list only carries recent history). */
export async function projectStats() {
  const db = await getDb();
  const rows = await db
    .select({ projectId: schema.tasks.projectId, status: schema.tasks.status, minutes: schema.tasks.durationMinutes })
    .from(schema.tasks)
    .where(eq(schema.tasks.isTemplate, false));
  const out = new Map<string, { total: number; done: number; minutesLeft: number }>();
  for (const r of rows) {
    if (!r.projectId) continue;
    const s = out.get(r.projectId) ?? { total: 0, done: 0, minutesLeft: 0 };
    s.total++;
    if (r.status === "done") s.done++;
    else s.minutesLeft += r.minutes;
    out.set(r.projectId, s);
  }
  return out;
}
