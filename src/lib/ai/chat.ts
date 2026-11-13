import Anthropic from "@anthropic-ai/sdk";
import { asc } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { getSettings } from "../settings";
import { contextBlock, SYSTEM_PROMPT } from "./prompt";
import { executeTool, toolDefinitions } from "./tools";

/** One stored turn. Content is kept exactly as sent or received, so thinking and tool blocks replay unchanged. */
type Msg = { role: "user" | "assistant"; content: Anthropic.Beta.BetaMessageContentParam };

export type ChatEvent =
  | { type: "text"; text: string }
  | { type: "tool"; name: string }
  | { type: "confirm"; id: string; summary: string }
  | { type: "error"; message: string }
  | { type: "done" };

/** The slice of the SDK the loop needs; tests pass a fake. */
export type ChatClient = { beta: { messages: Pick<Anthropic["beta"]["messages"], "stream"> } };

export const assistantConfigured = () => !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
export const assistantModel = () => process.env.ANTHROPIC_MODEL || "claude-opus-5-5";

const MAX_TURNS = 12;

async function loadHistory(): Promise<Msg[]> {
  const db = await getDb();
  const rows = await db.select().from(schema.chatMessages).orderBy(asc(schema.chatMessages.createdAt), asc(schema.chatMessages.seq));
  return rows.map((r) => ({ role: r.role, content: r.content as Msg["content"] }));
}

/**
 * Run one exchange: send the owner's message, let the model call tools until
 * it has an answer, and stream progress through `emit`. The conversation is
 * saved only when the exchange finishes cleanly, so a failure half-way never
 * leaves a broken history behind.
 */
export async function runChat(userText: string, emit: (e: ChatEvent) => void, client: ChatClient = new Anthropic()): Promise<void> {
  const settings = await getSettings();
  const history = await loadHistory();
  const fresh: Msg[] = [
    { role: "user", content: [{ type: "text", text: contextBlock(settings, new Date()) }, { type: "text", text: userText }] },
  ];

  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const stream = client.beta.messages.stream({
        model: assistantModel(),
        max_tokens: 16000,
        system: SYSTEM_PROMPT,
        tools: toolDefinitions,
        messages: [...history, ...fresh] as Anthropic.Beta.BetaMessageParam[],
        cache_control: { type: "ephemeral" },
        output_config: { effort: "medium" },
        // If a safety classifier declines a request, the API retries it on a fallback model.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });

      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") emit({ type: "text", text: event.delta.text });
      }
      const message = await stream.finalMessage();
      fresh.push({ role: "assistant", content: message.content as Msg["content"] });

      if (message.stop_reason === "refusal") {
        emit({ type: "text", text: "I can't help with that request." });
        break;
      }
      const calls = message.content.filter((b) => b.type === "tool_use");
      if (message.stop_reason === "max_tokens" && calls.length) throw new Error("The reply was cut off before it finished. Please try again.");
      if (message.stop_reason !== "tool_use" || !calls.length) break;

      // Tools change shared state and re-plan, so run them one after another, then answer all in one message.
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const call of calls) {
        emit({ type: "tool", name: call.name });
        const out = await executeTool(call.name, call.input, { onConfirmNeeded: (a) => emit({ type: "confirm", ...a }) });
        results.push({ type: "tool_result", tool_use_id: call.id, content: out.content, is_error: out.isError });
      }
      fresh.push({ role: "user", content: results });
      emit({ type: "text", text: "\n" });
      if (turn === MAX_TURNS - 1) throw new Error("That took too many steps. Try asking for a smaller change.");
    }

    // A history must not end on tool results the model never answered.
    while (fresh.length && fresh[fresh.length - 1].role === "user") fresh.pop();
    if (fresh.length > 1) {
      const db = await getDb();
      const base = new Date();
      await db.insert(schema.chatMessages).values(fresh.map((m, i) => ({ role: m.role, content: m.content, createdAt: base, seq: i })));
    }
    emit({ type: "done" });
  } catch (e) {
    console.error("chat failed", e);
    emit({ type: "error", message: describeError(e) });
  }
}

function describeError(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return "The Anthropic API key was rejected. Check ANTHROPIC_API_KEY.";
  if (e instanceof Anthropic.RateLimitError) return "The assistant is rate limited right now. Try again in a moment.";
  if (e instanceof Anthropic.APIConnectionError) return "Could not reach the assistant. Check the connection and try again.";
  if (e instanceof Anthropic.APIError) return `The assistant returned an error (${e.status ?? "unknown"}). Try again.`;
  return e instanceof Error ? e.message : "Something went wrong.";
}

export type TranscriptItem = { role: "user" | "assistant"; text: string };

/** Stored messages reduced to what the panel shows: the words, without tool plumbing or context blocks. */
export async function loadTranscript(): Promise<TranscriptItem[]> {
  const out: TranscriptItem[] = [];
  for (const m of await loadHistory()) {
    const blocks = typeof m.content === "string" ? [{ type: "text" as const, text: m.content }] : m.content;
    const texts = blocks.flatMap((b) => (b.type === "text" && !b.text.startsWith("<context>") ? [b.text] : []));
    const text = texts.join("").trim();
    if (!text) continue;
    const last = out[out.length - 1];
    if (last && last.role === m.role && m.role === "assistant") last.text += `\n${text}`;
    else out.push({ role: m.role, text });
  }
  return out;
}

/** Record something the owner did outside the model's view (a Confirm click) so the model knows about it. */
export async function noteForAssistant(text: string) {
  const db = await getDb();
  await db.insert(schema.chatMessages).values({ role: "user", content: [{ type: "text", text: `[${text}]` }] });
}
