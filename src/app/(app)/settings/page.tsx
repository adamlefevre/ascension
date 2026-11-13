import { connection } from "next/server";
import { Suspense } from "react";
import { Loading } from "@/components/loading";
import { CalendarList, Card, GoogleConnection, SchedulingSettings } from "@/components/settings-screen";
import { getDb, schema } from "@/db/client";
import { googleConfigured } from "@/auth";
import { requireOwner } from "@/lib/auth-guard";
import { webhookUrl } from "@/lib/calendar/sync";
import { getSettings } from "@/lib/settings";

export default function SettingsPage() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-6">
        <h1 className="text-xl font-semibold">Settings</h1>
        <Suspense fallback={<Loading />}>
          <SettingsBody />
        </Suspense>
      </div>
    </div>
  );
}

async function SettingsBody() {
  await connection();
  await requireOwner();
  const db = await getDb();
  const [settings, calendars, accounts] = await Promise.all([
    getSettings(),
    db.select().from(schema.calendars),
    db.select({ email: schema.googleAccount.email, refreshToken: schema.googleAccount.refreshToken }).from(schema.googleAccount),
  ]);
  const email = accounts[0]?.refreshToken ? accounts[0].email : null;
  const timezones = Intl.supportedValuesOf("timeZone");
  return (
    <>
      <SchedulingSettings settings={settings} timezones={timezones} />
      <Card title="Google Calendar" description="Your events are read as busy time; task blocks are written to a separate calendar named Ascension.">
        <GoogleConnection email={email} configured={googleConfigured()} pushEnabled={!!webhookUrl()} />
      </Card>
      <Card title="Calendars" description="Choose which calendars count as busy time.">
        <CalendarList calendars={calendars} />
      </Card>
    </>
  );
}
