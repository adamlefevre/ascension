"use client";

import { Copy, Pencil, Plus } from "lucide-react";
import { useState, useSyncExternalStore, useTransition } from "react";
import type { BookingLink } from "@/db/schema";
import { deleteBookingLink, saveBookingLink } from "@/lib/actions";
import { fmtDayTime, fmtDuration } from "@/lib/format";
import { Badge, Button, Dialog, ErrorNote, Field, Input } from "./ui";

const noSub = () => () => {};

export type UpcomingBooking = { id: string; guestName: string; guestEmail: string; start: Date; linkTitle: string };

export function BookingLinks({ links, upcoming, timezone }: { links: BookingLink[]; upcoming: UpcomingBooking[]; timezone: string }) {
  const origin = useSyncExternalStore(noSub, () => window.location.origin, () => "");
  const [editing, setEditing] = useState<BookingLink | "new" | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  return (
    <div className="space-y-4 text-sm">
      {links.length === 0 && <p className="text-muted">No booking links yet. Create one and share it so people can pick a time that is free on your calendar.</p>}
      <ul className="space-y-2">
        {links.map((l) => {
          const url = `${origin}/book/${l.slug}`;
          return (
            <li key={l.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {l.title} {!l.active && <Badge>Off</Badge>}
                </p>
                <p className="truncate text-xs text-muted">{fmtDuration(l.durationMinutes)} · /book/{l.slug}</p>
              </div>
              <Button size="sm" onClick={() => navigator.clipboard.writeText(url).then(() => setCopied(l.id))}>
                <Copy size={12} /> {copied === l.id ? "Copied" : "Copy link"}
              </Button>
              <Button size="sm" variant="ghost" aria-label={`Edit ${l.title}`} onClick={() => setEditing(l)}>
                <Pencil size={12} />
              </Button>
            </li>
          );
        })}
      </ul>
      <Button onClick={() => setEditing("new")}>
        <Plus size={14} /> New booking link
      </Button>

      {upcoming.length > 0 && (
        <div>
          <h3 className="mb-1 text-xs font-medium text-muted">Upcoming bookings</h3>
          <ul className="space-y-1">
            {upcoming.map((b) => (
              <li key={b.id}>
                {fmtDayTime(b.start, timezone)} · {b.guestName} <span className="text-muted">({b.linkTitle})</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Dialog open={!!editing} onClose={() => setEditing(null)} title={editing === "new" ? "New booking link" : "Edit booking link"}>
        {editing && <LinkForm key={editing === "new" ? "new" : editing.id} link={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      </Dialog>
    </div>
  );
}

function LinkForm({ link, onClose }: { link: BookingLink | null; onClose: () => void }) {
  const [title, setTitle] = useState(link?.title ?? "Intro call");
  const [slug, setSlug] = useState(link?.slug ?? "intro");
  const [duration, setDuration] = useState(String(link?.durationMinutes ?? 30));
  const [buffer, setBuffer] = useState(String(link?.bufferMinutes ?? 10));
  const [days, setDays] = useState(String(link?.daysAhead ?? 14));
  const [notice, setNotice] = useState(String(link?.minNoticeHours ?? 4));
  const [limit, setLimit] = useState(link?.dailyLimit ? String(link.dailyLimit) : "");
  const [active, setActive] = useState(link?.active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const finish = (r: { ok: boolean; error?: string }) => (r.ok ? onClose() : setError(r.error ?? "Failed"));

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () =>
          finish(
            await saveBookingLink(link?.id ?? null, {
              title, slug, active,
              durationMinutes: Number(duration), bufferMinutes: Number(buffer), daysAhead: Number(days),
              minNoticeHours: Number(notice), dailyLimit: limit ? Number(limit) : null,
            }),
          ),
        );
      }}
    >
      <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} required /></Field>
      <Field label="Link address" hint="Lowercase letters, digits and dashes."><Input value={slug} onChange={(e) => setSlug(e.target.value)} required /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Length (min)"><Input type="number" min={10} max={480} step={5} value={duration} onChange={(e) => setDuration(e.target.value)} /></Field>
        <Field label="Gap around meetings (min)"><Input type="number" min={0} max={120} step={5} value={buffer} onChange={(e) => setBuffer(e.target.value)} /></Field>
        <Field label="Bookable days ahead"><Input type="number" min={1} max={60} value={days} onChange={(e) => setDays(e.target.value)} /></Field>
        <Field label="Minimum notice (hours)"><Input type="number" min={0} max={336} value={notice} onChange={(e) => setNotice(e.target.value)} /></Field>
        <Field label="Max per day"><Input type="number" min={1} max={20} placeholder="No limit" value={limit} onChange={(e) => setLimit(e.target.value)} /></Field>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Accepting bookings
      </label>
      <ErrorNote message={error} />
      <div className="flex items-center justify-between">
        {link ? <Button variant="danger" disabled={pending} onClick={() => start(async () => finish(await deleteBookingLink(link.id)))}>Delete</Button> : <span />}
        <div className="flex gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={pending}>Save</Button>
        </div>
      </div>
      <p className="text-xs text-muted">Guests see only free times inside your working hours. Task blocks move out of the way when someone books.</p>
    </form>
  );
}
