<script lang="ts">
  import { untrack } from 'svelte';
  import { LIMITS, parseFields } from '../../shared/input';
  import { fieldsOf, type Reminder, type ReminderFields } from '../../shared/reminder';
  import { parseLocal, toInstant } from '../../shared/time';
  import { complete, remove } from '../lib/actions';
  import { app } from '../lib/app.svelte';
  import { dateLabel, timeLabel, zoneLabel } from '../lib/format';
  import { tick } from '../lib/haptics';
  import { RepeatChoice } from '../lib/repeat-choice.svelte';
  import { toasts } from '../lib/toasts.svelte';
  import { ui } from '../lib/ui.svelte';
  import RepeatPicker from './RepeatPicker.svelte';
  import Sheet from './Sheet.svelte';

  let { reminder }: { reminder: Reminder } = $props();

  const ALERTS = [
    { minutes: 5, label: '5 min' },
    { minutes: 15, label: '15 min' },
    { minutes: 60, label: '1 hour' },
    { minutes: 1440, label: '1 day' },
  ];

  const original = untrack(() => $state.snapshot(reminder));
  const repeat = new RepeatChoice(original.repeat);

  let title = $state(original.title);
  let notes = $state(original.notes);
  let date = $state(original.start.slice(0, 10));
  let time = $state(original.start.slice(11, 16));
  let important = $state(original.important);
  let alerts = $state([...original.alerts]);
  let pinned = $state(original.zone !== null);
  let showZone = $state(original.zone !== null || app.travelling);

  const fields = $derived<ReminderFields>({
    title: title.trim(),
    notes,
    start: `${date}T${time}`,
    zone: pinned ? (original.zone ?? app.zone) : null,
    repeat: repeat.repeat,
    important,
    alerts: alerts.toSorted((a, b) => a - b),
  });
  const parsed = $derived(repeat.understood ? parseFields(fields) : null);
  const zone = $derived(fields.zone ?? app.zone);
  const startAt = $derived.by(() => {
    const start = parseLocal(fields.start);
    return start ? toInstant(start, zone) : null;
  });

  function toggleAlert(minutes: number) {
    alerts = alerts.includes(minutes) ? alerts.filter((value) => value !== minutes) : [...alerts, minutes];
  }

  async function save() {
    if (!parsed) return;
    if (JSON.stringify(parsed) !== JSON.stringify(fieldsOf(original))) {
      await app.apply({ type: 'put', id: original.id, fields: parsed });
      toasts.show('Saved');
    }
    ui.close();
  }

  async function skip() {
    if (reminder.due === null) return;
    tick();
    await app.apply({ type: 'skip', id: reminder.id, due: reminder.due });
    toasts.show('Skipped to the next one');
    ui.close();
  }
</script>

<Sheet label="Edit {original.title}" onClose={() => ui.close()}>
  <nav>
    <button class="link quiet" onclick={() => ui.close()}>Cancel</button>
    <button class="link" onclick={save} disabled={parsed === null}>Save</button>
  </nav>

  <input class="bare heading" bind:value={title} maxlength={LIMITS.title} aria-label="Title" placeholder="Title" />
  <textarea
    class="bare"
    bind:value={notes}
    maxlength={LIMITS.notes}
    aria-label="Notes"
    placeholder="Add a note"
    rows="1"></textarea>

  <div class="group">
    <div class="field">
      <span>When</span>
      <span class="when">
        <label class="picker">
          <span>{startAt === null ? date : dateLabel(startAt, zone)}</span>
          <input type="date" bind:value={date} aria-label="Date" required />
        </label>
        <label class="picker">
          <span>{startAt === null ? time : timeLabel(startAt, zone)}</span>
          <input type="time" bind:value={time} aria-label="Time" required />
        </label>
      </span>
    </div>
    <RepeatPicker choice={repeat} start={fields.start} />
    <div class="field stacked">
      <span>Also remind me</span>
      <div class="chips">
        {#each ALERTS as alert (alert.minutes)}
          <button class="chip" aria-pressed={alerts.includes(alert.minutes)} onclick={() => toggleAlert(alert.minutes)}>
            {alert.label}
          </button>
        {/each}
      </div>
    </div>
  </div>

  <div class="group">
    <label class="field">
      <span>Important</span>
      <input class="toggle" type="checkbox" bind:checked={important} />
    </label>
    {#if showZone}
      <label class="field">
        <span
          >Keep this time zone<small
            >{pinned ? `Always ${zoneLabel(zone, app.now)}` : 'Follows you when you travel'}</small
          ></span
        >
        <input class="toggle" type="checkbox" bind:checked={pinned} />
      </label>
    {/if}
  </div>
  {#if !showZone}
    <button class="link quiet zone" onclick={() => (showZone = true)}>Time zone · follows you</button>
  {/if}

  {#if reminder.due !== null}
    <div class="acts">
      <button class="btn primary" onclick={() => void complete(reminder).then(() => ui.close())}>Done</button>
      <button class="btn" onclick={() => ui.snooze(reminder.id)}>Snooze</button>
      {#if reminder.repeat}<button class="btn" onclick={skip}>Skip</button>{/if}
    </div>
  {/if}
  <button class="link delete" onclick={() => void remove(reminder).then(() => ui.close())}>Delete</button>
</Sheet>

<style>
  nav {
    display: flex;
    justify-content: space-between;
    padding: 2px 0 10px;
  }

  textarea {
    margin: 4px 0 16px;
    color: var(--ink-2);
    resize: none;
    field-sizing: content;
  }

  .group + .group {
    margin-top: 12px;
  }

  .when {
    display: flex;
    gap: 6px;
    color: var(--ink-2);
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .zone {
    display: block;
    margin: 10px auto 0;
    padding: 6px 10px;
    font-size: 13px;
  }

  .acts {
    display: flex;
    gap: 6px;
    margin-top: 16px;
  }

  .acts .btn {
    flex: 1;
  }

  .delete {
    display: block;
    width: 100%;
    margin-top: 6px;
    padding: 12px;
    font-size: 14px;
  }
</style>
