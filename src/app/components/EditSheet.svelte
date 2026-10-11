<script lang="ts">
  import { untrack } from 'svelte';
  import { describeRepeat } from '../../shared/describe';
  import { parseFields } from '../../shared/input';
  import { parseQuickAdd } from '../../shared/quick-add';
  import { local, type Reminder, type ReminderFields, type Repeat } from '../../shared/reminder';
  import { toInstant } from '../../shared/time';
  import { complete, remove } from '../lib/actions';
  import { app } from '../lib/app.svelte';
  import { dateLabel, timeLabel } from '../lib/format';
  import { tick } from '../lib/haptics';
  import { toasts } from '../lib/toasts.svelte';
  import { ui } from '../lib/ui.svelte';
  import Sheet from './Sheet.svelte';

  let { reminder }: { reminder: Reminder } = $props();

  const PRESETS: { key: string; label: string; rule: string | null }[] = [
    { key: 'none', label: 'Never', rule: null },
    { key: 'daily', label: 'Every day', rule: 'FREQ=DAILY' },
    { key: 'weekdays', label: 'Weekdays', rule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' },
    { key: 'weekly', label: 'Every week', rule: 'FREQ=WEEKLY' },
    { key: 'biweekly', label: 'Every 2 weeks', rule: 'FREQ=WEEKLY;INTERVAL=2' },
    { key: 'monthly', label: 'Every month', rule: 'FREQ=MONTHLY' },
    { key: 'yearly', label: 'Every year', rule: 'FREQ=YEARLY' },
  ];
  const ALERTS = [
    { minutes: 5, label: '5 min' },
    { minutes: 15, label: '15 min' },
    { minutes: 60, label: '1 hour' },
    { minutes: 1440, label: '1 day' },
  ];

  const original = untrack(() => $state.snapshot(reminder));
  const presetOf = (repeat: Repeat | null) =>
    repeat === null
      ? 'none'
      : (PRESETS.find((preset) => repeat.anchor === 'schedule' && preset.rule === repeat.rule)?.key ?? 'custom');

  let title = $state(original.title);
  let notes = $state(original.notes);
  let date = $state(original.start.slice(0, 10));
  let time = $state(original.start.slice(11, 16));
  let choice = $state(presetOf(original.repeat));
  let phrase = $state('');
  let typing = $state(false);
  let important = $state(original.important);
  let alerts = $state([...original.alerts]);
  let pinned = $state(original.zone !== null);
  let showZone = $state(original.zone !== null || app.travelling);

  const customRepeat = $derived(
    phrase.trim() === '' ? original.repeat : parseQuickAdd(`x ${phrase}`, app.now, app.zone).repeat,
  );
  const repeat = $derived<Repeat | null>(
    choice === 'custom'
      ? customRepeat
      : choice === 'none'
        ? null
        : { rule: PRESETS.find((preset) => preset.key === choice)?.rule ?? 'FREQ=DAILY', anchor: 'schedule' },
  );
  const fields = $derived<ReminderFields>({
    title: title.trim(),
    notes,
    start: `${date}T${time}`,
    zone: pinned ? (original.zone ?? app.zone) : null,
    repeat,
    important,
    alerts: alerts.toSorted((a, b) => a - b),
  });
  const valid = $derived(parseFields(fields) !== null);
  const cadence = $derived(
    repeat && valid
      ? describeRepeat(repeat, local(fields.start), { locale: navigator.language, zone: app.zone, time: false })
      : null,
  );
  const startAt = $derived(valid ? toInstant(local(fields.start), fields.zone ?? app.zone) : null);
  const zoneName = $derived(
    new Intl.DateTimeFormat(navigator.language, { timeZone: fields.zone ?? app.zone, timeZoneName: 'long' })
      .formatToParts(app.now)
      .find((part) => part.type === 'timeZoneName')?.value ?? app.zone,
  );

  function pickRepeat(value: string) {
    typing = value === 'type';
    choice = typing ? 'custom' : value;
  }

  function toggleAlert(minutes: number) {
    alerts = alerts.includes(minutes) ? alerts.filter((value) => value !== minutes) : [...alerts, minutes];
  }

  async function save() {
    const parsed = parseFields(fields);
    if (!parsed) return;
    const before: ReminderFields = {
      title: original.title,
      notes: original.notes,
      start: original.start,
      zone: original.zone,
      repeat: original.repeat,
      important: original.important,
      alerts: original.alerts,
    };
    if (JSON.stringify(parsed) !== JSON.stringify(before)) {
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
    <button onclick={() => ui.close()}>Cancel</button>
    <button class="save" onclick={save} disabled={!valid}>Save</button>
  </nav>

  <input class="title" bind:value={title} aria-label="Title" placeholder="Title" />
  <textarea bind:value={notes} aria-label="Notes" placeholder="Add a note" rows="1"></textarea>

  <div class="group">
    <div class="field">
      <span>When</span>
      <span class="when">
        <label class="picker">
          <span>{startAt === null ? date : dateLabel(startAt, fields.zone ?? app.zone)}</span>
          <input type="date" bind:value={date} aria-label="Date" required />
        </label>
        <label class="picker">
          <span>{startAt === null ? time : timeLabel(startAt, fields.zone ?? app.zone)}</span>
          <input type="time" bind:value={time} aria-label="Time" required />
        </label>
      </span>
    </div>
    <label class="field">
      <span>Repeat</span>
      <select value={typing ? 'type' : choice} onchange={(event) => pickRepeat(event.currentTarget.value)}>
        {#each PRESETS as preset (preset.key)}<option value={preset.key}>{preset.label}</option>{/each}
        {#if choice === 'custom' && cadence}<option value="custom">{cadence}</option>{/if}
        <option value="type">Type a repeat…</option>
      </select>
    </label>
    {#if typing}
      <div class="field stacked">
        <input
          class="phrase"
          {@attach (node) => node.focus()}
          bind:value={phrase}
          placeholder="every other tue, 3 days after done…"
          aria-label="Repeat in words"
        />
        {#if phrase.trim() !== '' && !customRepeat}<small>Try “every other tue” or “on the 1st and 15th”.</small>{/if}
      </div>
    {/if}
    <div class="field stacked">
      <span>Also remind me</span>
      <div class="chips">
        {#each ALERTS as alert (alert.minutes)}
          <button aria-pressed={alerts.includes(alert.minutes)} onclick={() => toggleAlert(alert.minutes)}>
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
        <span>Keep this time zone<small>{pinned ? `Always ${zoneName}` : 'Follows you when you travel'}</small></span>
        <input class="toggle" type="checkbox" bind:checked={pinned} />
      </label>
    {/if}
  </div>
  {#if !showZone}
    <button class="zone" onclick={() => (showZone = true)}>Time zone · follows you</button>
  {/if}

  {#if reminder.due !== null}
    <div class="acts">
      <button class="btn primary" onclick={() => void complete(reminder).then(() => ui.close())}>Done</button>
      <button class="btn" onclick={() => ui.snooze(reminder.id)}>Snooze</button>
      {#if reminder.repeat}<button class="btn" onclick={skip}>Skip</button>{/if}
    </div>
  {/if}
  <button class="delete" onclick={() => void remove(reminder).then(() => ui.close())}>Delete</button>
</Sheet>

<style>
  nav {
    display: flex;
    justify-content: space-between;
    padding: 2px 0 10px;
    color: var(--muted);
    font-size: 15px;
  }

  .save {
    color: var(--accent);
    font-weight: 600;
  }

  .save:disabled {
    opacity: 0.4;
  }

  .title {
    width: 100%;
    padding: 0;
    border: 0;
    outline: 0;
    background: transparent;
    font-size: 22px;
    font-weight: 600;
    letter-spacing: -0.02em;
  }

  textarea {
    width: 100%;
    margin: 4px 0 16px;
    padding: 0;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--ink-2);
    font-size: 15px;
    resize: none;
    field-sizing: content;
  }

  .title::placeholder,
  textarea::placeholder {
    color: var(--muted);
  }

  .group + .group {
    margin-top: 12px;
  }

  .when {
    display: flex;
    gap: 6px;
    color: var(--ink-2);
  }

  select {
    appearance: none;
    min-width: 0;
    max-width: 60%;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--ink-2);
    font-size: 15px;
    text-align: right;
    outline: none;
    text-overflow: ellipsis;
    cursor: pointer;
  }

  select:focus-visible {
    border-radius: 4px;
    outline: 2px solid var(--faint);
    outline-offset: 3px;
  }

  .stacked {
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
  }

  .phrase {
    width: 100%;
    padding: 0;
    border: 0;
    outline: 0;
    background: transparent;
    font-size: 15px;
  }

  .phrase::placeholder {
    color: var(--muted);
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .chips button {
    height: 32px;
    padding: 0 12px;
    border-radius: 999px;
    box-shadow: inset 0 0 0 1px var(--edge);
    color: var(--ink-2);
    font-size: 13px;
    font-weight: 500;
  }

  .chips button[aria-pressed='true'] {
    background: var(--ink);
    color: var(--bg);
    box-shadow: none;
  }

  .zone {
    display: block;
    margin: 10px auto 0;
    padding: 6px 10px;
    color: var(--muted);
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
    color: var(--accent);
    font-size: 14px;
    font-weight: 500;
  }
</style>
