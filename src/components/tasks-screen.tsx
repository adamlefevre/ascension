"use client";

import { Plus, Repeat } from "lucide-react";
import { useMemo, useState } from "react";
import { fmtDuration } from "@/lib/format";
import type { Board } from "@/lib/view";
import { TaskDialog, type TaskDialogTarget } from "./task-dialog";
import { TaskRow } from "./task-row";
import { Button, Select, TzProvider } from "./ui";

export function TasksScreen({ board }: { board: Board }) {
  const { tasks, templates, projects, settings } = board;
  const [dialog, setDialog] = useState<TaskDialogTarget | null>(null);
  const [project, setProject] = useState("all");
  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);

  const match = (t: { projectId: string | null }) =>
    project === "all" || (project === "none" ? !t.projectId : t.projectId === project);
  const open = tasks
    .filter((t) => t.status === "todo" && match(t))
    .sort((a, b) => (a.nextBlock?.start.getTime() ?? Infinity) - (b.nextBlock?.start.getTime() ?? Infinity));
  const attention = open.filter((t) => t.issue);
  const planned = open.filter((t) => !t.issue);
  const done = tasks.filter((t) => t.status === "done" && match(t));
  const recurring = templates.filter(match);
  const totalMinutes = open.reduce((s, t) => s + t.durationMinutes, 0);

  const section = (title: string, list: typeof open, hint?: string) =>
    list.length > 0 && (
      <section className="mb-6">
        <h2 className="mb-1 px-2 text-xs font-medium text-muted">
          {title} · {list.length}
          {hint && <span className="font-normal"> · {hint}</span>}
        </h2>
        <ul className="rounded-xl border border-border bg-surface p-1">
          {list.map((t) => (
            <TaskRow
              key={t.id}
              task={t}
              project={t.projectId ? projectById.get(t.projectId) : undefined}
              onOpen={(task) => setDialog({ mode: "edit", task })}
            />
          ))}
        </ul>
      </section>
    );

  return (
    <TzProvider value={settings.timezone}>
      <div className="h-full overflow-y-auto">
        <div className="mx-auto max-w-3xl px-4 py-6">
          <header className="mb-6 flex flex-wrap items-center gap-3">
            <div className="mr-auto">
              <h1 className="text-xl font-semibold">Tasks</h1>
              <p className="text-sm text-muted">
                {open.length} open · {fmtDuration(totalMinutes)} of work to place
              </p>
            </div>
            <Select value={project} onChange={(e) => setProject(e.target.value)} className="w-44" aria-label="Filter by project">
              <option value="all">All projects</option>
              <option value="none">No project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
            <Button variant="primary" onClick={() => setDialog({ mode: "new" })}>
              <Plus size={16} /> New task
            </Button>
          </header>

          {open.length + done.length + recurring.length === 0 && (
            <p className="rounded-xl border border-dashed border-border px-4 py-12 text-center text-sm text-muted">
              No tasks here yet.
            </p>
          )}
          {section("Needs attention", attention, "not enough free time")}
          {section("Scheduled", planned)}

          {recurring.length > 0 && (
            <section className="mb-6">
              <h2 className="mb-1 px-2 text-xs font-medium text-muted">Repeating · {recurring.length}</h2>
              <ul className="rounded-xl border border-border bg-surface p-1">
                {recurring.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => setDialog({ mode: "edit", task: t })}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm hover:bg-surface-2"
                    >
                      <Repeat size={16} className="shrink-0 text-muted" />
                      <span className="min-w-0 flex-1 truncate">{t.title}</span>
                      <span className="text-xs text-muted">
                        {fmtDuration(t.durationMinutes)} · {describeRule(t.recurrenceRule)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {section("Completed this week", done)}
        </div>
        <TaskDialog target={dialog} onClose={() => setDialog(null)} projects={projects} tasks={tasks} />
      </div>
    </TzProvider>
  );
}

const DAY_NAMES: Record<string, string> = { MO: "Mon", TU: "Tue", WE: "Wed", TH: "Thu", FR: "Fri", SA: "Sat", SU: "Sun" };

function describeRule(rule: string | null) {
  if (!rule) return "";
  const days = /BYDAY=([A-Z,]+)/.exec(rule)?.[1];
  if (/FREQ=WEEKLY/.test(rule)) return days ? days.split(",").map((d) => DAY_NAMES[d] ?? d).join(", ") : "Weekly";
  if (/FREQ=DAILY/.test(rule)) return "Every day";
  return rule;
}
