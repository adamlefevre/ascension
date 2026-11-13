import { getDb, schema } from "../src/db/client";
import { ensureCalendars, getProvider } from "../src/lib/calendar";
import { reschedule } from "../src/lib/reschedule";
import { getSettings } from "../src/lib/settings";
import { addDays, localDay, localToInstant } from "../src/lib/time";

/** Fill an empty database with a believable week so the app has something to show. */
export async function seed() {
  const db = await getDb();
  const settings = await getSettings();
  const { primaryId } = await ensureCalendars(await getProvider());
  const tz = settings.timezone;
  const today = localDay(Date.now(), tz);
  // Day offsets are counted from the Monday of the current week.
  const monday = addDays(today, -((today.weekday + 6) % 7));
  const at = (dayOffset: number, h: number, m = 0) => new Date(localToInstant(addDays(monday, dayOffset), h * 60 + m, tz));

  const meetings: [string, number, number, number, number][] = [
    ["Team standup", 0, 9.5, 10, 0], ["Team standup", 1, 9.5, 10, 0], ["Team standup", 2, 9.5, 10, 0],
    ["Team standup", 3, 9.5, 10, 0], ["Team standup", 4, 9.5, 10, 0],
    ["Client review", 1, 13, 14, 0], ["1:1 with Sam", 2, 15, 15.5, 0], ["Product planning", 3, 11, 12.5, 0],
    ["Dentist", 4, 14, 15, 0], ["Team standup", 7, 9.5, 10, 0], ["Quarterly review", 8, 10, 12, 0],
  ];
  await db.insert(schema.events).values(
    meetings.map(([title, day, s, e], i) => ({
      calendarId: primaryId,
      externalId: `seed-${i}`,
      title,
      start: at(day, Math.floor(s), (s % 1) * 60),
      end: at(day, Math.floor(e), (e % 1) * 60),
    })),
  ).onConflictDoNothing();

  const [launch, ops] = await db
    .insert(schema.projects)
    .values([
      { name: "Website launch", color: "#6366f1", deadline: at(11, 17) },
      { name: "Operations", color: "#f59e0b" },
    ])
    .returning();

  const [copy] = await db
    .insert(schema.tasks)
    .values({ title: "Write landing page copy", durationMinutes: 180, priority: 2, projectId: launch.id, deadline: at(3, 17), deadlineHard: true })
    .returning();
  await db.insert(schema.tasks).values([
    { title: "Design review of landing page", durationMinutes: 60, priority: 2, projectId: launch.id, blockedByTaskId: copy.id },
    { title: "Set up analytics", durationMinutes: 90, priority: 3, projectId: launch.id },
    { title: "Reply to investor email", durationMinutes: 30, priority: 1 },
    { title: "Prepare quarterly numbers", durationMinutes: 240, priority: 2, projectId: ops.id, deadline: at(8, 10), deadlineHard: true },
    { title: "Renew software licences", durationMinutes: 30, priority: 4, projectId: ops.id },
    { title: "Read competitor teardown", durationMinutes: 45, priority: 4, splittable: false },
    { title: "Inbox zero", durationMinutes: 30, priority: 3, isTemplate: true, recurrenceRule: "FREQ=WEEKLY;BYDAY=MO,WE,FR" },
  ]);

  await db.insert(schema.bookingLinks).values({ slug: "intro", title: "Intro call", durationMinutes: 30 }).onConflictDoNothing();
  await reschedule();
}

if (process.argv[1]?.endsWith("seed.ts")) {
  seed().then(() => {
    console.log("Seeded.");
    process.exit(0);
  });
}
