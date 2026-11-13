# Ascension

A personal planner that schedules your tasks for you. Add tasks with a duration, priority and deadline; Ascension places them on your calendar around your meetings and re-plans whenever something changes.

## What it does

- **Auto-scheduling.** A deterministic engine fills your working hours with task blocks, ordered by urgency, deadline and priority. It respects dependencies between tasks, splits long tasks into chunks, and warns you when something will not fit before its deadline.
- **Calendar.** Week and day views. Drag or resize a task block to pin it; drag on empty space to add an event.
- **Projects and repeating tasks.** Group tasks under a project with a deadline; create tasks that repeat daily or on chosen weekdays.

Google Calendar sync, the AI assistant and booking links are being added next (see `Status` below).

## Run it locally

```bash
npm install
npm run db:seed   # optional: a sample week of meetings and tasks
npm run dev
```

Open http://localhost:3000. With no configuration the app uses an embedded Postgres database stored in `.data/`, so there is nothing else to install.

## Configuration

Copy `.env.example` to `.env.local` and fill in what you need. Everything is optional for local use.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the app in development |
| `npm test` | Unit tests (scheduler and data logic) |
| `npm run e2e` | Browser tests against a production build with a throwaway database |
| `npm run lint` / `npm run typecheck` | Static checks |
| `npm run db:generate` | Create a migration after editing `src/db/schema.ts` |
| `npm run db:migrate` | Apply migrations to the database in `DATABASE_URL` |
| `npm run db:seed` | Load sample data |

## How it is put together

- `src/lib/scheduler/` – the scheduling engine: a pure function from tasks, busy time and settings to a plan.
- `src/lib/reschedule.ts` – loads the inputs, runs the engine and applies only what changed.
- `src/lib/services.ts` – every operation on tasks, projects, events and settings; used by both the UI and the assistant.
- `src/lib/calendar/` – the calendar provider interface, with a local implementation and Google.
- `src/db/` – Drizzle schema and database client. `drizzle/` holds SQL migrations.
- `src/app/`, `src/components/` – Next.js pages and UI.

## Status

- [x] Tasks, projects, repeating tasks
- [x] Scheduling engine and calendar UI
- [ ] Google sign-in and two-way Google Calendar sync
- [ ] AI assistant
- [ ] Booking links
- [ ] Deployment to Vercel
