# Nudge

A personal reminders app that is fast to use and hard to break. It installs as a PWA on the iPhone home screen and on Windows through Edge, and alerts on time through Web Push. All of it runs on Cloudflare's free plan: one Worker plus one SQLite Durable Object per person.

<p>
  <img src="docs/screenshots/ios-home.webp" width="260" alt="Home on iPhone: the reminder due now with Done and Snooze, then the rest of today and a quieter Later list" />
  <img src="docs/screenshots/ios-composer.webp" width="260" alt="Typing a reminder: the time and the repeat it understood turn coral, and a line says exactly what will be saved" />
  <img src="docs/screenshots/ios-editor.webp" width="260" alt="Editing a reminder" />
</p>
<p>
  <img src="docs/screenshots/windows-home.webp" width="800" alt="Nudge on Windows" />
</p>

- **Now, next, later.** The reminder that matters right now sits on top with Done and Snooze ready. The rest of today follows, and everything later is quieter.
- **Type it like you'd say it.** "dentist next tue 10am every 6 months", "water the plants every 3 days after done", "book club last fri of the month 7pm". What Nudge understood is highlighted as you type, and it tells you exactly what it will save.
- **Repeats are real calendar rules (RFC 5545)**, plus repeats that count from when you finish. Times follow you when you travel.
- **It always shows up.** The server wakes for each reminder on the exact second, retries, resends when the phone doesn't confirm, and tells you on Telegram if something's off.
- **Works offline.** Everything is local first and syncs when you're back.

## Deploy your own

```sh
bun install
bun run deploy --name <worker-name>
bun run secrets <worker-name>
```

`bun run secrets` generates the instance keys, stores them as Worker secrets, and prints the one-time setup code for the first device. To get health alerts on Telegram, set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in your environment before running it.

Open `https://<worker-name>.<your-subdomain>.workers.dev`, install it, and enter the setup code. To add more devices, use **Settings → Add a device** on one that's already set up.
