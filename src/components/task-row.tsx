"use client";

import { AlertTriangle, Check, Clock, Flag, Repeat } from "lucide-react";
import { useTransition } from "react";
import type { Project } from "@/db/schema";
import { setTaskDone } from "@/lib/actions";
import { fmtDay, fmtDayTime, fmtDuration } from "@/lib/format";
import type { TaskVM } from "@/lib/view";
import { Badge, cx, useTz } from "./ui";

export function TaskRow({
  task,
  project,
  onOpen,
  showProject = true,
}: {
  task: TaskVM;
  project?: Project;
  onOpen: (t: TaskVM) => void;
  showProject?: boolean;
}) {
  const [pending, start] = useTransition();
  const tz = useTz();
  const done = task.status === "done";
  return (
    <li className={cx("group flex items-start gap-2.5 rounded-lg px-2 py-2 hover:bg-surface-2", pending && "opacity-50")}>
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={done ? `Mark "${task.title}" as not done` : `Complete "${task.title}"`}
        onClick={() => start(async () => void (await setTaskDone(task.id, !done)))}
        className={cx(
          "mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-full border",
          done ? "border-accent bg-accent text-accent-text" : "border-muted/60 hover:border-accent",
        )}
      >
        {done && <Check size={12} strokeWidth={3} />}
      </button>
      <button type="button" onClick={() => onOpen(task)} className="min-w-0 flex-1 text-left">
        <span className={cx("block truncate text-sm", done && "text-muted line-through")}>{task.title}</span>
        <span className="mt-1 flex flex-wrap items-center gap-1">
          {showProject && project && (
            <Badge>
              <span className="size-1.5 rounded-full" style={{ background: project.color }} />
              {project.name}
            </Badge>
          )}
          <Badge>
            <Clock size={10} />
            {fmtDuration(task.durationMinutes)}
          </Badge>
          {task.priority <= 2 && !done && (
            <Badge tone={task.priority === 1 ? "danger" : "accent"}>
              <Flag size={10} />
              {task.priority === 1 ? "Urgent" : "High"}
            </Badge>
          )}
          {task.templateId && (
            <Badge>
              <Repeat size={10} />
            </Badge>
          )}
          {!done && task.deadline && !task.templateId && <Badge>Due {fmtDay(task.deadline, tz)}</Badge>}
          {!done && task.issue && (
            <Badge tone="danger">
              <AlertTriangle size={10} />
              {task.issue.kind === "atRisk" ? "At risk" : "Not scheduled"}
            </Badge>
          )}
          {!done && task.nextBlock && <span className="text-[11px] text-muted">{fmtDayTime(task.nextBlock.start, tz)}</span>}
        </span>
      </button>
    </li>
  );
}
