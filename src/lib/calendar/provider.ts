/** What the app needs from a calendar backend. Google implements it for real; "local" keeps everything in our own DB. */

export type ProviderCalendar = { id: string; name: string; color?: string; isPrimary: boolean };

export type ProviderEvent = {
  id: string;
  cancelled: boolean;
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
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

export class SyncTokenExpired extends Error {}

export interface CalendarProvider {
  readonly kind: "google" | "local";
  listCalendars(): Promise<ProviderCalendar[]>;
  /** Returns the id of the dedicated calendar that holds task blocks, creating it if needed. */
  ensureAscensionCalendar(): Promise<ProviderCalendar>;
  /** Incremental when syncToken is given. Throws SyncTokenExpired when a full resync is needed. */
  listEvents(calendarId: string, syncToken: string | null): Promise<{ events: ProviderEvent[]; nextSyncToken: string | null }>;
  createEvent(calendarId: string, input: EventInput): Promise<{ id: string }>;
  updateEvent(calendarId: string, eventId: string, input: EventInput): Promise<void>;
  deleteEvent(calendarId: string, eventId: string): Promise<void>;
  watch?(calendarId: string, webhookUrl: string, token: string): Promise<{ channelId: string; resourceId: string; expiry: Date }>;
  stopWatch?(channelId: string, resourceId: string): Promise<void>;
}
