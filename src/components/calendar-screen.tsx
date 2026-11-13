"use client";

import FullCalendar, { type CalendarRef, type EventDisplayInfo, type EventInput } from "@fullcalendar/react";
import interactionPlugin from "@fullcalendar/react/interaction";
import classicThemePlugin from "@fullcalendar/react/themes/classic";
import timeGridPlugin from "@fullcalendar/react/timegrid";
import "@fullcalendar/react/skeleton.css";
import "@fullcalendar/react/themes/classic/theme.css";
import "@fullcalendar/react/themes/classic/palette.css";
import { AlertTriangle, Check, ChevronLeft, ChevronRight, Pin, Plus, RefreshCw } from "lucide-react";
import { useMemo, useRef, useState, useSyncExternalStore, useTransition, type ReactNode } from "react";
import { createEvent, deleteEvent, moveBlock, replan, setTaskDone, unpinBlock } from "@/lib/actions";
import { fmtDayTime, fmtDuration, fmtTime, minutesToClock } from "@/lib/format";
import type { Board, TaskVM } from "@/lib/view";
import { TaskDialog, type TaskDialogTarget } from "./task-dialog";
import { TaskRow } from "./task-row";
import { Button, cx, Dialog, ErrorNote, Field, Input, TzProvider } from "./ui";

const noop = () => () => {};
/** False during server render and hydration, true afterwards: the grid depends on the browser's clock and timezone. */
function useIsClient() {
  return useSyncExternalStore(noop, () => true, () => false);
}

type Selected =
  | { kind: "block"; blockId: string; taskId: string }
  | { kind: "event"; eventId: string }
  | { kind: "newEvent"; start: Date; end: Date };

export function CalendarScreen({ board, side }: { board: Board; side?: ReactNode }) {
  const { tasks, projects, blocks, events, settings } = board;
  const isClient = useIsClient();
  const cal = useRef<CalendarRef>(null);
  const [title, setTitle] = useState("");
  const [view, setView] = useState<"timeGridWeek" | "timeGridDay">("timeGridWeek");
  const [dialog, setDialog] = useState<TaskDialogTarget | null>(null);
  const [selected, setSelected] = useState<Selected | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [panelOpen, setPanelOpen] = useState(false);

  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);

  const fcEvents = useMemo<EventInput[]>(() => {
    const out: EventInput[] = events.map((e) => ({
      id: `e:${e.id}`,
      title: e.title,
      start: e.start,
      end: e.end,
      allDay: e.allDay,
      editable: false,
      className: "ev-meeting",
      extendedProps: { kind: "event", eventId: e.id },
    }));
    for (const b of blocks) {
      const task = taskById.get(b.taskId);
      if (!task) continue;
      const color = (task.projectId && projectById.get(task.projectId)?.color) || "var(--accent)";
      const done = task.status === "done";
      out.push({
        id: `b:${b.id}`,
        title: task.title,
        start: b.start,
        end: b.end,
        color,
        editable: !done,
        className: done ? "ev-block ev-done" : "ev-block",
        extendedProps: { kind: "block", blockId: b.id, taskId: b.taskId, pinned: b.pinned, done, risk: !!task.issue },
      });
    }
    return out;
  }, [events, blocks, taskById, projectById]);

  const businessHours = useMemo(
    () =>
      settings.workingHours.map((w) => ({
        daysOfWeek: [w.day],
        startTime: minutesToClock(w.start),
        endTime: minutesToClock(w.end),
      })),
    [settings.workingHours],
  );

  const open = tasks.filter((t) => t.status === "todo");
  const sorted = [...open].sort(
    (a, b) => (a.nextBlock?.start.getTime() ?? Infinity) - (b.nextBlock?.start.getTime() ?? Infinity),
  );
  const done = tasks.filter((t) => t.status === "done");
  const issues = open.filter((t) => t.issue);

  const api = () => cal.current?.getApi();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) =>
    start(async () => {
      const res = await fn();
      if (res.ok) {
        setError(null);
        after?.();
      } else setError(res.error ?? "Something went wrong");
    });

  const selBlock = selected?.kind === "block" ? blocks.find((b) => b.id === selected.blockId) : undefined;
  const selTask = selected?.kind === "block" ? taskById.get(selected.taskId) : undefined;
  const selEvent = selected?.kind === "event" ? events.find((e) => e.id === selected.eventId) : undefined;

  return (
    <TzProvider value={settings.timezone}>
    <div className="flex h-full min-h-0">
      {/* Task panel */}
      <aside
        className={cx(
          "w-80 shrink-0 flex-col border-r border-border bg-surface",
          panelOpen ? "fixed inset-0 z-30 flex w-full" : "hidden lg:flex",
        )}
      >
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">Tasks</h2>
          <div className="flex gap-2">
            <Button size="sm" variant="primary" onClick={() => setDialog({ mode: "new" })}>
              <Plus size={14} /> New task
            </Button>
            <Button size="sm" className="lg:hidden" onClick={() => setPanelOpen(false)}>
              Close
            </Button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {issues.length > 0 && (
            <p className="mx-2 mb-2 flex items-start gap-2 rounded-md bg-danger-soft px-3 py-2 text-xs text-danger">
              <AlertTriangle size={14} className="mt-px shrink-0" />
              {issues.length === 1 ? "1 task needs attention" : `${issues.length} tasks need attention`}: not enough free
              time before a deadline or within the planning window.
            </p>
          )}
          {sorted.length === 0 && (
            <p className="px-3 py-8 text-center text-sm text-muted">Nothing to do. Add a task and it will be placed on your calendar.</p>
          )}
          <ul>
            {sorted.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                project={t.projectId ? projectById.get(t.projectId) : undefined}
                onOpen={(task) => setDialog({ mode: "edit", task })}
              />
            ))}
          </ul>
          {done.length > 0 && (
            <>
              <h3 className="mt-4 px-2 pb-1 text-xs font-medium text-muted">Completed this week</h3>
              <ul>
                {done.map((t) => (
                  <TaskRow key={t.id} task={t} onOpen={(task) => setDialog({ mode: "edit", task })} showProject={false} />
                ))}
              </ul>
            </>
          )}
        </div>
      </aside>

      {/* Calendar */}
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-2 border-b border-border bg-surface px-4 py-2.5">
          <div className="flex items-center gap-1">
            <Button onClick={() => api()?.today()}>Today</Button>
            <Button variant="ghost" aria-label="Previous" onClick={() => api()?.prev()} className="px-2">
              <ChevronLeft size={16} />
            </Button>
            <Button variant="ghost" aria-label="Next" onClick={() => api()?.next()} className="px-2">
              <ChevronRight size={16} />
            </Button>
          </div>
          <h1 className="mr-auto text-base font-semibold">{title}</h1>
          <div className="flex rounded-md border border-border p-0.5 text-xs">
            {(["timeGridWeek", "timeGridDay"] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => {
                  setView(v);
                  api()?.changeView(v);
                }}
                className={cx("rounded px-2.5 py-1 font-medium", view === v ? "bg-accent-soft text-accent" : "text-muted")}
              >
                {v === "timeGridWeek" ? "Week" : "Day"}
              </button>
            ))}
          </div>
          <Button onClick={() => run(replan)} disabled={pending} title="Recompute the plan now">
            <RefreshCw size={14} className={pending ? "animate-spin" : ""} /> Re-plan
          </Button>
          <Button className="lg:hidden" onClick={() => setPanelOpen(true)}>
            Tasks{issues.length ? ` (${issues.length}!)` : ""}
          </Button>
        </header>
        {error && !selected && (
          <div className="px-4 pt-3">
            <ErrorNote message={error} />
          </div>
        )}
        <div className="calendar-host min-h-0 flex-1 bg-surface">
          {isClient && (
            <FullCalendar
              ref={cal}
              plugins={[timeGridPlugin, interactionPlugin, classicThemePlugin]}
              initialView={typeof window !== "undefined" && window.innerWidth < 768 ? "timeGridDay" : "timeGridWeek"}
              headerToolbar={false}
              height="100%"
              firstDay={1}
              nowIndicator
              allDaySlot={events.some((e) => e.allDay)}
              slotDuration="00:30:00"
              snapDuration="00:15:00"
              scrollTime="08:00:00"
              dayHeaderFormat={{ weekday: "short", day: "numeric" }}
              slotHeaderFormat={{ hour: "numeric", meridiem: "short" }}
              businessHours={businessHours}
              events={fcEvents}
              eventContent={renderEvent}
              selectable
              selectMirror
              select={(sel) => {
                setError(null);
                setSelected({ kind: "newEvent", start: sel.start, end: sel.end });
              }}
              datesSet={(arg) => {
                setTitle(arg.view.title);
                setView(arg.view.type as typeof view);
              }}
              eventClick={({ event }) => {
                setError(null);
                const p = event.extendedProps;
                if (p.kind === "block") setSelected({ kind: "block", blockId: p.blockId, taskId: p.taskId });
                else setSelected({ kind: "event", eventId: p.eventId });
              }}
              eventDrop={(info) =>
                start(async () => {
                  const res = await moveBlock(info.event.extendedProps.blockId, info.event.start!.toISOString(), info.event.end!.toISOString());
                  if (!res.ok) {
                    info.revert();
                    setError(res.error);
                  }
                })
              }
              eventResize={(info) =>
                start(async () => {
                  const res = await moveBlock(info.event.extendedProps.blockId, info.event.start!.toISOString(), info.event.end!.toISOString());
                  if (!res.ok) {
                    info.revert();
                    setError(res.error);
                  }
                })
              }
            />
          )}
        </div>
      </section>

      {side}

      <TaskDialog target={dialog} onClose={() => setDialog(null)} projects={projects} tasks={tasks} />

      <Dialog open={!!selBlock && !!selTask} onClose={() => setSelected(null)} title={selTask?.title ?? ""}>
        {selBlock && selTask && (
          <div className="space-y-4 text-sm">
            <p className="text-muted">
              {fmtDayTime(selBlock.start)} – {fmtTime(selBlock.end)} · {fmtDuration((selBlock.end.getTime() - selBlock.start.getTime()) / 60000)}
              {selTask.durationMinutes * 60000 > selBlock.end.getTime() - selBlock.start.getTime() &&
                ` of ${fmtDuration(selTask.durationMinutes)} total`}
            </p>
            {selBlock.pinned && (
              <p className="flex items-center gap-2 text-muted">
                <Pin size={14} /> Pinned here. It will not be moved automatically.
              </p>
            )}
            {selTask.issue && <ErrorNote message={selTask.issue.text} />}
            {selTask.notes && <p className="whitespace-pre-wrap">{selTask.notes}</p>}
            <ErrorNote message={error} />
            <div className="flex flex-wrap justify-end gap-2">
              {selBlock.pinned && (
                <Button disabled={pending} onClick={() => run(() => unpinBlock(selBlock.id), () => setSelected(null))}>
                  Unpin
                </Button>
              )}
              <Button
                onClick={() => {
                  setSelected(null);
                  setDialog({ mode: "edit", task: selTask });
                }}
              >
                Edit task
              </Button>
              <Button
                variant="primary"
                disabled={pending}
                onClick={() => run(() => setTaskDone(selTask.id, selTask.status !== "done"), () => setSelected(null))}
              >
                <Check size={14} /> {selTask.status === "done" ? "Mark not done" : "Complete"}
              </Button>
            </div>
          </div>
        )}
      </Dialog>

      <Dialog open={!!selEvent} onClose={() => setSelected(null)} title={selEvent?.title ?? ""}>
        {selEvent && (
          <div className="space-y-4 text-sm">
            <p className="text-muted">
              {selEvent.allDay ? "All day" : `${fmtDayTime(selEvent.start)} – ${fmtTime(selEvent.end)}`}
            </p>
            <p className="text-muted">Tasks are scheduled around this event.</p>
            <ErrorNote message={error} />
            <div className="flex justify-end">
              <Button variant="danger" disabled={pending} onClick={() => run(() => deleteEvent(selEvent.id), () => setSelected(null))}>
                Delete event
              </Button>
            </div>
          </div>
        )}
      </Dialog>

      <Dialog open={selected?.kind === "newEvent"} onClose={() => setSelected(null)} title="New event">
        {selected?.kind === "newEvent" && (
          <NewEventForm
            start={selected.start}
            end={selected.end}
            onDone={() => {
              setSelected(null);
              api()?.unselect();
            }}
            onTask={(defaults) => {
              setSelected(null);
              api()?.unselect();
              setDialog({ mode: "new", defaults });
            }}
          />
        )}
      </Dialog>
    </div>
    </TzProvider>
  );
}

function NewEventForm({
  start,
  end,
  onDone,
  onTask,
}: {
  start: Date;
  end: Date;
  onDone: () => void;
  onTask: (defaults: Partial<TaskVM>) => void;
}) {
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, go] = useTransition();
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        go(async () => {
          const res = await createEvent({ title, start: start.toISOString(), end: end.toISOString() });
          if (res.ok) onDone();
          else setError(res.error);
        });
      }}
    >
      <p className="text-sm text-muted">
        {fmtDayTime(start)} – {fmtTime(end)}
      </p>
      <Field label="Title">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus placeholder="Meeting, appointment…" />
      </Field>
      <ErrorNote message={error} />
      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={() => onTask({ title, durationMinutes: Math.round((end.getTime() - start.getTime()) / 60000) })}>
          Make it a task instead
        </Button>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Adding…" : "Add event"}
        </Button>
      </div>
    </form>
  );
}

function renderEvent(arg: EventDisplayInfo) {
  const p = arg.event.extendedProps;
  return (
    <div className="ev-content flex h-full flex-col px-1 py-0.5 text-xs leading-tight">
      <div className="flex items-center gap-1">
        {p.pinned && <Pin size={10} className="shrink-0" aria-label="Pinned" />}
        {p.risk && !p.done && <AlertTriangle size={10} className="shrink-0" aria-label="At risk" />}
        <span className="ev-title truncate font-medium">{arg.event.title}</span>
      </div>
      {!arg.event.allDay && <span className="truncate text-[10px] opacity-80">{arg.timeText}</span>}
    </div>
  );
}
