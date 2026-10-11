# AGENTS.md

Nudge is a personal reminders app: an installable PWA (iPhone home screen, Windows via Edge) backed by one Cloudflare Worker and one SQLite Durable Object per instance. One person per instance; several instances can be deployed from this repo under different Worker names.

## Commands

Bun is the only package manager and script runner. Never use npm, pnpm or yarn. Formatting is oxfmt and linting is oxlint; do not add Prettier, ESLint or editor config files.

| Task                     | Command                               |
| ------------------------ | ------------------------------------- |
| Install                  | `bun install`                         |
| Format                   | `bun run fmt`                         |
| Lint (type-aware oxlint) | `bun run lint`                        |
| Typecheck (tsgo)         | `bun run check`                       |
| Test                     | `bun run test`                        |
| Build client + SW        | `bun run build`                       |
| Local dev                | `bun run dev`                         |
| Deploy an instance       | `bun run deploy --name <worker-name>` |
| Instance secrets         | `bun run secrets <worker-name>`       |
| Local dev secrets        | `bun run secrets --dev`               |

`bun run fmt:check`, `bun run lint`, `bun run check`, `bun run test` and `bun run build` must all pass before every push. CI runs the same steps.

## Layout

```
src/shared   contracts and helpers used by more than one runtime (API types, base64, ids)
src/worker   Worker entry, Durable Object, scheduling, push delivery, alerts
src/app      Svelte 5 client
src/sw       service worker (cache, push, notification actions)
scripts      one-off tooling (icons, secrets)
test         bun tests
```

Code that runs in more than one runtime belongs in `src/shared`. Nothing in `src/shared` may import from another `src` folder.

## Architecture invariants

- The Durable Object is the single source of truth. Each API request is exactly one RPC into it, through `NudgeDO.call`.
- The API contract lives in `src/shared/api.ts`. Client, Worker and Durable Object all derive their types from it; never restate a request or response shape anywhere else.
- Nothing polls. Work happens when a reminder is due (the DO alarm, always set to the earliest `next_fire_at`), when a client calls in, or in the hourly watchdog cron.
- Static assets are served without running the Worker. Only `/api/*` reaches Worker code.
- No KV, D1, R2 or Queues. One Worker, one Durable Object class.
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
- **Few dependencies.** Prefer platform APIs (WebCrypto, Intl, IndexedDB). Every new dependency needs a reason in the PR description.

## Testing

A test exists to catch a bug that would hurt someone. Before writing or keeping one, ask: if this broke in production, who would be hurt, and would nothing else catch it (types, lint, a look at the app)? If nobody, or something else would, don't write it.

- **Write one for:** reminders that could fire late, twice or never (recurrence, time zones and DST, fire planning, scheduling, retries, receipts, leases, crash recovery); replays and idempotency (ops, the outbox, enrollment, op ids); security boundaries (tokens, enrollment, the push endpoint allowlist, input validation); data integrity (sync, migrations, tombstones); spec interop (Web Push encryption against the reference implementation); the quick-add parser, because what she types must become the reminder she meant.
- **Never write one that:** pins a value (a label, copy, a CSS class, a colour, a pixel); restates the code; covers what types or lint guarantee; repeats another layer's test of the same rule (pick the cheapest layer that catches it); guards a cosmetic detail (layout, spacing, wording, order); tests UI components; or depends on timing or global state it doesn't control.
- **When a test fails on a legitimate change, the test is usually wrong:** delete or rewrite it, don't patch in the new value.
- **Bug fixes:** add a test only if the bug could hurt someone and could come back. It must fail without the fix, but failing without the fix doesn't earn it a place on its own.
- **Prefer one table-driven test over many small ones.** A test file longer than the code it covers is a smell.

## Client UI

- Native feel per platform through `data-platform` skins (iOS and Windows), not separate components.
- System fonts only. Animate only `transform` and `opacity`. Respect `prefers-reduced-motion`, safe areas and Dynamic Type.

## Workflow

- Never commit to `main`. One branch per change, opened as a PR.
- Conventional Commits for every commit and PR title (`feat(worker): …`, `fix(app): …`, `build: …`). PRs are squash-merged, so the PR title becomes the commit on `main`.
- PRs are coherent and reviewable: one feature or concern, typically a few hundred lines. The description says what changed, why, and how it was verified.
- UI PRs attach screenshots of every changed screen on iPhone and Windows, in light and dark, with `gh pr create --attach '<file>#<alt>'`. Post fresh ones with `gh pr comment --attach` whenever review changes the UI.
- Every PR is reviewed by an independent agent against the code standards above. Address the findings, push, and request another round. Merge only after the reviewer has no remaining structural objections, or after three rounds with any remaining disagreements written up in the PR.
