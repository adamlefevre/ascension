"use client";

import { useState, useTransition } from "react";
import type { Project, Task } from "@/db/schema";
import { createTask, deleteTask, updateTask } from "@/lib/actions";
import { fromLocalInput, PRIORITIES, toLocalInput } from "@/lib/format";
import { Button, Dialog, ErrorNote, Field, Input, Select, Textarea } from "./ui";

const DAYS = [
  ["MO", "Mon"], ["TU", "Tue"], ["WE", "Wed"], ["TH", "Thu"], ["FR", "Fri"], ["SA", "Sat"], ["SU", "Sun"],
] as const;

function parseRule(rule: string | null): { repeat: "none" | "daily" | "weekly"; days: string[] } {
  if (!rule) return { repeat: "none", days: ["MO"] };
  const byday = /BYDAY=([A-Z,]+)/.exec(rule)?.[1].split(",");
  if (/FREQ=WEEKLY/.test(rule)) return { repeat: "weekly", days: byday ?? ["MO"] };
  return { repeat: "daily", days: ["MO"] };
}

export type TaskDialogTarget = { mode: "new"; defaults?: Partial<Task> } | { mode: "edit"; task: Task };

export function TaskDialog({
  target,
  onClose,
  projects,
  tasks,
}: {
  target: TaskDialogTarget | null;
  onClose: () => void;
  projects: Project[];
  tasks: Pick<Task, "id" | "title" | "status">[];
}) {
  return (
    <Dialog open={!!target} onClose={onClose} title={target?.mode === "edit" ? "Edit task" : "New task"} wide>
      {target && (
        <TaskForm
          key={target.mode === "edit" ? target.task.id : "new"}
          target={target}
          onClose={onClose}
          projects={projects}
          tasks={tasks}
        />
      )}
    </Dialog>
  );
}

function TaskForm({
  target,
  onClose,
  projects,
  tasks,
}: {
  target: TaskDialogTarget;
  onClose: () => void;
  projects: Project[];
  tasks: Pick<Task, "id" | "title" | "status">[];
}) {
  const t: Partial<Task> = target.mode === "edit" ? target.task : (target.defaults ?? {});
  const editing = target.mode === "edit" ? target.task : null;
  const isInstance = !!editing?.templateId;
  const initialRule = parseRule(editing?.isTemplate ? (editing.recurrenceRule ?? null) : null);

  const [title, setTitle] = useState(t.title ?? "");
  const [notes, setNotes] = useState(t.notes ?? "");
  const [hours, setHours] = useState(String(Math.floor((t.durationMinutes ?? 30) / 60)));
  const [mins, setMins] = useState(String((t.durationMinutes ?? 30) % 60));
  const [priority, setPriority] = useState(String(t.priority ?? 3));
  const [deadline, setDeadline] = useState(toLocalInput(t.deadline));
  const [deadlineHard, setDeadlineHard] = useState(t.deadlineHard ?? false);
  const [earliest, setEarliest] = useState(toLocalInput(t.earliestStart));
  const [projectId, setProjectId] = useState(t.projectId ?? "");
  const [blockedBy, setBlockedBy] = useState(t.blockedByTaskId ?? "");
  const [splittable, setSplittable] = useState(t.splittable ?? true);
  const [repeat, setRepeat] = useState(initialRule.repeat);
  const [days, setDays] = useState<string[]>(initialRule.days);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const recurring = repeat !== "none";
  const canRepeat = !editing || editing.isTemplate;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const durationMinutes = (Number(hours) || 0) * 60 + (Number(mins) || 0);
    if (durationMinutes < 5) return setError("Duration must be at least 5 minutes");
    if (repeat === "weekly" && !days.length) return setError("Pick at least one day");
    const input = {
      title,
      notes: notes || null,
      durationMinutes,
      priority: Number(priority),
      deadline: recurring ? null : fromLocalInput(deadline),
      deadlineHard,
      earliestStart: recurring ? null : fromLocalInput(earliest),
      projectId: projectId || null,
      blockedByTaskId: recurring ? null : blockedBy || null,
      splittable,
      ...(canRepeat && recurring
        ? { recurrenceRule: repeat === "daily" ? "FREQ=DAILY" : `FREQ=WEEKLY;BYDAY=${days.join(",")}` }
        : {}),
    };
    start(async () => {
      const res = editing ? await updateTask(editing.id, input) : await createTask(input);
      if (res.ok) onClose();
      else setError(res.error);
    });
  }

  function remove() {
    if (!editing) return;
    start(async () => {
      const res = await deleteTask(editing.id);
      if (res.ok) onClose();
      else setError(res.error);
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Title">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus placeholder="What needs doing?" />
      </Field>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Hours">
          <Input type="number" min={0} max={40} value={hours} onChange={(e) => setHours(e.target.value)} />
        </Field>
        <Field label="Minutes">
          <Select value={mins} onChange={(e) => setMins(e.target.value)}>
            {[0, 15, 30, 45].concat([0, 15, 30, 45].includes(Number(mins)) ? [] : [Number(mins)]).map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </Select>
        </Field>
        <Field label="Priority">
          <Select value={priority} onChange={(e) => setPriority(e.target.value)}>
            {PRIORITIES.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Project">
          <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">None</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </Select>
        </Field>
      </div>

      {canRepeat && !isInstance && (
        <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
          <Field label="Repeats">
            <Select value={repeat} onChange={(e) => setRepeat(e.target.value as typeof repeat)} disabled={!!editing}>
              <option value="none">Does not repeat</option>
              <option value="daily">Every day</option>
              <option value="weekly">Weekly on…</option>
            </Select>
          </Field>
          {repeat === "weekly" && (
            <fieldset className="text-sm">
              <legend className="mb-1 text-xs font-medium text-muted">On these days</legend>
              <div className="flex flex-wrap gap-1">
                {DAYS.map(([code, label]) => {
                  const on = days.includes(code);
                  return (
                    <button
                      key={code}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setDays(on ? days.filter((d) => d !== code) : [...days, code])}
                      className={`h-9 rounded-md border px-2.5 text-xs font-medium ${on ? "border-accent bg-accent-soft text-accent" : "border-border text-muted"}`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          )}
        </div>
      )}

      {!recurring && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Deadline">
              <Input type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
            </Field>
            <Field label="Do not start before">
              <Input type="datetime-local" value={earliest} onChange={(e) => setEarliest(e.target.value)} />
            </Field>
          </div>
          <Field label="Blocked by" hint="This task is scheduled only after the other one is planned to finish.">
            <Select value={blockedBy} onChange={(e) => setBlockedBy(e.target.value)}>
              <option value="">Nothing</option>
              {tasks
                .filter((x) => x.status === "todo" && x.id !== editing?.id)
                .map((x) => (
                  <option key={x.id} value={x.id}>{x.title}</option>
                ))}
            </Select>
          </Field>
        </>
      )}

      <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={splittable} onChange={(e) => setSplittable(e.target.checked)} />
          Can be split into several blocks
        </label>
        {!recurring && (
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={deadlineHard} onChange={(e) => setDeadlineHard(e.target.checked)} />
            Deadline is firm
          </label>
        )}
      </div>

      <Field label="Notes">
        <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>

      <ErrorNote message={error} />
      <div className="flex items-center justify-between gap-2 pt-1">
        {editing ? (
          <Button variant="danger" onClick={remove} disabled={pending}>
            Delete
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? "Saving…" : editing ? "Save" : "Add task"}
          </Button>
        </div>
      </div>
    </form>
  );
}
