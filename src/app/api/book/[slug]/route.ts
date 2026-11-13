import { z } from "zod";
import { getActiveLink, SlotTaken, slotsForLink } from "@/lib/booking/availability";
import { book } from "@/lib/booking/book";
import { clientIp, rateLimited } from "@/lib/booking/rate-limit";

/** Public: free slots only. Never returns anything about the owner's events. */
export async function GET(req: Request, ctx: RouteContext<"/api/book/[slug]">) {
  if (rateLimited(`slots:${clientIp(req)}`, 60, 60_000)) return new Response("Too many requests", { status: 429 });
  const link = await getActiveLink((await ctx.params).slug);
  if (!link) return new Response("Not found", { status: 404 });
  const { timezone, slots } = await slotsForLink(link);
  return Response.json(
    { title: link.title, durationMinutes: link.durationMinutes, timezone, slots: slots.map((s) => new Date(s).toISOString()) },
    { headers: { "cache-control": "no-store" } },
  );
}

const body = z.object({
  start: z.string().datetime(),
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(200),
  note: z.string().trim().max(1000).optional(),
  website: z.string().max(0).optional(), // honeypot: real people leave it empty
});

export async function POST(req: Request, ctx: RouteContext<"/api/book/[slug]">) {
  if (rateLimited(`book:${clientIp(req)}`, 5, 10 * 60_000)) return Response.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  const link = await getActiveLink((await ctx.params).slug);
  if (!link) return Response.json({ error: "This booking link is not available." }, { status: 404 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Please check your name, email and chosen time." }, { status: 400 });
  try {
    const b = await book(link, Date.parse(parsed.data.start), { name: parsed.data.name, email: parsed.data.email, note: parsed.data.note });
    return Response.json({ start: b.start.toISOString(), end: b.end.toISOString(), meetLink: b.meetLink ?? null });
  } catch (e) {
    if (e instanceof SlotTaken) return Response.json({ error: e.message }, { status: 409 });
    console.error("booking failed", e);
    return Response.json({ error: "Booking failed. Please try again." }, { status: 500 });
  }
}
