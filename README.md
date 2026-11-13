# Ascension

A personal planner that schedules your tasks for you. Add tasks with a duration, priority and deadline; Ascension places them on your calendar around your meetings and re-plans whenever something changes.

## What it does

- **Auto-scheduling.** A deterministic engine fills your working hours with task blocks, ordered by urgency, deadline and priority. It respects dependencies between tasks, splits long tasks into chunks, and warns you when something will not fit before its deadline.
- **Calendar.** Week and day views. Drag or resize a task block to pin it; drag on empty space to add an event.
- **Projects and repeating tasks.** Group tasks under a project with a deadline; create tasks that repeat daily or on chosen weekdays.
- **Google Calendar sync.** Your events count as busy time; task blocks are written to a separate "Ascension" calendar. Moving or deleting a block in Google is picked up on the next sync.
- **AI assistant.** Ask in plain language: "add 3 hours for the Q4 deck before Friday", "what does tomorrow look like?", "why is the report late?". It works through the same operations as the UI, and asks you to confirm before deleting anything.
- **Booking links.** Share `/book/<link>` so others can pick a free time. Bookings land on your calendar with the guest invited, and tasks move out of the way.

## Run it locally

```bash
npm install
npm run db:seed   # optional: a sample week of meetings and tasks
npm run dev
```

Open http://localhost:3000. With no configuration the app uses an embedded Postgres database stored in `.data/`, so there is nothing else to install.

## Configuration

Copy `.env.example` to `.env.local` and fill in what you need. Everything is optional for local use: without Google the app keeps its own calendar, and without an Anthropic key the assistant is switched off.

### Google sign-in and Calendar

1. In Google Cloud Console, create a project, enable the **Google Calendar API**, and set up the OAuth consent screen (External, add yourself as a test user, or publish the app so refresh tokens do not expire after 7 days).
2. Create an OAuth client of type **Web application** with redirect URI `<your app URL>/api/auth/callback/google` (locally `http://localhost:3000/api/auth/callback/google`).
3. Set `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `AUTH_SECRET` and `ALLOWED_EMAIL`. Only that address can sign in.

Once Google is configured, sign-in is required. Sync runs on sign-in, from Settings › Sync now, instantly via Google push notifications when the app has a public https URL, and daily via the cron in `vercel.json`.

### AI assistant

Set `ANTHROPIC_API_KEY`. The model defaults to `claude-opus-5-5`; override with `ANTHROPIC_MODEL`.

## Deploy to Vercel

1. Create a Postgres database (for example Neon) and set `DATABASE_URL`.
2. Run `npm run db:migrate` against it once (and after each schema change).
3. Import the repo in Vercel and set the environment variables from `.env.example`, including `CRON_SECRET`.
4. Add the production URL's callback to the Google OAuth client.

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
- `src/lib/calendar/` – the calendar provider interface, with a local implementation and Google, plus sync.
- `src/lib/ai/` – the assistant: tools, prompt and chat loop.
- `src/lib/booking/` – availability and booking for public links.
- `src/db/` – Drizzle schema and database client. `drizzle/` holds SQL migrations.
- `src/app/`, `src/components/` – Next.js pages and UI.

## Status

- [x] Tasks, projects, repeating tasks
- [x] Scheduling engine and calendar UI
- [x] Google sign-in and two-way Google Calendar sync
- [x] AI assistant
- [x] Booking links
- [ ] Deployment to Vercel (needs a database, Google OAuth client and Anthropic key)
