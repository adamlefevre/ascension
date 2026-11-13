import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import type { BookingLink } from "@/db/schema";
import { calendarIds, getProvider } from "../calendar";
import { reschedule } from "../reschedule";
import { createBooking } from "./availability";

/** Record the booking, put it on the owner's calendar with the guest invited, and re-plan tasks around it. */
export async function book(link: BookingLink, start: number, guest: { name: string; email: string; note?: string | null }) {
  const booking = await createBooking(link, start, guest);
  try {
    const provider = await getProvider();
    const { primaryId } = await calendarIds(provider);
    const { id, meetLink } = await provider.createEvent(primaryId, {
      title: `${link.title} with ${guest.name}`,
      description: [guest.note, `Booked through Ascension by ${guest.name} <${guest.email}>.`].filter(Boolean).join("\n\n"),
      start: booking.start,
      end: booking.end,
      attendees: [{ email: guest.email, name: guest.name }],
      withMeetLink: provider.kind === "google",
    });
    const db = await getDb();
    await db.update(schema.bookings).set({ externalEventId: id }).where(eq(schema.bookings.id, booking.id));
    // The event itself is mirrored on the next sync; the booking row already blocks the time.
    await reschedule();
    return { ...booking, meetLink };
  } catch (e) {
    console.error("booking calendar write failed", e);
    await reschedule();
    return { ...booking, meetLink: undefined };
  }
}
