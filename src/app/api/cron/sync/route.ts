import { syncAll } from "@/lib/calendar/sync";

export const maxDuration = 60;

/** Daily safety net (see vercel.json): full sync, re-plan, and renewal of notification channels. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const result = await syncAll();
  return Response.json(result);
}
