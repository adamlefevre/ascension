import { z } from "zod";
import { assistantConfigured, runChat, type ChatEvent } from "@/lib/ai/chat";
import { isOwner } from "@/lib/auth-guard";

export const maxDuration = 300;

const body = z.object({ message: z.string().trim().min(1).max(4000) });

/** Streams the assistant's reply as newline-delimited JSON events. */
export async function POST(req: Request) {
  if (!(await isOwner())) return new Response("Unauthorized", { status: 401 });
  if (!assistantConfigured()) return new Response("Assistant is not configured", { status: 503 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return new Response("Bad request", { status: 400 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (e: ChatEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));
      await runChat(parsed.data.message, emit);
      controller.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}
