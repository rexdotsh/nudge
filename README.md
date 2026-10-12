# Nudge

Personal reminders that show up on time. An installable PWA for iPhone, Mac and Windows, running on one Cloudflare Worker and one SQLite Durable Object per person.

<p>
  <img src="docs/screenshots/ios-home.webp" width="260" alt="Home on iPhone: the next reminder on top with Done and Snooze, then the rest of today and a quieter Later list" />
  <img src="docs/screenshots/ios-composer.webp" width="260" alt="Typing a reminder: the time and the repeat it understood turn coral, and the send button says when it will remind and how often" />
  <img src="docs/screenshots/ios-editor.webp" width="260" alt="Editing a reminder" />
</p>
<p>
  <img src="docs/screenshots/windows-home.webp" width="800" alt="Nudge on Windows: the list with the editor docked beside it" />
</p>

- Type it like you'd say it: "book club last fri of the month 7pm".
- Real calendar repeats, plus "every 3 days after done".
- Web Push on time, with retries and Telegram alerts if something's off.
- Local first, works offline.

## Deploy

```sh
bun install
bun run deploy --name <worker-name>
bun run secrets <worker-name>
```

For Telegram alerts, export `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` before `secrets`. Then open the Worker's URL, install it, and enter the setup code it printed. Add more devices from Settings. On Windows 11, Settings also offers an installable app.
