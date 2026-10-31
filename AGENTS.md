# AGENTS.md

Nudge is a personal reminders app: an installable PWA (iPhone home screen, Windows via Edge) backed by one Cloudflare Worker and one SQLite Durable Object per instance. One person per instance; several instances can be deployed from this repo under different Worker names.

## Commands

Bun is the only package manager and script runner. Never use npm, pnpm or yarn. Formatting is oxfmt and linting is oxlint; do not add Prettier, ESLint or editor config files.

| Task                     | Command                               |
| ------------------------ | ------------------------------------- |
| Install                  | `bun install`                         |
| Format                   | `bun run fmt`                         |
| Lint (type-aware oxlint) | `bun run lint`                        |
| Unused code and deps     | `bun run knip`                        |
| Typecheck (tsgo)         | `bun run check`                       |
| Test                     | `bun run test`                        |
| Build client + SW        | `bun run build`                       |
| Local dev                | `bun run dev`                         |
| Deploy an instance       | `bun run deploy --name <worker-name>` |
| Instance secrets         | `bun run secrets <worker-name>`       |
| Local dev secrets        | `bun run secrets --dev`               |

`bun run fmt:check`, `bun run lint`, `bun run knip`, `bun run check`, `bun run test` and `bun run build` must all pass before every push. CI runs the same steps.

## Layout

```
src/shared   contracts and helpers used by more than one runtime (API types, base64, ids)
src/browser  code shared by the two browser runtimes, the app and the service worker (IndexedDB, API client)
src/worker   Worker entry, Durable Object, scheduling, push delivery, alerts
src/app      Svelte 5 client
src/sw       service worker (cache, push, notification actions)
scripts      one-off tooling (icons, secrets)
test         bun tests
```

Code that runs in more than one runtime belongs in `src/shared`; code shared only by the app and the service worker belongs in `src/browser`. Nothing in `src/shared` may import from another `src` folder, and `src/browser` may import only from `src/shared`.

Web Push mechanics come from [declarative-web-push](https://github.com/rexdotsh/declarative-web-push), extracted from this repo: the message format and builder (`declarative-web-push`, used in `src/shared`), VAPID, encryption and the push service allowlist (`/server`, in `src/worker`), reading pushes and closing notifications (`/worker`, in `src/sw` and `src/browser`), and subscribing, permission and clearing (`/client`, in `src/app` and `src/browser`).

## Architecture invariants

- The Durable Object is the single source of truth. Each API request is exactly one RPC into it, through `NudgeDO.call`.
- The API contract lives in `src/shared/api.ts`. Client, Worker and Durable Object all derive their types from it; never restate a request or response shape anywhere else.
- Nothing polls. Work happens when a reminder is due (the DO alarm, always set to the earliest `next_fire_at`), when a client calls in, or in the hourly watchdog cron.
- Static assets are served without running the Worker. Only `/api/*` reaches Worker code.
- `/api/v1/*` is the JSON API for agents (`skills/nudge/SKILL.md` documents it). The Worker only maps its methods and paths onto the agent routes in `src/shared/api.ts`; each is still one `NudgeDO.call`, and its writes are the same ops as sync, with `Idempotency-Key` as the op id. An agent token belongs to a device of kind `agent`, which can use nothing but `/api/v1`.
- The instance has one time zone, kept in the Durable Object and returned by every sync: it follows the device that last moved, unless it was fixed in Settings. Every device plans, shows, badges and falls back in the zone the server last confirmed, never its own or a guess, so a device left at home agrees with the server. A device records the notices it showed by occurrence (`noticeKey`) as well as by fire id, and a zone move keeps how far a reminder has fired relative to its due time, so moving the zone never repeats or drops a notification.
- `/api/windows` is the one route the Worker answers itself: after `NudgeDO.isEnrolled` confirms the device, the Worker has the PWABuilder packaging service build this instance's Windows installer, checks it and returns it. Nothing is stored.
- No KV, D1, R2 or Queues. One Worker, one Durable Object class.
- declarative-web-push provides mechanisms and Nudge keeps the policy: what a tag means (`<id>:<due>`), when a notification is settled, resends and escalation, receipts and the outbox. A fix to how pushes are sent, read or cleared, or a new iOS finding, goes to the library first, with its tests.
- Every write path must be safe to retry. Pushes use `tag = <reminder id>:<due>` so a resend replaces instead of stacking.
- The client renders from local state first and never blocks first paint on the network.

## Privacy

This repository is public. It must never contain anything that identifies a person or a deployment: no names, no instance or Worker names, no workers.dev subdomains, no chat ids, tokens, emails or time zones of real people. Instance details belong in Worker secrets or in an untracked local `PRIVATE.md` (excluded via `.git/info/exclude`). Read it for deployment context; never copy from it into tracked files, commits, PR text or review comments.

## Code standards

The bar is the [thermo-nuclear code quality review](https://github.com/cursor/plugins/blob/main/cursor-team-kit/skills/thermo-nuclear-code-quality-review/SKILL.md). In short:

- **Comments are rare.** Write code that does not need them. Only comment a non-obvious _why_ (a platform quirk, a spec requirement). Never narrate what the next line does, never leave section banners, TODOs without an issue, or commented-out code.
- **No duplication.** Before writing a helper, search for an existing one. Two copies of the same logic is a bug.
- **Direct and boring.** No speculative abstraction, no pass-through wrappers, no clever indirection. Delete layers rather than polish them. Look for the restructure that makes branches disappear.
- **Types are the contract.** No `any`. Avoid `unknown` except at a validated boundary, avoid casts, avoid optionality that hides an invariant. Validate untrusted input once, at the edge, into a typed value.
- **No spaghetti.** Do not bolt special-case `if`s onto unrelated flows. Model the difference (a table, a union, a dedicated module) instead.
- **Small focused files.** Treat 300 lines as a prompt to split, and never let a file pass 1000 lines.
- **Parallel and atomic.** Run independent async work concurrently. Keep related writes in one transaction so state is never half-applied.
- **Fail loudly.** No silent catch-and-continue. Expected failures are typed results. Unexpected ones surface (and alert, on the server).
- **Few dependencies.** Prefer platform APIs (WebCrypto, Intl, IndexedDB). Every new dependency needs a reason in the PR description. The one runtime library besides Svelte is declarative-web-push: it is this app's own push code, published so the iOS findings it encodes are shared and tested in one place, and it has no dependencies of its own.

## Testing

A test exists to catch a bug that would hurt someone. Before writing or keeping one, ask: if this broke in production, who would be hurt, and would nothing else catch it (types, lint, a look at the app)? If nobody, or something else would, don't write it.

- **Write one for:** reminders that could fire late, twice or never (recurrence, time zones and DST, fire planning, scheduling, retries, receipts, leases, crash recovery); replays and idempotency (ops, the outbox, enrollment, op ids); security boundaries (tokens, enrollment, input validation); data integrity (sync, migrations, tombstones); the quick-add parser, because what she types must become the reminder she meant.
- **Never write one that:** tests what declarative-web-push tests (encryption interop, VAPID, the push endpoint allowlist, reading pushes, the clearing retry); pins a value (a label, copy, a CSS class, a colour, a pixel); restates the code; covers what types or lint guarantee; repeats another layer's test of the same rule (pick the cheapest layer that catches it); guards a cosmetic detail (layout, spacing, wording, order); tests UI components; or depends on timing or global state it doesn't control.
- **When a test fails on a legitimate change, the test is usually wrong:** delete or rewrite it, don't patch in the new value.
- **Bug fixes:** add a test only if the bug could hurt someone and could come back. It must fail without the fix, but failing without the fix doesn't earn it a place on its own.
- **Prefer one table-driven test over many small ones.** A test file longer than the code it covers is a smell.

## Client UI

- One calm look on every platform, in a choice of themes: Classic (warm near-black with a coral accent, the default), and Rex Dark and Rex Light (the dark and light palettes of the owner's website). Each theme sets its own `color-scheme`, so native controls match it. DM Sans only. Each theme has one accent that means attention and is never decoration: what is now or late, what the composer understood, errors, and destructive or primary text actions (Save, Delete, Undo). Pressed, selected and "on" controls (toggles, segments, the selected day or option, primary buttons, the send arrow) fill with `--on` and draw on it in `--on-ink`; focus rings use `--ring` and cards rest on `--lift`. Classic maps these to ink, its background, `--ink-2` and no lift, so it never shows its accent outside attention. The Rex themes are rose-forward like the site: `--on` and `--ring` are its rose, and surfaces, edges, lines and shadows carry a rose tint, while the accent stays a separate rose (lighter in Rex Dark, deeper in Rex Light) so attention still stands out. Tokens (including `--on`, `--on-ink`, `--ring`, `--lift`, `--scrim` and `--shadow`) and shared primitives (`.page`, `.heading`, `.surface`, `.group`, `.field`, `.btn`, `.press`, `.link`, `.chip`, `.bare`, `.picker`, `.toggle`, `.sr-only`) live in `src/app/styles.css`; components use them and add no new colours.
- A theme is one `[data-theme]` block in `src/app/styles.css` that sets every colour token, plus an entry in `THEMES` (`src/shared/api.ts`) and a label. Its text must meet WCAG AA on every surface it can sit on, hover states included. The choice belongs to the instance: it is stored in the Durable Object, travels with sync, and is painted before first paint by the inline script in `src/app/index.html` from a `localStorage` cache, which is best effort: storage that is missing, full or corrupt only means a launch in Classic.
- The home screen is triage: the reminder that matters now (with its actions), then the rest of today, then a quieter Later list, then any paused repeats. Rarely needed settings, like pinning a time zone, stay out of the way until they are relevant: fixing the instance zone is the value of one Settings row, and the home heading names the zone only while this device's clock reads differently.
- Fonts are self-hosted latin subsets (`src/app/fonts.css`), because the service worker precaches every built file.
- Installed iOS apps blur whatever scrolls under a see-through status bar, so `TitleBar.svelte` covers the top inset with a fixed strip in `--bg` (it is the title bar under Windows' window controls too), and the app never sets `apple-mobile-web-app-status-bar-style` to `black-translucent`. Sheets stop short of it.
- Platforms differ in behaviour, not looks: the iOS install guide, safe areas, haptics, touch swipes, hover actions, keyboard shortcuts and where the composer sits.
- Motion is quick and cosmetic: it never delays focus or state, and only follows a change after first paint, never typing. Animate only `transform` and `opacity`. Entrances take `--base`, exits, presses and menus `--fast`, eased with `--ease` (`--spring` for what is let go); reduced motion sets both durations to zero. Script reads them through `src/app/lib/motion.svelte.ts`: `arrive` and `depart` for Svelte transitions, `glide` for the home list (anything marked `data-glide` slides, rises in or fades out), and `swap` for View Transitions between screens (a short slide on touch screens) and themes. Pressable controls that aren't `.btn` take `.press`.
- Text meets WCAG AA contrast.

## Workflow

- Never commit to `main`. One branch per change, opened as a PR.
- Conventional Commits for every commit and PR title (`feat(worker): …`, `fix(app): …`, `build: …`). PRs are squash-merged, so the PR title becomes the commit on `main`.
- PRs are coherent and reviewable: one feature or concern, typically a few hundred lines. The description says what changed, why, and how it was verified.
- UI PRs attach screenshots of every changed screen on iPhone and Windows with `gh pr create --attach '<file>#<alt>'`. Post fresh ones with `gh pr comment --attach` whenever review changes the UI.
- Every PR is reviewed by an independent agent against the code standards above. Address the findings, push, and request another round. Merge only after the reviewer has no remaining structural objections, or after three rounds with any remaining disagreements written up in the PR.
