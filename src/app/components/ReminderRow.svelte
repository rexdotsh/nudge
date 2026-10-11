<script lang="ts">
  import { complete, remove, snooze, snoozeOptions } from '../lib/actions';
  import { repeatLabel, shortWhen } from '../lib/format';
  import type { Entry } from '../lib/sections';
  import { swipe } from '../lib/swipe';
  import { ui } from '../lib/ui.svelte';
  import CheckCircle from './CheckCircle.svelte';
  import Icon from './Icon.svelte';

  let { entry, now, zone, compact = false }: { entry: Entry; now: number; zone: string; compact?: boolean } = $props();

  const reminder = $derived(entry.reminder);
  const snoozed = $derived(reminder.snoozedUntil !== null && reminder.snoozedUntil > now);
  const cadence = $derived(repeatLabel(reminder, zone));
  const note = $derived(reminder.notes.split('\n', 1)[0] ?? '');
  const detail = $derived(
    [snoozed ? 'Snoozed' : null, cadence, reminder.missed > 0 ? `missed ${reminder.missed}×` : null, note || null]
      .filter((part) => part !== null)
      .join(' · '),
  );
  const later = $derived(snoozeOptions(now, zone).find((option) => option.key === 'hour'));

  let offset = $state(0);

  function snoozeHour() {
    if (later) void snooze(reminder, later.at);
  }
</script>

<div class="row" class:compact>
  <div class="reveal leading" style:opacity={Math.min(Math.max(offset, 0) / 80, 1)}>
    <Icon name="check" size={20} />
  </div>
  <div class="reveal trailing" style:opacity={Math.min(Math.max(-offset, 0) / 80, 1)}>
    <Icon name="clock" size={20} />
  </div>
  <div
    class="content"
    data-reminder={reminder.id}
    class:dragging={offset !== 0}
    style:transform="translateX({offset}px)"
    use:swipe={{
      onLeading: () => void complete(reminder),
      onTrailing: snoozeHour,
      onOffset: (value) => (offset = value),
    }}
  >
    <CheckCircle
      late={entry.late}
      small={compact}
      label={`Complete ${reminder.title}`}
      onToggle={() => void complete(reminder)}
    />
    <button class="open" onclick={() => ui.edit(reminder.id)}>
      <span class="text">
        <span class="title"
          >{reminder.title}{#if reminder.important}<span class="flag" aria-label="Important">!</span>{/if}</span
        >
        {#if detail && !compact}<small>{detail}</small>{/if}
      </span>
      {#if entry.late}
        <span class="chip hot">late</span>
      {:else}
        <span class="when">{shortWhen(entry.at, now, zone)}</span>
      {/if}
    </button>
    <span class="actions">
      <button onclick={() => ui.snooze(reminder.id)} aria-label={`Snooze ${reminder.title}`} title="Snooze (S)"
        >Snooze</button
      >
      <button onclick={() => void remove(reminder)} aria-label={`Delete ${reminder.title}`} title="Delete (Del)"
        >Delete</button
      >
    </span>
  </div>
</div>

<style>
  .row {
    position: relative;
    overflow: hidden;
    border-bottom: 1px solid var(--line);
  }

  .reveal {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    padding: 0 20px;
  }

  .leading {
    background: var(--ink);
    color: var(--bg);
  }

  .trailing {
    justify-content: flex-end;
    background: var(--raised);
    color: var(--ink);
  }

  .content {
    position: relative;
    isolation: isolate;
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 52px;
    padding: 10px 2px;
    background: var(--bg);
    touch-action: pan-y;
    transition: transform 0.35s var(--spring);
  }

  .content::before {
    content: '';
    position: absolute;
    inset: 2px -10px;
    z-index: -1;
    border-radius: 10px;
    background: var(--surface);
    opacity: 0;
    transition: opacity 0.15s;
  }

  .content:has(.open:active)::before {
    opacity: 1;
    transition: none;
  }

  .open {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 12px;
    align-self: stretch;
    border-radius: 8px;
    text-align: left;
  }

  .open:focus-visible {
    outline: 2px solid var(--ink-2);
    outline-offset: 4px;
  }

  .dragging {
    transition: none;
  }

  .text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .title {
    font-size: 15px;
    overflow-wrap: anywhere;
  }

  .flag {
    margin-left: 6px;
    color: var(--accent);
    font-weight: 700;
  }

  small {
    overflow: hidden;
    color: var(--muted);
    font-size: 12.5px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .when {
    flex: none;
    color: var(--muted);
    font-size: 13.5px;
    font-variant-numeric: tabular-nums;
  }

  .compact .content {
    min-height: 44px;
    padding: 8px 2px;
  }

  .compact .title {
    color: var(--ink-2);
    font-size: 14px;
  }

  .actions {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    display: flex;
    gap: 4px;
  }

  .content:has(:focus-visible) .actions {
    position: static;
    width: auto;
    height: auto;
    overflow: visible;
    clip-path: none;
  }

  .actions button {
    padding: 4px 9px;
    border-radius: 7px;
    background: var(--raised);
    color: var(--ink-2);
    font-size: 12px;
    font-weight: 500;
  }

  @media (hover: hover) {
    .content:hover::before {
      opacity: 1;
    }

    .actions {
      position: static;
      width: auto;
      height: auto;
      overflow: visible;
      clip-path: none;
      opacity: 0;
      transition: opacity 0.12s;
    }

    .content:hover .actions,
    .content:has(:focus-visible) .actions {
      opacity: 1;
    }

    .actions button:hover {
      color: var(--ink);
    }
  }
</style>
