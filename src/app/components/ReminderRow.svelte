<script lang="ts">
  import { complete, remove, snooze, snoozeOptions } from '../lib/actions';
  import { repeatLabel, whenLabel } from '../lib/format';
  import type { Entry } from '../lib/sections';
  import { swipe } from '../lib/swipe';
  import CheckCircle from './CheckCircle.svelte';
  import Icon from './Icon.svelte';

  let { entry, now, zone }: { entry: Entry; now: number; zone: string } = $props();

  const reminder = $derived(entry.reminder);
  const snoozed = $derived(reminder.snoozedUntil !== null && reminder.snoozedUntil > now);
  const cadence = $derived(repeatLabel(reminder, zone));
  const note = $derived(reminder.notes.split('\n', 1)[0] ?? '');
  const later = $derived(snoozeOptions(now, zone).find((option) => option.label === '1 hour'));

  let offset = $state(0);

  function snoozeHour() {
    if (later) void snooze(reminder, later.at, later.label);
  }
</script>

<div class="row" class:overdue={entry.overdue}>
  <div class="reveal leading" style:opacity={Math.min(Math.max(offset, 0) / 80, 1)}>
    <Icon name="check" size={22} />
  </div>
  <div class="reveal trailing" style:opacity={Math.min(Math.max(-offset, 0) / 80, 1)}>
    <Icon name="clock" size={22} />
  </div>
  <div
    class="content"
    class:dragging={offset !== 0}
    style:transform="translateX({offset}px)"
    use:swipe={{
      onLeading: () => void complete(reminder),
      onTrailing: snoozeHour,
      onOffset: (value) => (offset = value),
    }}
  >
    <CheckCircle
      overdue={entry.overdue}
      label={`Complete ${reminder.title}`}
      onToggle={() => void complete(reminder)}
    />
    <div class="text">
      <span class="title">{reminder.title}</span>
      <span class="meta">
        <span class="when">{snoozed ? 'Snoozed · ' : ''}{whenLabel(entry.at, now, zone)}</span>
        {#if cadence}<span class="cadence"><Icon name="repeat" size={13} />{cadence}</span>{/if}
        {#if reminder.missed > 0}<span>missed {reminder.missed}×</span>{/if}
        {#if note}<span class="note">{note}</span>{/if}
      </span>
    </div>
    {#if reminder.important}
      <span class="flag" aria-label="Important"><Icon name="star" size={16} filled /></span>
    {/if}
    <div class="hover">
      <button onclick={snoozeHour} aria-label="Snooze for an hour" title="Snooze 1 hour"
        ><Icon name="clock" size={16} /></button
      >
      <button onclick={() => void remove(reminder)} aria-label="Delete" title="Delete"
        ><Icon name="trash" size={16} /></button
      >
    </div>
  </div>
</div>

<style>
  .row {
    position: relative;
    overflow: hidden;
    background: var(--surface);
  }

  .reveal {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    padding: 0 26px;
    color: #fff;
  }

  .leading {
    background: var(--success);
  }

  .trailing {
    background: var(--snooze);
    justify-content: flex-end;
  }

  .content {
    position: relative;
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: var(--row-pad);
    background: var(--surface);
    transition: transform 0.35s var(--spring);
    touch-action: pan-y;
  }

  .dragging {
    transition: none;
  }

  .text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding-bottom: 11px;
    margin-bottom: -11px;
    border-bottom: 0.5px solid var(--separator);
  }

  .row:last-child .text {
    border-bottom: 0;
  }

  .title {
    overflow-wrap: anywhere;
  }

  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 10px;
    font-size: 0.82em;
    color: var(--label-2);
  }

  .overdue .when {
    color: var(--danger);
  }

  .cadence {
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }

  .note {
    flex-basis: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .flag {
    color: var(--brand);
    padding-top: 2px;
  }

  .hover {
    display: flex;
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }

  :global([data-platform='windows']) .row {
    border-radius: 6px;
    margin-bottom: 3px;
    box-shadow: 0 0 0 1px var(--separator);
  }

  :global([data-platform='windows']) .text {
    border-bottom: 0;
  }

  :global([data-platform='windows']) .content {
    align-items: center;
  }

  .content:focus-within .hover {
    position: static;
    width: auto;
    height: auto;
    overflow: visible;
    clip-path: none;
  }

  @media (hover: hover) {
    .hover {
      position: static;
      width: auto;
      height: auto;
      overflow: visible;
      clip-path: none;
      gap: 2px;
      opacity: 0;
      transition: opacity 0.12s;
    }

    .content:hover .hover,
    .content:focus-within .hover {
      opacity: 1;
    }

    .hover button {
      width: 30px;
      height: 30px;
      display: grid;
      place-items: center;
      border-radius: var(--radius-control);
      color: var(--label-2);
    }

    .hover button:hover {
      background: var(--fill);
      color: var(--label);
    }
  }
</style>
