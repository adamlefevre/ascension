/** What the app needs from a calendar backend. Google implements it for real; "local" keeps everything in our own DB. */

export type ProviderCalendar = { id: string; name: string; color?: string; isPrimary: boolean };

export type ProviderEvent = {
  id: string;
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  /** Marked "free" in the calendar, or declined by the owner: does not block time. */
  transparent: boolean;
  /** Set when this event is one of our own task blocks. */
  blockId?: string;
};

export type EventInput = {
  title: string;
  description?: string;
  start: Date;
  end: Date;
  blockId?: string;
  attendees?: { email: string; name?: string }[];
  withMeetLink?: boolean;
};

export interface CalendarProvider {
  readonly kind: "google" | "local";
  listCalendars(): Promise<ProviderCalendar[]>;
  /** The dedicated calendar that holds task blocks, created if needed. */
  ensureAscensionCalendar(): Promise<ProviderCalendar>;
  /** Every event overlapping [from, to), with recurring events expanded. */
  listEvents(calendarId: string, from: Date, to: Date): Promise<ProviderEvent[]>;
  createEvent(calendarId: string, input: EventInput): Promise<{ id: string; meetLink?: string }>;
  updateEvent(calendarId: string, eventId: string, input: EventInput): Promise<void>;
  /** Must succeed when the event is already gone. */
  deleteEvent(calendarId: string, eventId: string): Promise<void>;
  /** Ask to be notified at webhookUrl when the calendar changes. */
  watch?(calendarId: string, webhookUrl: string, token: string): Promise<{ channelId: string; resourceId: string; expiry: Date }>;
  stopWatch?(channelId: string, resourceId: string): Promise<void>;
}
