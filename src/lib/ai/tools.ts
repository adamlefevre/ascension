import type Anthropic from "@anthropic-ai/sdk";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db/client";
import { reschedule } from "../reschedule";
import * as svc from "../services";
import { getSettings } from "../settings";
import { DAY } from "../time";

/**
 * The assistant's tools. Each one wraps the same service function the UI
 * uses, so the assistant can do nothing the owner could not do by hand.
 * Deletions are not executed here: they are parked as pending actions and
 * run only when the owner presses Confirm.
 */

const when = z.string().describe("ISO 8601 date-time with UTC offset, e.g. 2026-11-16T14:00:00-05:00");
const id = z.string().uuid();

const taskFields = {
  title: z.string().describe("Short imperative title"),
  durationMinutes: z.number().int().describe("Estimated total work in minutes. Estimate sensibly when the user gives none."),
  priority: z.number().int().min(1).max(4).describe("1 urgent, 2 high, 3 normal, 4 low").optional(),
  deadline: when.nullable().optional(),
  deadlineHard: z.boolean().describe("True when missing the deadline is not acceptable").optional(),
  earliestStart: when.nullable().describe("Do not schedule before this time").optional(),
  projectName: z.string().nullable().describe("Name of an existing project").optional(),
  blockedByTaskId: id.nullable().describe("Task that must be finished first").optional(),
  splittable: z.boolean().describe("False when the work must be done in one sitting").optional(),
  notes: z.string().nullable().optional(),
};

const defs = {
  get_schedule: {
    description:
      "Read the plan: calendar events and scheduled task blocks between two times, in order, plus any tasks that could not be scheduled or will miss their deadline. Use this to answer questions about the owner's day or week and to explain why something is placed where it is.",
    input: z.object({ from: when.optional().describe("Defaults to now"), to: when.optional().describe("Defaults to 7 days after from") }),
  },
  list_tasks: {
    description: "List tasks with their ids, details and next scheduled time.",
    input: z.object({ status: z.enum(["todo", "done", "all"]).optional(), projectName: z.string().optional() }),
  },
  create_task: {
    description:
      "Create a task. It is placed on the calendar automatically; the result says when. For repeating work pass recurrenceRule (an RFC 5545 RRULE such as FREQ=WEEKLY;BYDAY=MO,WE,FR) and leave deadline empty.",
    input: z.object({ ...taskFields, recurrenceRule: z.string().optional() }),
  },
  update_task: {
    description: "Change fields of an existing task. Only pass what changes. The plan is recomputed automatically.",
    input: z.object({ id, ...taskFields, title: taskFields.title.optional(), durationMinutes: taskFields.durationMinutes.optional() }),
  },
  complete_task: {
    description: "Mark a task done (or not done again with done=false).",
    input: z.object({ id, done: z.boolean().optional() }),
  },
  delete_task: {
    description: "Ask to delete a task. This does not delete it: the owner is shown a Confirm button and decides.",
    input: z.object({ id }),
  },
  pin_task_block: {
    description:
      "Fix one scheduled block of a task at a specific time so automatic planning leaves it there. Get block ids from get_schedule.",
    input: z.object({ blockId: id, start: when, end: when }),
  },
  list_projects: { description: "List projects with their ids, deadlines and progress.", input: z.object({}) },
  create_project: {
    description: "Create a project to group tasks under a shared deadline.",
    input: z.object({ name: z.string(), deadline: when.nullable().optional() }),
  },
  create_event: {
    description: "Add a fixed event (meeting, appointment) to the owner's calendar. Tasks are re-planned around it.",
    input: z.object({ title: z.string(), start: when, end: when }),
  },
  delete_event: {
    description: "Ask to delete a calendar event. This does not delete it: the owner is shown a Confirm button and decides.",
    input: z.object({ id }),
  },
  update_settings: {
    description:
      "Change scheduling preferences. workingHours replaces the whole list: one entry per working period, day 0=Sunday..6=Saturday, start/end in minutes after midnight.",
    input: z.object({
      workingHours: z.array(z.object({ day: z.number().int(), start: z.number().int(), end: z.number().int() })).optional(),
      minBlockMinutes: z.number().int().optional(),
      maxBlockMinutes: z.number().int().optional(),
      bufferMinutes: z.number().int().optional(),
      horizonDays: z.number().int().optional(),
    }),
  },
} as const;

export type ToolName = keyof typeof defs;
type In<N extends ToolName> = z.infer<(typeof defs)[N]["input"]>;

export const toolDefinitions: Anthropic.Tool[] = Object.entries(defs).map(([name, d]) => ({
  name,
  description: d.description,
  input_schema: z.toJSONSchema(d.input, { target: "draft-7" }) as Anthropic.Tool["input_schema"],
}));

// ---------- formatting for the model ----------

function local(d: Date, tz: string) {
  return d.toLocaleString("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

async function resolveProject(name: string | null | undefined): Promise<string | null | undefined> {
  if (name === undefined) return undefined;
  if (name === null || name.trim() === "") return null;
  const projects = await svc.listProjects();
  const hit = projects.find((p) => p.name.toLowerCase() === name.trim().toLowerCase());
  if (!hit) throw new Error(`No project named "${name}". Existing projects: ${projects.map((p) => p.name).join(", ") || "none"}. Create it first if the owner wants a new one.`);
  return hit.id;
}

async function placement(taskId: string, tz: string) {
  const db = await getDb();
  const blocks = await db.select().from(schema.taskBlocks).where(eq(schema.taskBlocks.taskId, taskId)).orderBy(schema.taskBlocks.start);
  const s = await getSettings();
  const unscheduled = s.scheduleReport?.unscheduled.find((u) => u.taskId === taskId);
  const atRisk = s.scheduleReport?.atRisk.find((r) => r.taskId === taskId);
  return {
    scheduled: blocks.map((b) => `${local(b.start, tz)} – ${local(b.end, tz)}`),
    ...(unscheduled ? { problem: `Not scheduled: ${unscheduled.reason}` } : {}),
    ...(atRisk ? { problem: `Will finish ${local(new Date(atRisk.finishesAt), tz)}, after its deadline` } : {}),
  };
}

async function park(tool: string, input: unknown, summary: string) {
  const db = await getDb();
  const [row] = await db.insert(schema.pendingActions).values({ tool, input, summary }).returning();
  return row;
}

export type ToolContext = {
  /** Called when a destructive action is parked, so the UI can show a Confirm button. */
  onConfirmNeeded?: (action: { id: string; summary: string }) => void;
};

const handlers: { [N in ToolName]: (input: In<N>, ctx: ToolContext, tz: string) => Promise<unknown> } = {
  async get_schedule(input, _ctx, tz) {
    const from = input.from ? new Date(input.from) : new Date();
    const to = input.to ? new Date(input.to) : new Date(from.getTime() + 7 * DAY);
    const [events, blocks, tasks, s] = await Promise.all([svc.listEvents(from, to), svc.listBlocks(from, to), svc.listTasks(), getSettings()]);
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const items = [
      ...events.map((e) => ({ at: e.start, line: { kind: "event", id: e.id, title: e.title, start: local(e.start, tz), end: local(e.end, tz), ...(e.allDay ? { allDay: true } : {}) } })),
      ...blocks.map((b) => ({ at: b.start, line: { kind: "task", blockId: b.id, taskId: b.taskId, title: byId.get(b.taskId)?.title ?? "?", start: local(b.start, tz), end: local(b.end, tz), ...(b.pinned ? { pinned: true } : {}), ...(byId.get(b.taskId)?.status === "done" ? { done: true } : {}) } })),
    ].sort((a, b) => a.at.getTime() - b.at.getTime());
    return {
      timezone: tz,
      items: items.map((i) => i.line),
      unscheduled: s.scheduleReport?.unscheduled.map((u) => ({ taskId: u.taskId, title: byId.get(u.taskId)?.title, reason: u.reason })) ?? [],
      atRisk: s.scheduleReport?.atRisk.map((r) => ({ taskId: r.taskId, title: byId.get(r.taskId)?.title, finishes: local(new Date(r.finishesAt), tz), deadline: local(new Date(r.deadline), tz) })) ?? [],
    };
  },

  async list_tasks(input, _ctx, tz) {
    const projectId = (await resolveProject(input.projectName)) ?? undefined;
    const status = input.status ?? "todo";
    const [tasks, templates, projects, blocks] = await Promise.all([
      svc.listTasks({ status: status === "all" ? undefined : status, projectId }),
      svc.listTemplates(),
      svc.listProjects(),
      svc.listBlocks(new Date(), new Date(Date.now() + 90 * DAY)),
    ]);
    const pname = new Map(projects.map((p) => [p.id, p.name]));
    const next = new Map<string, Date>();
    for (const b of blocks) if (!next.has(b.taskId)) next.set(b.taskId, b.start);
    const row = (t: (typeof tasks)[number]) => ({
      id: t.id,
      title: t.title,
      minutes: t.durationMinutes,
      priority: t.priority,
      status: t.status,
      ...(t.projectId ? { project: pname.get(t.projectId) } : {}),
      ...(t.deadline ? { deadline: local(t.deadline, tz), firm: t.deadlineHard } : {}),
      ...(t.blockedByTaskId ? { blockedByTaskId: t.blockedByTaskId } : {}),
      ...(next.has(t.id) ? { nextBlock: local(next.get(t.id)!, tz) } : {}),
      ...(t.templateId ? { repeatsFrom: t.templateId } : {}),
    });
    return {
      tasks: tasks.slice(-150).map(row),
      repeating: templates.filter((t) => !projectId || t.projectId === projectId).map((t) => ({ id: t.id, title: t.title, minutes: t.durationMinutes, rule: t.recurrenceRule })),
    };
  },

  async create_task(input, _ctx, tz) {
    const { projectName, ...rest } = input;
    const task = await svc.createTask({ ...rest, projectId: await resolveProject(projectName) });
    if (task.isTemplate) return { id: task.id, title: task.title, repeats: task.recurrenceRule, note: "Occurrences are created and scheduled automatically." };
    return { id: task.id, title: task.title, ...(await placement(task.id, tz)) };
  },

  async update_task(input, _ctx, tz) {
    const { id, projectName, ...rest } = input;
    const projectId = await resolveProject(projectName);
    const task = await svc.updateTask(id, { ...rest, ...(projectId !== undefined ? { projectId } : {}) });
    return { id: task.id, title: task.title, ...(task.isTemplate ? {} : await placement(task.id, tz)) };
  },

  async complete_task(input) {
    const task = await svc.setTaskDone(input.id, input.done ?? true);
    return { id: task.id, title: task.title, status: task.status };
  },

  async delete_task(input, ctx) {
    const db = await getDb();
    const [task] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, input.id));
    if (!task) throw new Error("Task not found");
    const action = await park("delete_task", input, `Delete task "${task.title}"${task.isTemplate ? " and its upcoming occurrences" : ""}`);
    ctx.onConfirmNeeded?.({ id: action.id, summary: action.summary });
    return { status: "awaiting_confirmation", note: "Nothing was deleted. The owner now sees a Confirm button for this; tell them briefly and do not ask again in text." };
  },

  async pin_task_block(input, _ctx, tz) {
    const b = await svc.moveBlock(input.blockId, new Date(input.start), new Date(input.end));
    return { blockId: b.id, start: local(b.start, tz), end: local(b.end, tz), pinned: true };
  },

  async list_projects(_input, _ctx, tz) {
    const [projects, stats] = await Promise.all([svc.listProjects(), svc.projectStats()]);
    return projects.map((p) => ({ id: p.id, name: p.name, ...(p.deadline ? { deadline: local(p.deadline, tz) } : {}), ...(stats.get(p.id) ?? { total: 0, done: 0, minutesLeft: 0 }) }));
  },

  async create_project(input) {
    const p = await svc.createProject(input);
    return { id: p.id, name: p.name };
  },

  async create_event(input, _ctx, tz) {
    const e = await svc.createEvent(input);
    return { title: e.title, start: local(e.start, tz), end: local(e.end, tz), note: "Tasks were re-planned around it." };
  },

  async delete_event(input, ctx, tz) {
    const db = await getDb();
    const [ev] = await db.select().from(schema.events).where(eq(schema.events.id, input.id));
    if (!ev) throw new Error("Event not found");
    const action = await park("delete_event", input, `Delete event "${ev.title}" on ${local(ev.start, tz)}`);
    ctx.onConfirmNeeded?.({ id: action.id, summary: action.summary });
    return { status: "awaiting_confirmation", note: "Nothing was deleted. The owner now sees a Confirm button for this; tell them briefly and do not ask again in text." };
  },

  async update_settings(input) {
    const s = await svc.updateSettings(input);
    return { workingHours: s.workingHours, minBlockMinutes: s.minBlockMinutes, maxBlockMinutes: s.maxBlockMinutes, bufferMinutes: s.bufferMinutes, horizonDays: s.horizonDays };
  },
};

/** Validate the model's input and run the tool. Errors come back as text for the model to read and correct. */
export async function executeTool(name: string, rawInput: unknown, ctx: ToolContext = {}): Promise<{ content: string; isError: boolean }> {
  if (!(name in defs)) return { content: `Unknown tool: ${name}`, isError: true };
  const tool = name as ToolName;
  const parsed = defs[tool].input.safeParse(rawInput);
  if (!parsed.success) {
    return { content: `Invalid input: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`, isError: true };
  }
  try {
    const { timezone } = await getSettings();
    const result = await (handlers[tool] as (i: unknown, c: ToolContext, tz: string) => Promise<unknown>)(parsed.data, ctx, timezone);
    return { content: JSON.stringify(result), isError: false };
  } catch (e) {
    const issues = (e as { issues?: { message: string; path: (string | number)[] }[] }).issues;
    const message = issues?.length ? issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") : e instanceof Error ? e.message : "Tool failed";
    return { content: message, isError: true };
  }
}

/** The owner pressed Confirm or Cancel on a parked action. */
export async function resolvePendingAction(actionId: string, confirm: boolean): Promise<string> {
  const db = await getDb();
  const [action] = await db
    .update(schema.pendingActions)
    .set({ status: confirm ? "confirmed" : "cancelled" })
    .where(and(eq(schema.pendingActions.id, actionId), eq(schema.pendingActions.status, "pending")))
    .returning();
  if (!action) throw new Error("This request was already handled");
  if (!confirm) return `Cancelled: ${action.summary}`;
  const input = action.input as { id: string };
  if (action.tool === "delete_task") await svc.deleteTask(input.id);
  else if (action.tool === "delete_event") await svc.deleteEvent(input.id);
  else throw new Error(`Cannot confirm ${action.tool}`);
  await reschedule();
  return `Done: ${action.summary}`;
}
