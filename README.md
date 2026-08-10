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

## Render storage

Render's normal filesystem is temporary. To keep rides and participants after restarts, add a persistent disk to the Render Web Service:

```text
Mount path: /var/data
Environment variable: DATA_DIR=/var/data
```

The service must have permission to write to that mounted path. Alternatively, use a managed database for production or multiple instances.

## Render environment variables

```text
DATA_DIR=/var/data
RESEND_API_KEY=re_...
FROM_EMAIL=rides@your-verified-domain.example
```

`PORT` is supplied automatically by Render. Mail delivery errors are logged by the server but no longer prevent a participant from being saved.

## Troubleshooting notifications

Check the deployed configuration:

```text
https://YOUR-APP.onrender.com/api/health
```

It reports whether the API key and sender address are present, without revealing their values. If a message is not delivered, open the Render logs. The server prints the exact reason, for example a missing key, an invalid sender domain, or a rejection from Resend.

Notifications are sent to the address entered in the optional notification field. If that field was left empty, the ride creator's e-mail address is used instead.
