import type Anthropic from "@anthropic-ai/sdk";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb, resetDbForTests, schema } from "@/db/client";
import { setProviderForTests } from "../calendar";
import * as svc from "../services";
import { loadTranscript, runChat, type ChatClient, type ChatEvent } from "./chat";
import { executeTool, resolvePendingAction, toolDefinitions } from "./tools";

beforeEach(() => {
  resetDbForTests();
  setProviderForTests(null);
  process.env.DEFAULT_TIMEZONE = "America/New_York";
});

const run = async (name: string, input: unknown, ctx = {}) => {
  const out = await executeTool(name, input, ctx);
  return { ...out, data: out.isError ? null : JSON.parse(out.content) };
};

describe("assistant tools", () => {
  it("publishes a JSON schema for every tool", () => {
    expect(toolDefinitions.length).toBeGreaterThan(8);
    for (const t of toolDefinitions) {
      expect(t.input_schema.type).toBe("object");
      expect(t.description!.length).toBeGreaterThan(20);
    }
  });

  it("creates a task and reports where it was scheduled", async () => {
    const r = await run("create_task", { title: "Write report", durationMinutes: 60, priority: 1 });
    expect(r.isError).toBe(false);
    expect(r.data.scheduled).toHaveLength(1);
    const tasks = await svc.listTasks();
    expect(tasks.map((t) => t.title)).toEqual(["Write report"]);
  });

  it("resolves projects by name and explains unknown ones", async () => {
    await run("create_project", { name: "Launch" });
    const ok = await run("create_task", { title: "A", durationMinutes: 30, projectName: "launch" });
    expect(ok.isError).toBe(false);
    const bad = await run("create_task", { title: "B", durationMinutes: 30, projectName: "Nope" });
    expect(bad.isError).toBe(true);
    expect(bad.content).toContain("Launch");
  });

  it("rejects malformed input without running anything", async () => {
    const r = await run("create_task", { title: "No duration" });
    expect(r.isError).toBe(true);
    expect(r.content).toContain("durationMinutes");
    expect(await svc.listTasks()).toEqual([]);
    expect((await run("drop_database", {})).isError).toBe(true);
  });

  it("returns the merged schedule with problems called out", async () => {
    await svc.updateSettings({ horizonDays: 1 });
    await run("create_task", { title: "Huge", durationMinutes: 2400 });
    const r = await run("get_schedule", {});
    expect(r.data.unscheduled[0]).toMatchObject({ title: "Huge" });
  });

  it("never deletes without the owner's confirmation", async () => {
    const created = await run("create_task", { title: "Keep me", durationMinutes: 30 });
    const asked: { id: string; summary: string }[] = [];
    const r = await run("delete_task", { id: created.data.id }, { onConfirmNeeded: (a: { id: string; summary: string }) => asked.push(a) });
    expect(r.data.status).toBe("awaiting_confirmation");
    expect(asked[0].summary).toBe('Delete task "Keep me"');
    expect(await svc.listTasks()).toHaveLength(1);

    // Calling the tool again still does not delete.
    await run("delete_task", { id: created.data.id });
    expect(await svc.listTasks()).toHaveLength(1);

    expect(await resolvePendingAction(asked[0].id, true)).toContain("Done");
    expect(await svc.listTasks()).toHaveLength(0);
    await expect(resolvePendingAction(asked[0].id, true)).rejects.toThrow("already handled");
  });

  it("cancelling a pending delete leaves the item in place", async () => {
    const created = await run("create_task", { title: "Keep me", durationMinutes: 30 });
    const asked: { id: string }[] = [];
    await run("delete_task", { id: created.data.id }, { onConfirmNeeded: (a: { id: string }) => asked.push(a) });
    expect(await resolvePendingAction(asked[0].id, false)).toContain("Cancelled");
    expect(await svc.listTasks()).toHaveLength(1);
  });
});

/** A scripted stand-in for the Anthropic client: each call to stream() plays the next reply. */
function fakeClient(replies: { text?: string; tools?: { name: string; input: unknown }[]; stop?: string }[]) {
  const requests: Anthropic.Beta.MessageCreateParams[] = [];
  let n = 0;
  const client = {
    beta: {
      messages: {
        stream(params: Anthropic.Beta.MessageCreateParams) {
          requests.push(structuredClone(params));
          const reply = replies[n++];
          const content = [
            ...(reply.text ? [{ type: "text", text: reply.text }] : []),
            ...(reply.tools ?? []).map((t, i) => ({ type: "tool_use", id: `tu_${n}_${i}`, name: t.name, input: t.input })),
          ];
          return {
            async *[Symbol.asyncIterator]() {
              if (reply.text) yield { type: "content_block_delta", delta: { type: "text_delta", text: reply.text } };
            },
            finalMessage: async () => ({ content, stop_reason: reply.stop ?? (reply.tools ? "tool_use" : "end_turn") }),
          };
        },
      },
    },
  };
  return { client: client as unknown as ChatClient, requests };
}

describe("chat loop", () => {
  it("runs tools, feeds results back, and saves the exchange", async () => {
    const { client, requests } = fakeClient([
      { tools: [{ name: "create_task", input: { title: "Call the bank", durationMinutes: 15 } }] },
      { text: "Added. It is scheduled for tomorrow morning." },
    ]);
    const events: ChatEvent[] = [];
    await runChat("remind me to call the bank", (e) => events.push(e), client);

    expect(events.map((e) => e.type)).toEqual(["tool", "text", "text", "done"]);
    expect((await svc.listTasks()).map((t) => t.title)).toEqual(["Call the bank"]);

    // Second request carries the tool result for the first.
    const last = requests[1].messages[requests[1].messages.length - 1];
    expect(last.role).toBe("user");
    expect((last.content as { type: string; is_error: boolean }[])[0]).toMatchObject({ type: "tool_result", is_error: false });
    // The user's first turn starts with the context block.
    expect(JSON.stringify(requests[0].messages[0].content)).toContain("<context>");
    expect(requests[0].model).toBe("claude-opus-5-5");

    expect(await loadTranscript()).toEqual([
      { role: "user", text: "remind me to call the bank" },
      { role: "assistant", text: "Added. It is scheduled for tomorrow morning." },
    ]);
  });

  it("replays stored history on the next message", async () => {
    const first = fakeClient([{ text: "Hello." }]);
    await runChat("hi", () => {}, first.client);
    const second = fakeClient([{ text: "Still here." }]);
    await runChat("again", () => {}, second.client);
    expect(second.requests[0].messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
  });

  it("shows a confirm prompt when the model asks to delete", async () => {
    const task = await svc.createTask({ title: "Old", durationMinutes: 30 });
    const { client } = fakeClient([{ tools: [{ name: "delete_task", input: { id: task.id } }] }, { text: "There is a Confirm button for that." }]);
    const events: ChatEvent[] = [];
    await runChat("delete Old", (e) => events.push(e), client);
    expect(events.find((e) => e.type === "confirm")).toMatchObject({ summary: 'Delete task "Old"' });
    expect(await svc.listTasks()).toHaveLength(1);
  });

  it("saves nothing when the model call fails", async () => {
    const client = { beta: { messages: { stream: () => { throw new Error("boom"); } } } } as unknown as ChatClient;
    const events: ChatEvent[] = [];
    await runChat("hi", (e) => events.push(e), client);
    expect(events).toEqual([{ type: "error", message: "boom" }]);
    expect(await (await getDb()).select().from(schema.chatMessages)).toEqual([]);
  });

  it("handles a refusal without running tools", async () => {
    const { client } = fakeClient([{ stop: "refusal", tools: [{ name: "create_task", input: { title: "x", durationMinutes: 5 } }] }]);
    const events: ChatEvent[] = [];
    await runChat("...", (e) => events.push(e), client);
    expect(events.some((e) => e.type === "text" && e.text.includes("can't help"))).toBe(true);
    expect(await svc.listTasks()).toEqual([]);
  });
});
