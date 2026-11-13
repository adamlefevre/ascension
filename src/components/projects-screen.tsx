"use client";

import { AlertTriangle, Pencil, Plus } from "lucide-react";
import { useState, useTransition } from "react";
import type { Project } from "@/db/schema";
import { createProject, deleteProject, updateProject } from "@/lib/actions";
import { fmtDay, fmtDuration, fromLocalInput, toLocalInput } from "@/lib/format";
import type { Board } from "@/lib/view";
import { TaskDialog, type TaskDialogTarget } from "./task-dialog";
import { TaskRow } from "./task-row";
import { Badge, Button, Dialog, ErrorNote, Field, Input, TzProvider } from "./ui";

const COLORS = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#8b5cf6", "#64748b"];

export type ProjectStat = { total: number; done: number; minutesLeft: number };

export function ProjectsScreen({ board, stats }: { board: Board; stats: Record<string, ProjectStat> }) {
  const { projects, tasks, settings } = board;
  const tz = settings.timezone;
  const [editing, setEditing] = useState<Project | "new" | null>(null);
  const [dialog, setDialog] = useState<TaskDialogTarget | null>(null);

  return (
    <TzProvider value={tz}>
      <div className="h-full overflow-y-auto">
        <div className="mx-auto max-w-5xl px-4 py-6">
          <header className="mb-6 flex items-center gap-3">
            <h1 className="mr-auto text-xl font-semibold">Projects</h1>
            <Button variant="primary" onClick={() => setEditing("new")}>
              <Plus size={16} /> New project
            </Button>
          </header>
          {projects.length === 0 && (
            <p className="rounded-xl border border-dashed border-border px-4 py-12 text-center text-sm text-muted">
              Group related tasks into a project to track them against one deadline.
            </p>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            {projects.map((p) => {
              const s = stats[p.id] ?? { total: 0, done: 0, minutesLeft: 0 };
              const open = tasks.filter((t) => t.projectId === p.id && t.status === "todo");
              const lastEnd = Math.max(0, ...open.map((t) => t.nextBlock?.end.getTime() ?? 0));
              const late = open.some((t) => t.issue) || (p.deadline != null && lastEnd > p.deadline.getTime());
              const pct = s.total ? Math.round((s.done / s.total) * 100) : 0;
              return (
                <section key={p.id} className="rounded-xl border border-border bg-surface p-4">
                  <div className="flex items-start gap-2">
                    <span className="mt-1.5 size-2.5 shrink-0 rounded-full" style={{ background: p.color }} />
                    <div className="min-w-0 flex-1">
                      <h2 className="truncate font-semibold">{p.name}</h2>
                      <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                        {s.done}/{s.total} done · {fmtDuration(s.minutesLeft)} left
                        {p.deadline && <Badge>Due {fmtDay(p.deadline, tz)}</Badge>}
                        {late && (
                          <Badge tone="danger">
                            <AlertTriangle size={10} /> At risk
                          </Badge>
                        )}
                      </p>
                    </div>
                    <Button size="sm" variant="ghost" aria-label={`Edit ${p.name}`} onClick={() => setEditing(p)}>
                      <Pencil size={14} />
                    </Button>
                  </div>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: p.color }} />
                  </div>
                  <ul className="mt-2">
                    {open.map((t) => (
                      <TaskRow key={t.id} task={t} showProject={false} onOpen={(task) => setDialog({ mode: "edit", task })} />
                    ))}
                  </ul>
                  <Button size="sm" variant="ghost" className="mt-1" onClick={() => setDialog({ mode: "new", defaults: { projectId: p.id } })}>
                    <Plus size={14} /> Add task
                  </Button>
                </section>
              );
            })}
          </div>
        </div>
        <Dialog open={!!editing} onClose={() => setEditing(null)} title={editing === "new" ? "New project" : "Edit project"}>
          {editing && <ProjectForm key={editing === "new" ? "new" : editing.id} project={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
        </Dialog>
        <TaskDialog target={dialog} onClose={() => setDialog(null)} projects={projects} tasks={tasks} />
      </div>
    </TzProvider>
  );
}

function ProjectForm({ project, onClose }: { project: Project | null; onClose: () => void }) {
  const [name, setName] = useState(project?.name ?? "");
  const [color, setColor] = useState(project?.color ?? COLORS[0]);
  const [deadline, setDeadline] = useState(toLocalInput(project?.deadline));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const finish = (res: { ok: boolean; error?: string }) => (res.ok ? onClose() : setError(res.error ?? "Failed"));

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const input = { name, color, deadline: fromLocalInput(deadline) };
        start(async () => finish(project ? await updateProject(project.id, input) : await createProject(input)));
      }}
    >
      <Field label="Name">
        <Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
      </Field>
      <fieldset>
        <legend className="mb-1 text-xs font-medium text-muted">Colour</legend>
        <div className="flex gap-2">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Colour ${c}`}
              aria-pressed={color === c}
              onClick={() => setColor(c)}
              className="size-7 rounded-full ring-offset-2 ring-offset-surface aria-pressed:ring-2 aria-pressed:ring-text"
              style={{ background: c }}
            />
          ))}
        </div>
      </fieldset>
      <Field label="Deadline">
        <Input type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
      </Field>
      <ErrorNote message={error} />
      <div className="flex items-center justify-between gap-2">
        {project ? (
          <Button variant="danger" disabled={pending} onClick={() => start(async () => finish(await deleteProject(project.id)))}>
            Delete
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={pending}>
            Save
          </Button>
        </div>
      </div>
      {project && <p className="text-xs text-muted">Deleting a project keeps its tasks; they just lose the project label.</p>}
    </form>
  );
}
