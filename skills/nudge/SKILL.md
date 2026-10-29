---
name: nudge
description: Read and manage the user's reminders in Nudge, their personal reminders app. Use when the user says "remind me", wants a to-do with a time or date, a recurring task (daily meds, rent on the 1st, weekly calls), asks what's due today, late or coming up, or wants to complete, skip, snooze, pause, resume, edit, delete or restore a reminder.
---

# nudge

Personal reminders with push notifications. One instance belongs to one person. JSON API at `$NUDGE_URL/api/v1`.

## Auth

Send the agent token as a bearer token:

```sh
curl -s "$NUDGE_URL/api/v1/today" -H "Authorization: Bearer $NUDGE_TOKEN"
```

Read the URL from `$NUDGE_URL` and the token from `$NUDGE_TOKEN`. If they aren't set, ask the user to open Nudge, go to Settings → Agents → Connect an agent, and set the two lines it shows in your environment. Never write the token to files, commits, or logs. Each token appears in Settings under Devices, where the user can remove it; a `401` means it was removed. Requests are rate limited (about 120/min per token); a `429` means slow down.

## Model

- **Time zones.** The instance's zone follows the owner's devices: it is wherever they last were, and it is `zone` in every list response. `now` in the same response is the owner's current local time; use it to resolve "today" or "tonight", not your own clock.
- **Wall times.** You send times as wall times, `YYYY-MM-DDTHH:MM` with no offset, meaning that time in the owner's zone. `start` and `due` come back the same way. Instants come back with their offset, like `2026-11-01T18:00-05:00` (`dueAt`, `snoozedUntil`, `paused`, `createdAt`). A reminder with `zone: null` follows the owner when they travel ("9am" stays 9am wherever they are); one with a pinned `zone` like `"Europe/London"` keeps that zone's time.
- **Due and late.** `due` is the occurrence that is current now. `late` is true once it has passed and isn't done, snoozed or paused. `done` is true once a one-off is completed (or a repeat has ended); its `due` is then `null`.
- **Repeats.** `repeat` is `null` or `{ rule, anchor, text }`: `text` is how the app describes it ("Every weekday at 9:30 AM"), `rule` is an RRULE, and `anchor` is `schedule` (calendar dates) or `completion` (counts from when it was last done, as in "every 3 days after done"). Completing a repeat moves `due` to the next occurrence; skipping does the same without counting it as done.
- **Pause.** Only repeats can be paused, until a date or until resumed. Nothing fires while paused, and occurrences that would have come up meanwhile are dropped, not sent as a backlog.
- **Snooze** hides the current occurrence until a time, then it notifies again. A span like `"1h"` counts from when it is due, or from now if it is already due.
- **Important** reminders (`important: true`, or `!` in the text) notify again every 5 minutes for up to 2 hours until they are done or snoozed. Use it only when the user asks for nagging.
- **Early alerts.** `alerts` are minutes before `due` for an extra heads-up, like `[10]` or `[60, 1440]` (up to 5, at most 28 days).
- **Revisions.** Every reminder has a `rev` that goes up with each change, including when it fires. Edits need the `rev` you last read.
- Deletes are soft: a deleted reminder can be restored.

## Endpoints

| Method | Path                             | Notes                                                                                                                                                                                                                     |
| ------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/v1/today`                  | `{ zone, now, late, today, next }`: what is late, what is still due today in order, and the first one after today                                                                                                         |
| GET    | `/api/v1/reminders`              | `{ zone, now, reminders }` in the order they come up. `?status=open` (default), `done`, `deleted` or `all`; `?q=` matches title and notes; `?limit=` 1–500, default 100                                                   |
| POST   | `/api/v1/reminders`              | Create. Body `{ "text": "..." }`, read the way the app reads what the user types; any field below sent alongside it wins. Or explicit fields with **required** `title` and `start`. `201` with `{ reminder, understood }` |
| GET    | `/api/v1/reminders/:id`          | One reminder, deleted or not                                                                                                                                                                                              |
| PATCH  | `/api/v1/reminders/:id`          | Change some of `title, notes, start, zone, repeat, important, alerts`, with **required** `rev`. `409` if it changed since (body has `current`)                                                                            |
| POST   | `/api/v1/reminders/:id/complete` | Done. Optional `{ "due": "..." }`: the occurrence you mean; `409` if it is no longer current                                                                                                                              |
| POST   | `/api/v1/reminders/:id/skip`     | Repeats only: move past the current occurrence. Optional `due`, as for complete                                                                                                                                           |
| POST   | `/api/v1/reminders/:id/snooze`   | `{ "until": "1h" }`, a span (`30m`, `2 hours`, `3 days`), a wall time, or a time with an offset (`2026-11-01T18:00-05:00`); impossible dates are a `400`. Optional `due`                                                  |
| POST   | `/api/v1/reminders/:id/pause`    | Repeats only. `{ "until": "2026-12-01T09:00" }` (or a span), or no body to pause until resumed                                                                                                                            |
| POST   | `/api/v1/reminders/:id/resume`   | End a pause                                                                                                                                                                                                               |
| POST   | `/api/v1/reminders/:id/reopen`   | Undo completing a one-off: `{ "rev": N }` with the `rev` the complete returned. `409` if it changed since, or for a repeat, whose completion only the app can undo                                                        |
| DELETE | `/api/v1/reminders/:id`          | Soft delete                                                                                                                                                                                                               |
| POST   | `/api/v1/reminders/:id/restore`  | Undo a delete                                                                                                                                                                                                             |

Fields: `title` (1–200 chars), `notes` (up to 4000), `start` (wall time of the first occurrence, which anchors a repeat), `zone` (`null` or a time zone), `repeat` (`null` or `{ "rule": "FREQ=WEEKLY;BYDAY=MO,TH", "anchor": "schedule" }`; a `completion` anchor takes only `FREQ` and `INTERVAL`), `important` (boolean), `alerts` (minutes).

Every write accepts an **`Idempotency-Key`** header: make up one key per change (a UUID) and send the same key with the same request if you retry it. The retry changes nothing and gets exactly the response the first one got (including `understood`), so a timeout never completes two occurrences or creates a duplicate. A used key sent with any other request is refused with `422` and changes nothing. Only a write that succeeds uses up its key: a `4xx` is not stored, so after fixing the request (or once it makes sense, say after a `409`) you can send it again with the same key. Always send one on writes.

Errors come back as `{ "error": "..." }` with a 4xx status saying what was wrong, like `start: expected a wall time like 2026-11-02T18:00`. A `409` also has `current`, the reminder as it is now. A `422` means an `Idempotency-Key` was reused for a different request. Bodies are JSON.

## Examples

```sh
API="$NUDGE_URL/api/v1"
AUTH="Authorization: Bearer $NUDGE_TOKEN"

# "Remind me to call mom Sunday at 6pm"
curl -s -X POST "$API/reminders" -H "$AUTH" -H "Idempotency-Key: $(uuidgen)" \
  -d '{"text":"call mom sunday 6pm"}' | jq '{understood, title: .reminder.title, due: .reminder.dueAt}'

# A repeat from text, with a heads-up 10 minutes before
curl -s -X POST "$API/reminders" -H "$AUTH" -H "Idempotency-Key: $(uuidgen)" \
  -d '{"text":"take meds every day at 8am and 8pm","alerts":[10]}' | jq '.reminder | {title, due, repeat: .repeat.text}'

# Exact fields instead of text
curl -s -X POST "$API/reminders" -H "$AUTH" -H "Idempotency-Key: $(uuidgen)" \
  -d '{"title":"Dentist","start":"2026-11-05T15:00","notes":"Bring the insurance card"}' | jq '.reminder | {id, due}'

# What's late, what's left today, and what's next
curl -s "$API/today" -H "$AUTH" | jq '{now, late: [.late[].title], today: [.today[] | {title, due}], next: .next | {title, due}}'

# Find one by title (also how to check for a duplicate before adding)
curl -s "$API/reminders?q=mom" -H "$AUTH" | jq '.reminders[] | {id, title, due, repeat: .repeat.text}'

# Snooze for an hour
curl -s -X POST "$API/reminders/$ID/snooze" -H "$AUTH" -H "Idempotency-Key: $(uuidgen)" \
  -d '{"until":"1h"}' | jq '{title, snoozedUntil}'

# Done (a repeat moves on to its next occurrence)
curl -s -X POST "$API/reminders/$ID/complete" -H "$AUTH" -H "Idempotency-Key: $(uuidgen)" | jq '{title, done, due}'

# Pause a repeat until a date (the user is away)
curl -s -X POST "$API/reminders/$ID/pause" -H "$AUTH" -H "Idempotency-Key: $(uuidgen)" \
  -d '{"until":"2026-12-01T00:00"}' | jq '{title, paused}'

# Edit: read the rev, then send only what changes with it
REV=$(curl -s "$API/reminders/$ID" -H "$AUTH" | jq .rev)
curl -s -X PATCH "$API/reminders/$ID" -H "$AUTH" -H "Idempotency-Key: $(uuidgen)" \
  -d "{\"rev\":$REV,\"start\":\"2026-11-01T19:00\"}" | jq '{title, due, rev}'

# Delete, and undo it
curl -s -X DELETE "$API/reminders/$ID" -H "$AUTH" -H "Idempotency-Key: $(uuidgen)" | jq '{title, deleted}'
curl -s -X POST "$API/reminders/$ID/restore" -H "$AUTH" -H "Idempotency-Key: $(uuidgen)" | jq '{title, deleted}'
```

## Text the parser understands

Write it the way the user would say it: the title is whatever is left once the time and repeat are read.

- Dates: `today`, `tomorrow`, `sunday`, `next friday`, `this weekend`, `next week`, `nov 12`, `on the 14th`, `2026-12-01`, `in 2 days`.
- Times: `6pm`, `6:30pm`, `18:30`, `at 9`, `noon`, `midnight`, `morning`, `tonight`, `in 20m`, `in half an hour`.
- Repeats: `every day`, `weekdays`, `every mon wed fri 7am`, `every other tue`, `every 1st`, `on the 1st and 15th`, `last fri of the month`, `every 2 months on the 5th`, `every quarter`, `every 8 hours`, `twice daily`, `at 8am and 8pm every day`, `every 3 days after done`. Endings: `for 5 days`, `10 times`, `until dec 20`.
- `!` anywhere marks it important.

With no time, a dated reminder is at 9am and one with no date at all comes up in about an hour. `understood` in the response shows which words became the time (`when`) and the repeat, and `timed: false` means no time was given, so say what time it took.

## Guidelines

- Prefer creating from `text`: it is what the app does with what the user types, and `understood` lets you confirm. Use explicit fields only when you already have an exact time, or to set `notes` and `alerts`.
- After creating, tell the user what Nudge understood, in their words: the title, when it is due (from `due`, in their time), and `repeat.text` if any. If `understood.when` is `null` or `timed` is `false`, mention the default it took, and offer to change it.
- Before adding, search with `?q=` for a similar title. If one exists, ask whether to change it instead of adding a second.
- If the user is vague about when ("remind me about the car"), ask, unless they are fine with the default.
- Act on the reminder they mean: if a search finds several, ask which one. Pass `due` when completing or skipping a repeat, so you never act on an occurrence they didn't mean.
- Send an `Idempotency-Key` on every write, and reuse it only to retry that same change: after a timeout, or after a `4xx` you fixed.
- On `409`, re-read, re-apply your change to `current` if it still makes sense, and retry once with the new `rev`.
- After any write, say what changed: done, snoozed until when, paused until when, or the new time. If you made a mistake, undo it: `reopen` a completed one-off, `restore` a delete, `resume` a pause. Completing a repeat can't be undone here; tell the user, who can undo it in the app.
- Don't set `important` or `alerts` unless the user asks for nagging or a heads-up.
