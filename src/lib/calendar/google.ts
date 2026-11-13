import type { CalendarProvider } from "./provider";

// Replaced with the real implementation in the Google sync milestone.
export class GoogleProvider implements CalendarProvider {
  readonly kind = "google" as const;
  listCalendars(): never { throw new Error("not implemented"); }
  ensureAscensionCalendar(): never { throw new Error("not implemented"); }
  listEvents(): never { throw new Error("not implemented"); }
  createEvent(): never { throw new Error("not implemented"); }
  updateEvent(): never { throw new Error("not implemented"); }
  deleteEvent(): never { throw new Error("not implemented"); }
}
