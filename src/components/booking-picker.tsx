"use client";

import { CalendarCheck, ChevronLeft, Clock } from "lucide-react";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { fmtDuration } from "@/lib/format";
import { Button, cx, ErrorNote, Field, Input, Textarea } from "./ui";

const noSub = () => () => {};

type Data = { slots: string[]; timezone: string };

/** Public page for guests. Times are shown in the guest's own timezone. */
export function BookingPicker({ slug, title, durationMinutes }: { slug: string; title: string; durationMinutes: number }) {
  const [data, setData] = useState<Data | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [website, setWebsite] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState<{ start: string; meetLink: string | null } | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let live = true;
    fetch(`/api/book/${encodeURIComponent(slug)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Could not load available times."))))
      .then((d: Data) => live && setData(d))
      .catch((e: Error) => live && setLoadError(e.message));
    return () => {
      live = false;
    };
  }, [slug, nonce]);

  const tz = useSyncExternalStore(noSub, () => Intl.DateTimeFormat().resolvedOptions().timeZone, () => "your timezone");
  const byDay = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const s of data?.slots ?? []) {
      const k = new Date(s).toLocaleDateString("en-CA");
      m.set(k, [...(m.get(k) ?? []), s]);
    }
    return m;
  }, [data]);
  const days = [...byDay.keys()];
  const activeDay = day && byDay.has(day) ? day : (days[0] ?? null);
  const fmtDayLabel = (k: string) => new Date(`${k}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const fmtTime = (s: string) => new Date(s).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const fmtFull = (s: string) => new Date(s).toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!slot) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/book/${encodeURIComponent(slug)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ start: slot, name, email, note: note || undefined, website: website || undefined }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) setDone({ start: json.start, meetLink: json.meetLink });
      else {
        setError(json.error ?? "Booking failed. Please try again.");
        if (res.status === 409) {
          setSlot(null);
          setNonce((n) => n + 1);
        }
      }
    } catch {
      setError("Booking failed. Please check your connection and try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-xl rounded-2xl border border-border bg-surface p-6">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="mt-1 flex items-center gap-1.5 text-sm text-muted">
        <Clock size={14} /> {fmtDuration(durationMinutes)} · times shown in {tz}
      </p>

      {done ? (
        <div className="mt-6 space-y-2 text-sm" role="status">
          <p className="flex items-center gap-2 text-base font-medium text-ok">
            <CalendarCheck size={18} /> You are booked
          </p>
          <p>{fmtFull(done.start)}</p>
          <p className="text-muted">A calendar invitation is on its way to {email}.</p>
          {done.meetLink && (
            <p>
              Video link: <a className="text-accent underline" href={done.meetLink}>{done.meetLink}</a>
            </p>
          )}
        </div>
      ) : loadError ? (
        <div className="mt-6"><ErrorNote message={loadError} /></div>
      ) : !data ? (
        <p className="mt-6 text-sm text-muted">Loading available times…</p>
      ) : days.length === 0 ? (
        <p className="mt-6 text-sm text-muted">No times are available right now. Please check back later.</p>
      ) : slot ? (
        <form onSubmit={submit} className="mt-6 space-y-4">
          <button type="button" onClick={() => setSlot(null)} className="flex items-center gap-1 text-sm text-accent">
            <ChevronLeft size={14} /> {fmtFull(slot)}
          </button>
          <Field label="Your name"><Input value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" /></Field>
          <Field label="Email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" /></Field>
          <Field label="Anything to share beforehand? (optional)"><Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <input type="text" tabIndex={-1} autoComplete="off" aria-hidden value={website} onChange={(e) => setWebsite(e.target.value)} className="hidden" name="website" />
          <ErrorNote message={error} />
          <Button type="submit" variant="primary" disabled={sending} className="w-full">{sending ? "Booking…" : "Confirm booking"}</Button>
        </form>
      ) : (
        <div className="mt-6">
          <ErrorNote message={error} />
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2" role="tablist" aria-label="Day">
            {days.map((k) => (
              <button key={k} type="button" role="tab" aria-selected={k === activeDay} onClick={() => setDay(k)}
                className={cx("shrink-0 rounded-lg border px-3 py-2 text-sm whitespace-nowrap", k === activeDay ? "border-accent bg-accent-soft text-accent" : "border-border")}>
                {fmtDayLabel(k)}
              </button>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
            {(activeDay ? byDay.get(activeDay)! : []).map((s) => (
              <button key={s} type="button" onClick={() => setSlot(s)} className="rounded-lg border border-border py-2 text-sm hover:border-accent hover:text-accent">
                {fmtTime(s)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
