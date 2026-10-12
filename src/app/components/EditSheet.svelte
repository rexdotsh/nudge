<script lang="ts">
  import { untrack } from 'svelte';
  import { prefersReducedMotion } from 'svelte/motion';
  import { fly } from 'svelte/transition';
  import { LIMITS, parseFields } from '../../shared/input';
  import { fieldsOf, type Reminder, type ReminderFields } from '../../shared/reminder';
  import { parseLocal, toInstant } from '../../shared/time';
  import { complete, remove } from '../lib/actions';
  import { app } from '../lib/app.svelte';
  import { dateLabel, timeLabel, zoneLabel } from '../lib/format';
  import { tick } from '../lib/haptics';
  import { RepeatChoice } from '../lib/repeat-choice.svelte';
  import { closeEditor } from '../lib/selection';
  import { tip } from '../lib/shortcuts';
  import { toasts } from '../lib/toasts.svelte';
  import { ui } from '../lib/ui.svelte';
  import Icon from './Icon.svelte';
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

  const changed = $derived(parsed !== null && JSON.stringify(parsed) !== JSON.stringify(fieldsOf(original)));

  async function persist(): Promise<void> {
    if (parsed && changed) await app.apply({ type: 'put', id: original.id, fields: parsed });
  }

  async function save() {
    if (!parsed) return;
    await persist();
    if (changed) toasts.show('Saved');
    closeEditor();
  }

  function saveShortcut(event: KeyboardEvent) {
    if (!(event.ctrlKey || event.metaKey) || event.key !== 'Enter') return;
    if (!(event.target instanceof Element && event.target.closest('#editor'))) return;
    event.preventDefault();
    void save();
  }

  function keepEdits() {
    if (!changed) return;
    void persist();
    toasts.show('Saved');
  }

  $effect(() => {
    ui.keepEdits = keepEdits;
    return () => {
      if (ui.keepEdits === keepEdits) ui.keepEdits = null;
    };
  });

  async function act(action: (current: Reminder) => Promise<void> | void) {
    await persist();
    const current = app.reminders.find((candidate) => candidate.id === original.id);
    if (current) await action(current);
  }

  async function skip(current: Reminder) {
    if (current.due === null) return;
    tick();
    await app.apply({ type: 'skip', id: current.id, due: current.due });
    toasts.show('Skipped to the next one');
    closeEditor();
  }
</script>

<svelte:window onkeydown={saveShortcut} />

{#snippet form()}
  <nav>
    <button class="link quiet" onclick={closeEditor} title={tip('Cancel', 'Escape')}>Cancel</button>
    <button class="link" onclick={save} disabled={parsed === null} title={tip('Save', 'mod+Enter')}>Save</button>
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
      <span id="alerts-label">Also remind me before</span>
      <div class="alerts" role="group" aria-labelledby="alerts-label">
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

  <div class="acts">
    {#if reminder.due !== null}
      <button class="btn" disabled={!parsed} onclick={() => act((current) => complete(current).then(closeEditor))}
        ><Icon name="check" size={16} />Done</button
      >
      <button class="btn" disabled={!parsed} onclick={() => act((current) => ui.snooze(current.id))}
        ><Icon name="clock" size={16} />Snooze</button
      >
      {#if reminder.repeat}
        <button class="btn" disabled={!parsed} onclick={() => act(skip)}><Icon name="skip" size={16} />Skip</button>
      {/if}
    {/if}
    <button class="link delete" onclick={() => void remove(reminder).then(closeEditor)}>Delete</button>
  </div>
{/snippet}

{#if ui.docked}
  <section
    id="editor"
    class="docked"
    tabindex="-1"
    aria-label="Edit {original.title}"
    in:fly={{ x: prefersReducedMotion.current ? 0 : 12, duration: 180 }}
  >
    {@render form()}
  </section>
{:else}
  <Sheet label="Edit {original.title}" onClose={closeEditor}>
    <div id="editor">{@render form()}</div>
  </Sheet>
{/if}

<style>
  .docked {
    padding: 28px 24px 24px;
    outline: none;
  }

  .docked nav {
    min-height: 40px;
    align-items: center;
    padding: 0 0 8px;
  }

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

  .alerts {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 2px;
    padding: 2px;
    border-radius: 10px;
    background: var(--bg);
    box-shadow: inset 0 0 0 1px var(--edge);
  }

  .alerts button {
    height: 32px;
    border-radius: 8px;
    color: var(--ink-2);
    font-size: 13.5px;
    font-weight: 500;
  }

  .alerts button[aria-pressed='true'] {
    background: var(--ink);
    color: var(--bg);
    font-weight: 600;
  }

  .zone {
    display: block;
    margin: 10px auto 0;
    padding: 6px 10px;
    font-size: 13px;
  }

  .acts {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 16px;
  }

  .acts .btn {
    flex: 1;
    padding: 0 12px;
  }

  .delete {
    flex-basis: 100%;
    padding: 12px;
    font-size: 14px;
  }

  @media (min-width: 720px) {
    .acts .btn {
      flex: none;
    }

    .delete {
      flex-basis: auto;
      margin-left: auto;
      padding: 0 4px;
    }
  }
</style>
