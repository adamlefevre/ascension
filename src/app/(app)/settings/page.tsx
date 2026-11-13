import { connection } from "next/server";
import { Suspense } from "react";
import { Loading } from "@/components/loading";
import { CalendarList, Card, SchedulingSettings } from "@/components/settings-screen";
import { getDb, schema } from "@/db/client";
import { requireOwner } from "@/lib/auth-guard";
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
  const [settings, calendars] = await Promise.all([getSettings(), db.select().from(schema.calendars)]);
  const timezones = Intl.supportedValuesOf("timeZone");
  return (
    <>
      <SchedulingSettings settings={settings} timezones={timezones} />
      <Card title="Calendars" description="Choose which calendars count as busy time.">
        <CalendarList calendars={calendars} />
      </Card>
    </>
  );
}
