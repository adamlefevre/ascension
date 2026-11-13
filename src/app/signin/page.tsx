import { redirect } from "next/navigation";
import { Suspense } from "react";
import { auth, googleConfigured, signIn } from "@/auth";
import { authDisabled } from "@/lib/auth-guard";

export default function SignInPage({ searchParams }: PageProps<"/signin">) {
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-8 text-center">
        <div className="mx-auto mb-4 flex size-11 items-center justify-center rounded-xl bg-accent text-lg font-bold text-accent-text">A</div>
        <h1 className="text-xl font-semibold">Ascension</h1>
        <p className="mt-1 text-sm text-muted">Tasks that schedule themselves around your calendar.</p>
        <Suspense>
          <SignInBody searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}

async function SignInBody({ searchParams }: { searchParams: PageProps<"/signin">["searchParams"] }) {
  const { error } = await searchParams;
  if (authDisabled() || (await auth())?.user) redirect("/");
  if (!googleConfigured()) {
    return (
      <p className="mt-6 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
        Sign-in is not configured. Set AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET, AUTH_SECRET and ALLOWED_EMAIL.
      </p>
    );
  }
  return (
    <>
      {error && (
        <p role="alert" className="mt-6 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
          {error === "AccessDenied" ? "That Google account is not allowed to use this app." : "Sign-in failed. Please try again."}
        </p>
      )}
      <form
        className="mt-6"
        action={async () => {
          "use server";
          await signIn("google", { redirectTo: "/" });
        }}
      >
        <button type="submit" className="h-10 w-full rounded-md bg-accent text-sm font-medium text-accent-text hover:opacity-90">
          Continue with Google
        </button>
      </form>
      <p className="mt-4 text-xs text-muted">You will be asked for access to your Google Calendar so tasks can be scheduled around your events.</p>
    </>
  );
}
