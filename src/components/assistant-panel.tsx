"use client";

import { ArrowUp, Sparkles, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { clearChat, resolvePending } from "@/lib/actions";
import type { ChatEvent, TranscriptItem } from "@/lib/ai/chat";
import { Button, cx } from "./ui";

type Item = TranscriptItem | { role: "note"; text: string };
type Pending = { id: string; summary: string };

const SUGGESTIONS = ["What does my day look like?", "Add 2 hours to prepare slides, due Friday", "Is anything at risk of being late?"];

const TOOL_LABELS: Record<string, string> = {
  get_schedule: "Reading your schedule",
  list_tasks: "Looking at your tasks",
  create_task: "Adding a task",
  update_task: "Updating a task",
  complete_task: "Completing a task",
  delete_task: "Preparing a delete request",
  pin_task_block: "Pinning a block",
  list_projects: "Looking at your projects",
  create_project: "Creating a project",
  create_event: "Adding an event",
  delete_event: "Preparing a delete request",
  update_settings: "Updating settings",
};

export function AssistantPanel({ configured, transcript, pending: initialPending }: { configured: boolean; transcript: TranscriptItem[]; pending: Pending[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[]>(transcript);
  const [pending, setPending] = useState<Pending[]>(initialPending);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [acting, startAction] = useTransition();
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [items, status, pending]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    setInput("");
    setError(null);
    setBusy(true);
    setStatus("Thinking");
    setItems((it) => [...it, { role: "user", text: message }, { role: "assistant", text: "" }]);
    const append = (t: string) =>
      setItems((it) => {
        const last = it[it.length - 1];
        return [...it.slice(0, -1), { ...last, text: (last.text + t).replace(/^\n+/, "") }];
      });

    try {
      const res = await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message }) });
      if (!res.ok || !res.body) throw new Error(res.status === 401 ? "You are signed out. Reload the page." : "The assistant is unavailable.");
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line) continue;
          const event = JSON.parse(line) as ChatEvent;
          if (event.type === "text") {
            setStatus(null);
            append(event.text);
          } else if (event.type === "tool") setStatus(TOOL_LABELS[event.name] ?? "Working");
          else if (event.type === "confirm") setPending((p) => [...p, { id: event.id, summary: event.summary }]);
          else if (event.type === "error") setError(event.message);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setItems((it) => it.filter((x, i) => !(i === it.length - 1 && x.role === "assistant" && !x.text.trim())));
      setBusy(false);
      setStatus(null);
      router.refresh(); // the assistant may have changed tasks or the plan
    }
  }

  function answer(action: Pending, confirm: boolean) {
    startAction(async () => {
      const res = await resolvePending(action.id, confirm);
      setPending((p) => p.filter((x) => x.id !== action.id));
      setItems((it) => [...it, { role: "note", text: res.ok ? res.data : res.error }]);
    });
  }

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed right-4 bottom-20 z-20 flex h-11 items-center gap-2 rounded-full bg-accent px-4 text-sm font-medium text-accent-text shadow-lg md:bottom-4 2xl:hidden"
        >
          <Sparkles size={16} /> Assistant
        </button>
      )}
      <aside
        aria-label="Assistant"
        className={cx(
          "w-[340px] shrink-0 flex-col border-l border-border bg-surface 2xl:flex",
          open ? "fixed inset-y-0 right-0 z-30 flex w-full max-w-[400px] shadow-2xl 2xl:static 2xl:w-[340px] 2xl:shadow-none" : "hidden",
        )}
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Sparkles size={16} className="text-accent" />
          <h2 className="mr-auto text-sm font-semibold">Assistant</h2>
          {items.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || acting}
              onClick={() =>
                startAction(async () => {
                  await clearChat();
                  setItems([]);
                  setPending([]);
                  setError(null);
                })
              }
            >
              New chat
            </Button>
          )}
          <button type="button" aria-label="Close assistant" onClick={() => setOpen(false)} className="rounded p-1 text-muted hover:bg-surface-2 2xl:hidden">
            <X size={16} />
          </button>
        </div>

        <div ref={scroller} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 text-sm" aria-live="polite">
          {!configured ? (
            <p className="rounded-lg bg-surface-2 p-3 text-muted">
              Add an ANTHROPIC_API_KEY to turn on the assistant. Everything else works without it.
            </p>
          ) : items.length === 0 ? (
            <div className="space-y-2">
              <p className="text-muted">Tell me what you need to get done, or ask about your week. I add tasks, move things and explain the plan.</p>
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" onClick={() => send(s)} className="block w-full rounded-lg border border-border px-3 py-2 text-left hover:bg-surface-2">
                  {s}
                </button>
              ))}
            </div>
          ) : null}

          {items.map((m, i) =>
            m.role === "note" ? (
              <p key={i} className="text-center text-xs text-muted">{m.text}</p>
            ) : (
              <div key={i} className={cx("flex", m.role === "user" && "justify-end")}>
                <p className={cx("max-w-[90%] rounded-2xl px-3 py-2 whitespace-pre-wrap", m.role === "user" ? "bg-accent text-accent-text" : "bg-surface-2", !m.text && "hidden")}>
                  {m.text}
                </p>
              </div>
            ),
          )}
          {status && <p className="animate-pulse text-xs text-muted" role="status">{status}…</p>}

          {pending.map((p) => (
            <div key={p.id} className="rounded-lg border border-border p-3">
              <p className="font-medium">{p.summary}?</p>
              <div className="mt-2 flex gap-2">
                <Button size="sm" variant="danger" disabled={acting} onClick={() => answer(p, true)}>Confirm</Button>
                <Button size="sm" disabled={acting} onClick={() => answer(p, false)}>Cancel</Button>
              </div>
            </div>
          ))}
          {error && <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-danger">{error}</p>}
        </div>

        <form
          className="border-t border-border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
        >
          <div className="flex items-end gap-2 rounded-xl border border-border bg-bg p-1.5 focus-within:border-accent">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
              rows={1}
              disabled={!configured}
              aria-label="Message the assistant"
              placeholder={configured ? "Add a task, ask about your week…" : "Assistant is not configured"}
              className="max-h-32 min-h-8 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted"
            />
            <button
              type="submit"
              disabled={!configured || busy || !input.trim()}
              aria-label="Send"
              className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-text disabled:opacity-40"
            >
              <ArrowUp size={16} />
            </button>
          </div>
        </form>
      </aside>
    </>
  );
}
