import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import type { CalendarProvider, EventInput, ProviderCalendar, ProviderEvent } from "./provider";

const API = "https://www.googleapis.com/calendar/v3";
const ASCENSION_NAME = "Ascension";

type GEventTime = { dateTime?: string; date?: string };
type GEvent = {
  id: string;
  status?: string;
  summary?: string;
  start?: GEventTime;
  end?: GEventTime;
  transparency?: string;
  hangoutLink?: string;
  attendees?: { self?: boolean; responseStatus?: string }[];
  extendedProperties?: { private?: Record<string, string> };
};

export class GoogleApiError extends Error {
  constructor(
    public status: number,
    body: string,
  ) {
    super(`Google Calendar API ${status}: ${body.slice(0, 300)}`);
  }
}

/** A valid access token for the owner, refreshed when it is about to expire. */
async function accessToken(): Promise<string> {
  const db = await getDb();
  const [acct] = await db.select().from(schema.googleAccount).where(eq(schema.googleAccount.id, 1));
  if (!acct?.refreshToken) throw new Error("Google account is not connected");
  if (acct.accessToken && acct.expiresAt && acct.expiresAt.getTime() > Date.now() + 60_000) return acct.accessToken;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.AUTH_GOOGLE_ID ?? "",
      client_secret: process.env.AUTH_GOOGLE_SECRET ?? "",
      grant_type: "refresh_token",
      refresh_token: acct.refreshToken,
    }),
  });
  if (!res.ok) throw new GoogleApiError(res.status, await res.text());
  const json = (await res.json()) as { access_token: string; expires_in: number };
  await db
    .update(schema.googleAccount)
    .set({ accessToken: json.access_token, expiresAt: new Date(Date.now() + json.expires_in * 1000) })
    .where(eq(schema.googleAccount.id, 1));
  return json.access_token;
}

async function api<T>(path: string, init: { method?: string; query?: Record<string, string>; body?: unknown } = {}): Promise<T> {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method: init.method ?? "GET",
    headers: { authorization: `Bearer ${await accessToken()}`, "content-type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (!res.ok) throw new GoogleApiError(res.status, await res.text());
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

const cal = (id: string) => `/calendars/${encodeURIComponent(id)}`;

export function toProviderEvent(e: GEvent): ProviderEvent | null {
  if (e.status === "cancelled" || !e.start || !e.end) return null;
  const allDay = !e.start.dateTime;
  const start = new Date(e.start.dateTime ?? `${e.start.date}T00:00:00Z`);
  const end = new Date(e.end.dateTime ?? `${e.end.date}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  const declined = e.attendees?.some((a) => a.self && a.responseStatus === "declined") ?? false;
  return {
    id: e.id,
    title: e.summary?.trim() || "(no title)",
    start,
    end,
    allDay,
    transparent: e.transparency === "transparent" || declined,
    blockId: e.extendedProperties?.private?.ascensionBlockId,
  };
}

function toBody(input: EventInput) {
  return {
    summary: input.title,
    description: input.description,
    start: { dateTime: input.start.toISOString() },
    end: { dateTime: input.end.toISOString() },
    ...(input.blockId ? { extendedProperties: { private: { ascensionBlockId: input.blockId } } } : {}),
    ...(input.attendees ? { attendees: input.attendees.map((a) => ({ email: a.email, displayName: a.name })) } : {}),
    ...(input.withMeetLink
      ? { conferenceData: { createRequest: { requestId: randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } } } }
      : {}),
  };
}

export class GoogleProvider implements CalendarProvider {
  readonly kind = "google" as const;

  private async calendarList() {
    type Item = { id: string; summary: string; backgroundColor?: string; primary?: boolean; accessRole: string; selected?: boolean; deleted?: boolean };
    const items: Item[] = [];
    let pageToken: string | undefined;
    do {
      const page = await api<{ items?: Item[]; nextPageToken?: string }>("/users/me/calendarList", {
        query: { maxResults: "250", ...(pageToken ? { pageToken } : {}) },
      });
      items.push(...(page.items ?? []));
      pageToken = page.nextPageToken;
    } while (pageToken);
    return items.filter((i) => !i.deleted);
  }

  async listCalendars(): Promise<ProviderCalendar[]> {
    const items = await this.calendarList();
    // Calendars the owner has switched on in Google Calendar, plus the primary one.
    return items
      .filter((i) => i.primary || i.selected)
      .map((i) => ({ id: i.id, name: i.summary, color: i.backgroundColor, isPrimary: !!i.primary }));
  }

  async ensureAscensionCalendar(): Promise<ProviderCalendar> {
    const existing = (await this.calendarList()).find((i) => i.summary === ASCENSION_NAME && i.accessRole === "owner");
    if (existing) return { id: existing.id, name: existing.summary, color: existing.backgroundColor, isPrimary: false };
    const created = await api<{ id: string }>("/calendars", {
      method: "POST",
      body: { summary: ASCENSION_NAME, description: "Task blocks scheduled by Ascension. Managed automatically." },
    });
    return { id: created.id, name: ASCENSION_NAME, color: "#6366f1", isPrimary: false };
  }

  async listEvents(calendarId: string, from: Date, to: Date): Promise<ProviderEvent[]> {
    const out: ProviderEvent[] = [];
    let pageToken: string | undefined;
    do {
      const page = await api<{ items?: GEvent[]; nextPageToken?: string }>(`${cal(calendarId)}/events`, {
        query: {
          singleEvents: "true",
          showDeleted: "false",
          maxResults: "2500",
          timeMin: from.toISOString(),
          timeMax: to.toISOString(),
          ...(pageToken ? { pageToken } : {}),
        },
      });
      for (const e of page.items ?? []) {
        const ev = toProviderEvent(e);
        if (ev) out.push(ev);
      }
      pageToken = page.nextPageToken;
    } while (pageToken);
    return out;
  }

  async createEvent(calendarId: string, input: EventInput) {
    const e = await api<GEvent>(`${cal(calendarId)}/events`, {
      method: "POST",
      query: {
        ...(input.withMeetLink ? { conferenceDataVersion: "1" } : {}),
        sendUpdates: input.attendees?.length ? "all" : "none",
      },
      body: toBody(input),
    });
    return { id: e.id, meetLink: e.hangoutLink };
  }

  async updateEvent(calendarId: string, eventId: string, input: EventInput) {
    await api(`${cal(calendarId)}/events/${encodeURIComponent(eventId)}`, { method: "PATCH", body: toBody(input) });
  }

  async deleteEvent(calendarId: string, eventId: string) {
    try {
      await api(`${cal(calendarId)}/events/${encodeURIComponent(eventId)}`, { method: "DELETE", query: { sendUpdates: "all" } });
    } catch (e) {
      if (e instanceof GoogleApiError && (e.status === 404 || e.status === 410)) return;
      throw e;
    }
  }

  async watch(calendarId: string, webhookUrl: string, token: string) {
    const channelId = randomUUID();
    const res = await api<{ resourceId: string; expiration?: string }>(`${cal(calendarId)}/events/watch`, {
      method: "POST",
      body: { id: channelId, type: "web_hook", address: webhookUrl, token },
    });
    const expiry = res.expiration ? new Date(Number(res.expiration)) : new Date(Date.now() + 6 * 24 * 3600 * 1000);
    return { channelId, resourceId: res.resourceId, expiry };
  }

  async stopWatch(channelId: string, resourceId: string) {
    try {
      await api("/channels/stop", { method: "POST", body: { id: channelId, resourceId } });
    } catch (e) {
      if (e instanceof GoogleApiError && e.status === 404) return;
      throw e;
    }
  }
}
