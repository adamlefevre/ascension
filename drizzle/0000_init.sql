CREATE TABLE "booking_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"duration_minutes" integer DEFAULT 30 NOT NULL,
	"buffer_minutes" integer DEFAULT 10 NOT NULL,
	"days_ahead" integer DEFAULT 14 NOT NULL,
	"min_notice_hours" integer DEFAULT 4 NOT NULL,
	"daily_limit" integer,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "booking_links_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"link_id" uuid NOT NULL,
	"guest_name" text NOT NULL,
	"guest_email" text NOT NULL,
	"note" text,
	"start" timestamp with time zone NOT NULL,
	"end" timestamp with time zone NOT NULL,
	"external_event_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendars" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"counts_as_busy" boolean DEFAULT true NOT NULL,
	"is_ascension" boolean DEFAULT false NOT NULL,
	"sync_token" text,
	"channel_id" text,
	"channel_resource_id" text,
	"channel_token" text,
	"channel_expiry" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role" text NOT NULL,
	"content" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"calendar_id" text NOT NULL,
	"external_id" text NOT NULL,
	"title" text DEFAULT '(no title)' NOT NULL,
	"start" timestamp with time zone NOT NULL,
	"end" timestamp with time zone NOT NULL,
	"all_day" boolean DEFAULT false NOT NULL,
	"transparent" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "google_account" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"email" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT '#6366f1' NOT NULL,
	"deadline" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"timezone" text DEFAULT 'America/New_York' NOT NULL,
	"working_hours" jsonb NOT NULL,
	"min_block_minutes" integer DEFAULT 30 NOT NULL,
	"max_block_minutes" integer DEFAULT 120 NOT NULL,
	"buffer_minutes" integer DEFAULT 15 NOT NULL,
	"horizon_days" integer DEFAULT 14 NOT NULL,
	"schedule_report" jsonb
);
--> statement-breakpoint
CREATE TABLE "task_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"start" timestamp with time zone NOT NULL,
	"end" timestamp with time zone NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"external_event_id" text
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"notes" text,
	"duration_minutes" integer DEFAULT 30 NOT NULL,
	"priority" integer DEFAULT 3 NOT NULL,
	"deadline" timestamp with time zone,
	"deadline_hard" boolean DEFAULT false NOT NULL,
	"earliest_start" timestamp with time zone,
	"project_id" uuid,
	"blocked_by_task_id" uuid,
	"status" text DEFAULT 'todo' NOT NULL,
	"splittable" boolean DEFAULT true NOT NULL,
	"is_template" boolean DEFAULT false NOT NULL,
	"recurrence_rule" text,
	"template_id" uuid,
	"instance_date" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_link_id_booking_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."booking_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_calendar_id_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_blocks" ADD CONSTRAINT "task_blocks_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "events_calendar_external" ON "events" USING btree ("calendar_id","external_id");