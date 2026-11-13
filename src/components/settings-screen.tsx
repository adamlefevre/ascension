"use client";

import { useState, useSyncExternalStore, useTransition, type ReactNode } from "react";
import type { CalendarRow, Settings } from "@/db/schema";
import { setCalendarBusy, updateSettings } from "@/lib/actions";
import { clockToMinutes, minutesToClock } from "@/lib/format";
import { Button, ErrorNote, Field, Input, Select } from "./ui";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const ORDER = [1, 2, 3, 4, 5, 6, 0];
const noSubscribe = () => () => {};

export function Card({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <h2 className="font-semibold">{title}</h2>
      {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function SchedulingSettings({ settings, timezones }: { settings: Settings; timezones: string[] }) {
  const [hours, setHours] = useState(() =>
    ORDER.map((day) => {
      const w = settings.workingHours.find((x) => x.day === day);
      return { day, on: !!w, start: minutesToClock(w?.start ?? 540), end: minutesToClock(w?.end ?? 1020) };
    }),
  );
  const [timezone, setTimezone] = useState(settings.timezone);
  const [minBlock, setMinBlock] = useState(String(settings.minBlockMinutes));
  const [maxBlock, setMaxBlock] = useState(String(settings.maxBlockMinutes));
  const [buffer, setBuffer] = useState(String(settings.bufferMinutes));
  const [horizon, setHorizon] = useState(String(settings.horizonDays));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  // Known only in the browser; during server render and hydration we fall back to the saved timezone.
  const browserTz = useSyncExternalStore(
    noSubscribe,
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    () => settings.timezone,
  );

  const patch = (day: number, p: Partial<(typeof hours)[number]>) => {
    setSaved(false);
    setHours((h) => h.map((x) => (x.day === day ? { ...x, ...p } : x)));
  };

  function save(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const res = await updateSettings({
        timezone,
        workingHours: hours.filter((h) => h.on).map((h) => ({ day: h.day, start: clockToMinutes(h.start), end: clockToMinutes(h.end) })),
        minBlockMinutes: Number(minBlock),
        maxBlockMinutes: Number(maxBlock),
        bufferMinutes: Number(buffer),
        horizonDays: Number(horizon),
      });
      setError(res.ok ? null : res.error);
      setSaved(res.ok);
    });
  }

  return (
    <form onSubmit={save} className="space-y-6" onChange={() => setSaved(false)}>
      <Card title="Working hours" description="Tasks are only placed inside these hours.">
        <div className="space-y-2">
          {hours.map((h) => (
            <div key={h.day} className="flex flex-wrap items-center gap-3 text-sm">
              <label className="flex w-32 items-center gap-2">
                <input type="checkbox" checked={h.on} onChange={(e) => patch(h.day, { on: e.target.checked })} />
                {DAYS[h.day]}
              </label>
              {h.on ? (
                <>
                  <Input type="time" className="w-32" aria-label={`${DAYS[h.day]} start`} value={h.start} onChange={(e) => patch(h.day, { start: e.target.value })} />
                  <span className="text-muted">to</span>
                  <Input type="time" className="w-32" aria-label={`${DAYS[h.day]} end`} value={h.end} onChange={(e) => patch(h.day, { end: e.target.value })} />
                </>
              ) : (
                <span className="text-muted">Off</span>
              )}
            </div>
          ))}
        </div>
        <div className="mt-4 max-w-sm">
          <Field label="Timezone" hint={browserTz !== timezone ? `Your browser is set to ${browserTz}. The calendar grid uses the browser's timezone.` : undefined}>
            <Select value={timezone} onChange={(e) => setTimezone(e.target.value)}>
              {[...new Set([timezone, browserTz, ...timezones])].map((tz) => (
                <option key={tz} value={tz}>{tz}</option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>

      <Card title="Planning" description="How work is broken up and how far ahead to plan.">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Shortest block (min)">
            <Input type="number" min={15} max={240} step={15} value={minBlock} onChange={(e) => setMinBlock(e.target.value)} />
          </Field>
          <Field label="Longest block (min)">
            <Input type="number" min={15} max={600} step={15} value={maxBlock} onChange={(e) => setMaxBlock(e.target.value)} />
          </Field>
          <Field label="Break between blocks (min)">
            <Input type="number" min={0} max={120} step={5} value={buffer} onChange={(e) => setBuffer(e.target.value)} />
          </Field>
          <Field label="Plan ahead (days)">
            <Input type="number" min={1} max={60} value={horizon} onChange={(e) => setHorizon(e.target.value)} />
          </Field>
        </div>
      </Card>

      <ErrorNote message={error} />
      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Saving…" : "Save and re-plan"}
        </Button>
        {saved && <span className="text-sm text-ok" role="status">Saved</span>}
      </div>
    </form>
  );
}

export function CalendarList({ calendars }: { calendars: CalendarRow[] }) {
  const [pending, start] = useTransition();
  return (
    <ul className="space-y-2 text-sm">
      {calendars.map((c) => (
        <li key={c.id} className="flex items-center gap-3">
          <span className="size-2.5 rounded-full" style={{ background: c.color ?? "var(--muted)" }} />
          <span className="min-w-0 flex-1 truncate">{c.name}</span>
          {c.isAscension ? (
            <span className="text-xs text-muted">Task blocks are written here</span>
          ) : (
            <label className="flex items-center gap-2 text-xs text-muted">
              <input
                type="checkbox"
                checked={c.countsAsBusy}
                disabled={pending}
                onChange={(e) => start(async () => void (await setCalendarBusy(c.id, e.target.checked)))}
              />
              Events block my time
            </label>
          )}
        </li>
      ))}
    </ul>
  );
}
