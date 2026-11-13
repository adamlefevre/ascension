import type { CalendarProvider, EventInput, ProviderCalendar, ProviderEvent } from "./provider";

/** In-memory stand-in for Google Calendar, used by tests. Behaves like a remote provider (kind "google"). */
export class FakeGoogle implements CalendarProvider {
  readonly kind = "google" as const;
  calendars: ProviderCalendar[] = [{ id: "primary@example.com", name: "Me", isPrimary: true }];
  events = new Map<string, Map<string, ProviderEvent>>();
  calls = { create: 0, update: 0, delete: 0 };
  private seq = 0;

  private bucket(calendarId: string) {
    let b = this.events.get(calendarId);
    if (!b) this.events.set(calendarId, (b = new Map()));
    return b;
  }

  /** Simulate something appearing in Google outside the app. */
  put(calendarId: string, e: Partial<ProviderEvent> & { start: Date; end: Date }) {
    const id = e.id ?? `g${++this.seq}`;
    this.bucket(calendarId).set(id, { title: "Meeting", allDay: false, transparent: false, ...e, id });
    return id;
  }

  async listCalendars() {
    return this.calendars.filter((c) => c.id !== "ascension@example.com");
  }

  async ensureAscensionCalendar() {
    let c = this.calendars.find((x) => x.id === "ascension@example.com");
    if (!c) this.calendars.push((c = { id: "ascension@example.com", name: "Ascension", isPrimary: false }));
    return c;
  }

  async listEvents(calendarId: string, from: Date, to: Date) {
    return [...this.bucket(calendarId).values()].filter((e) => e.start < to && e.end > from).map((e) => ({ ...e }));
  }

  async createEvent(calendarId: string, input: EventInput) {
    this.calls.create++;
    const id = this.put(calendarId, { title: input.title, start: input.start, end: input.end, blockId: input.blockId });
    return { id, meetLink: input.withMeetLink ? `https://meet.example.com/${id}` : undefined };
  }

  async updateEvent(calendarId: string, eventId: string, input: EventInput) {
    this.calls.update++;
    const e = this.bucket(calendarId).get(eventId);
    if (e) Object.assign(e, { title: input.title, start: input.start, end: input.end });
  }

  async deleteEvent(calendarId: string, eventId: string) {
    this.calls.delete++;
    this.bucket(calendarId).delete(eventId);
  }
}
