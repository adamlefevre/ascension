"use server";

import { refresh } from "next/cache";
import { signOut as authSignOut } from "@/auth";
import { requireOwner } from "./auth-guard";
import { syncAll } from "./calendar/sync";
import { reschedule } from "./reschedule";
import * as svc from "./services";

export type ActionResult<T = unknown> = { ok: true; data: T } | { ok: false; error: string };

/** Auth check, run, refresh the page data, and turn thrown errors into a message the UI can show. */
async function act<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  await requireOwner();
  try {
    const data = await fn();
    refresh();
    return { ok: true, data };
  } catch (e) {
    const issues = (e as { issues?: { message: string; path: (string | number)[] }[] }).issues;
    if (issues?.length) return { ok: false, error: issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
    console.error(e);
    return { ok: false, error: e instanceof Error ? e.message : "Something went wrong" };
  }
}

export const createTask = async (input: svc.TaskInput) => act(() => svc.createTask(input));
export const updateTask = async (id: string, input: Partial<svc.TaskInput>) => act(() => svc.updateTask(id, input));
export const setTaskDone = async (id: string, done: boolean) => act(() => svc.setTaskDone(id, done));
export const deleteTask = async (id: string) => act(() => svc.deleteTask(id));
export const createProject = async (input: svc.ProjectInput) => act(() => svc.createProject(input));
export const updateProject = async (id: string, input: Partial<svc.ProjectInput>) => act(() => svc.updateProject(id, input));
export const deleteProject = async (id: string) => act(() => svc.deleteProject(id));
export const moveBlock = async (id: string, start: string, end: string) =>
  act(() => svc.moveBlock(id, new Date(start), new Date(end)));
export const unpinBlock = async (id: string) => act(() => svc.unpinBlock(id));
export const updateSettings = async (input: Parameters<typeof svc.updateSettings>[0]) => act(() => svc.updateSettings(input));
export const setCalendarBusy = async (id: string, busy: boolean) => act(() => svc.setCalendarBusy(id, busy));
export const createEvent = async (input: { title: string; start: string; end: string }) => act(() => svc.createEvent(input));
export const deleteEvent = async (id: string) => act(() => svc.deleteEvent(id));
export const replan = async () => act(async () => void (await reschedule()));
export const syncNow = async () => act(() => syncAll());

export async function signOut() {
  await authSignOut({ redirectTo: "/signin" });
}
