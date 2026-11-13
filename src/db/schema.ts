import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export type WorkingHours = { day: number; start: number; end: number }[]; // day 0=Sun, minutes from midnight

export type ScheduleReport = {
  ranAt: string;
  unscheduled: { taskId: string; reason: string }[];
  atRisk: { taskId: string; finishesAt: string; deadline: string }[];
};

/** Single-row table (id = 1): the owner's scheduling preferences. */
export const settings = pgTable("settings", {
  id: integer("id").primaryKey().default(1),
  timezone: text("timezone").notNull().default("America/New_York"),
  workingHours: jsonb("working_hours").$type<WorkingHours>().notNull(),
  minBlockMinutes: integer("min_block_minutes").notNull().default(30),
  maxBlockMinutes: integer("max_block_minutes").notNull().default(120),
  bufferMinutes: integer("buffer_minutes").notNull().default(15),
  horizonDays: integer("horizon_days").notNull().default(14),
  scheduleReport: jsonb("schedule_report").$type<ScheduleReport>(),
});

/** Single-row table (id = 1): Google tokens for the owner. */
export const googleAccount = pgTable("google_account", {
  id: integer("id").primaryKey().default(1),
  email: text("email").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  expiresAt: ts("expires_at"),
});

export const calendars = pgTable("calendars", {
  id: text("id").primaryKey(), // provider calendar id
  name: text("name").notNull(),
  color: text("color"),
  isPrimary: boolean("is_primary").notNull().default(false),
  countsAsBusy: boolean("counts_as_busy").notNull().default(true),
  isAscension: boolean("is_ascension").notNull().default(false),
  syncToken: text("sync_token"),
  channelId: text("channel_id"),
  channelResourceId: text("channel_resource_id"),
  channelToken: text("channel_token"),
  channelExpiry: ts("channel_expiry"),
});

export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    calendarId: text("calendar_id")
      .notNull()
      .references(() => calendars.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    title: text("title").notNull().default("(no title)"),
    start: ts("start").notNull(),
    end: ts("end").notNull(),
    allDay: boolean("all_day").notNull().default(false),
    transparent: boolean("transparent").notNull().default(false), // "free" in Google
  },
  (t) => [uniqueIndex("events_calendar_external").on(t.calendarId, t.externalId)],
);

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  color: text("color").notNull().default("#6366f1"),
  deadline: ts("deadline"),
  status: text("status").$type<"active" | "archived">().notNull().default("active"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const tasks = pgTable("tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  notes: text("notes"),
  durationMinutes: integer("duration_minutes").notNull().default(30),
  priority: integer("priority").notNull().default(3), // 1 urgent .. 4 low
  deadline: ts("deadline"),
  deadlineHard: boolean("deadline_hard").notNull().default(false),
  earliestStart: ts("earliest_start"),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  blockedByTaskId: uuid("blocked_by_task_id"),
  status: text("status").$type<"todo" | "done">().notNull().default("todo"),
  splittable: boolean("splittable").notNull().default(true),
  // Recurrence: a template row holds the RRULE; instances point back to it.
  isTemplate: boolean("is_template").notNull().default(false),
  recurrenceRule: text("recurrence_rule"),
  templateId: uuid("template_id"),
  instanceDate: text("instance_date"), // YYYY-MM-DD in the owner's timezone
  completedAt: ts("completed_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const taskBlocks = pgTable("task_blocks", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  start: ts("start").notNull(),
  end: ts("end").notNull(),
  pinned: boolean("pinned").notNull().default(false),
  externalEventId: text("external_event_id"),
});

export const bookingLinks = pgTable("booking_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  durationMinutes: integer("duration_minutes").notNull().default(30),
  bufferMinutes: integer("buffer_minutes").notNull().default(10),
  daysAhead: integer("days_ahead").notNull().default(14),
  minNoticeHours: integer("min_notice_hours").notNull().default(4),
  dailyLimit: integer("daily_limit"),
  active: boolean("active").notNull().default(true),
});

export const bookings = pgTable("bookings", {
  id: uuid("id").primaryKey().defaultRandom(),
  linkId: uuid("link_id")
    .notNull()
    .references(() => bookingLinks.id, { onDelete: "cascade" }),
  guestName: text("guest_name").notNull(),
  guestEmail: text("guest_email").notNull(),
  note: text("note"),
  start: ts("start").notNull(),
  end: ts("end").notNull(),
  externalEventId: text("external_event_id"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const chatMessages = pgTable("chat_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  role: text("role").$type<"user" | "assistant">().notNull(),
  content: jsonb("content").notNull(), // Anthropic content blocks
  createdAt: ts("created_at").notNull().defaultNow(),
  seq: integer("seq").notNull().default(0), // order within one exchange saved at the same instant
});

/** Destructive actions the assistant proposed; they run only when the owner confirms in the UI. */
export const pendingActions = pgTable("pending_actions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tool: text("tool").notNull(),
  input: jsonb("input").notNull(),
  summary: text("summary").notNull(),
  status: text("status").$type<"pending" | "confirmed" | "cancelled">().notNull().default("pending"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export type Task = typeof tasks.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type CalendarEvent = typeof events.$inferSelect;
export type TaskBlock = typeof taskBlocks.$inferSelect;
export type Settings = typeof settings.$inferSelect;
export type BookingLink = typeof bookingLinks.$inferSelect;
export type Booking = typeof bookings.$inferSelect;
export type CalendarRow = typeof calendars.$inferSelect;
