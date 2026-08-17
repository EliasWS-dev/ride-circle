# Ride Circle

A small server-backed bike ride planner for groups of friends. The server is the source of truth: it calculates the seven-day window, filters historical rides, validates entries, and persists rides in `data/rides.json`.

## Run locally

Requires Node.js 18+.

```powershell
npm start
```

Open http://localhost:3000.

## Notifications

Ride creators can enter a notification e-mail. To send join/leave messages, configure Resend:

```powershell
$env:RESEND_API_KEY="re_..."
$env:FROM_EMAIL="rides@your-verified-domain.example"
npm start
```

Without these variables the app still stores notification addresses, but does not attempt delivery. Never commit API keys.

## Safe GitHub deployment

Important: the project must be inside its own folder. Do not run Git commands from `C:\Users\elias`, because that makes Git scan your complete Windows user profile.

Use only this folder:

```powershell
Set-Location "C:\Users\elias\ride-circle"
git add package.json server.js index.html styles.css app.js README.md .gitignore
git commit -m "Update persistence and notifications"
git push origin main
```

## Durable storage with Supabase

Render's filesystem is temporary, so a JSON file is lost whenever the service restarts, sleeps, or redeploys. On Render's free plan the rides must therefore live in an external database.

The server talks to Supabase through its REST API using `fetch`, so no extra npm packages are required. Create the table once in the Supabase SQL editor:

```sql
create table public.rides (
  id uuid primary key,
  data jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.rides enable row level security;
```

Row Level Security stays enabled and no public policy is added. Only the server may read or write, because it authenticates with the secret service role key. That key must never be used in browser code.

Copy the project URL and the service role key from **Project Settings → API**.

If `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are absent, the server falls back to the local file in `DATA_DIR`, which is convenient for development but not durable on Render.

## Render environment variables

```text
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
RESEND_API_KEY=re_...
FROM_EMAIL=rides@your-verified-domain.example
```

Optional: `SUPABASE_TABLE` overrides the table name, and `DATA_DIR` sets the local fallback directory.

`PORT` is supplied automatically by Render. Mail delivery errors are logged by the server but no longer prevent a participant from being saved.

## Troubleshooting notifications

Check the deployed configuration:

```text
https://YOUR-APP.onrender.com/api/health
```

It reports whether storage is durable, whether Supabase is reachable, and whether the mail settings are present, without revealing any secret values. When storage fails, `storageError` contains the exact message returned by Supabase, and the ride endpoints answer with status 503 instead of a generic error.

Common causes of a storage error:

- The `rides` table was not created, or it lives in a schema other than `public`.
- `SUPABASE_URL` is wrong; it must look like `https://<project-ref>.supabase.co`.
- The publishable key was used instead of the service role key, so Row Level Security blocks access.
- The Supabase project is paused after a long period of inactivity. If a message is not delivered, open the Render logs. The server prints the exact reason, for example a missing key, an invalid sender domain, or a rejection from Resend.

Notifications are sent to the address entered in the optional notification field. If that field was left empty, the ride creator's e-mail address is used instead.
