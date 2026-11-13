import { timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { syncAll } from "@/lib/calendar/sync";

export const maxDuration = 60;

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Google calls this when a watched calendar changes. The body is empty; headers say which channel. */
export async function POST(req: Request) {
  const channelId = req.headers.get("x-goog-channel-id");
  const token = req.headers.get("x-goog-channel-token");
  const state = req.headers.get("x-goog-resource-state");
  if (!channelId || !token) return new Response("Bad request", { status: 400 });

  const db = await getDb();
  const [cal] = await db.select().from(schema.calendars).where(eq(schema.calendars.channelId, channelId));
  // Unknown or stale channel: answer 200 so Google stops retrying, but do nothing.
  if (!cal?.channelToken || !same(cal.channelToken, token)) return new Response(null, { status: 200 });
  if (state === "sync") return new Response(null, { status: 200 }); // handshake sent when a channel is created

  try {
    await syncAll();
  } catch (e) {
    console.error("webhook sync failed", e);
    return new Response("Sync failed", { status: 500 });
  }
  return new Response(null, { status: 200 });
}
