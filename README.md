# Nudge

A personal reminders app that is fast to use and hard to break. It installs as a PWA on the iPhone home screen and on Windows through Edge, and alerts on time through Web Push. All of it runs on Cloudflare's free plan: one Worker plus one SQLite Durable Object per person.

## Deploy your own

```sh
bun install
bun run deploy --name <worker-name>
bun run secrets <worker-name>
```

`bun run secrets` generates the instance keys, stores them as Worker secrets, and prints the one-time setup code for the first device. To get health alerts on Telegram, set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in your environment before running it.

Open `https://<worker-name>.<your-subdomain>.workers.dev`, install it, and enter the setup code. To add more devices, use **Add a device** on a device that's already set up.
