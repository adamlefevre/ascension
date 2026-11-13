import { redirect } from "next/navigation";
import { auth, googleConfigured } from "@/auth";

/**
 * Sign-in is skipped only when explicitly disabled, or in local development
 * before Google has been configured. A production deployment is never open.
 */
export function authDisabled() {
  if (process.env.AUTH_DISABLED === "true") return true;
  return process.env.NODE_ENV !== "production" && !googleConfigured();
}

/** Call at the top of every page loader and server action. Sends visitors to the sign-in page. */
export async function requireOwner(): Promise<void> {
  if (authDisabled()) return;
  const session = await auth();
  if (!session?.user) redirect("/signin");
}

/** For route handlers: true when the caller is the signed-in owner. */
export async function isOwner(): Promise<boolean> {
  if (authDisabled()) return true;
  return !!(await auth())?.user;
}
