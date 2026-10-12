<script lang="ts">
  import { isSnoozed } from '../../shared/reminder';
  import { HOUR_MS } from '../../shared/time';
  import { complete, remove, snooze, snoozeFrom } from '../lib/actions';
  import { repeatLabel, shortWhen } from '../lib/format';
  import type { Entry } from '../lib/sections';
  import { completeFrom } from '../lib/selection';
  import { DELETE, SNOOZE, tip } from '../lib/shortcuts';
  import { swipe } from '../lib/swipe';
  import { ui } from '../lib/ui.svelte';
  import CheckCircle from './CheckCircle.svelte';
  import Icon from './Icon.svelte';

  let { entry, now, zone, compact = false }: { entry: Entry; now: number; zone: string; compact?: boolean } = $props();

  const reminder = $derived(entry.reminder);
  const snoozed = $derived(isSnoozed(reminder, now));
  const cadence = $derived(reminder.repeat ? repeatLabel(reminder.repeat, reminder.start, zone) : null);
  const note = $derived(reminder.notes.split('\n', 1)[0] ?? '');
  const detail = $derived(
    [snoozed ? 'Snoozed' : null, cadence, reminder.missed > 0 ? `missed ${reminder.missed}×` : null, note || null]
      .filter((part) => part !== null)
      .join(' · '),
  );

  const selected = $derived(ui.docked && ui.editing === reminder.id);

  let offset = $state(0);

  function snoozeHour() {
    void snooze(reminder, snoozeFrom(reminder, Date.now(), zone) + HOUR_MS);
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
    class:selected
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
      onToggle={(event) => void completeFrom(event, reminder)}
    />
    <button class="open" onclick={() => ui.edit(reminder.id)} aria-current={selected || undefined}>
      <span class="text">
        <span class="title"
          >{reminder.title}{#if reminder.important}<span class="flag" role="img" aria-label="Important">!</span
            >{/if}</span
        >
        {#if detail && !compact}<small>{detail}</small>{/if}
      </span>
      {#if entry.late}
        <span class="chip hot trail">late</span>
      {:else}
        <span class="when trail">{shortWhen(entry.at, now, zone)}</span>
      {/if}
    </button>
    <span class="actions">
      <button
        onclick={() => ui.snooze(reminder.id)}
        aria-label={`Snooze ${reminder.title}`}
        title={tip('Snooze', SNOOZE)}><Icon name="clock" size={16} /></button
      >
      <button
        onclick={() => void remove(reminder)}
        aria-label={`Delete ${reminder.title}`}
        title={tip('Delete', DELETE)}><Icon name="trash" size={16} /></button
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

  .selected::before {
    background: var(--raised);
    opacity: 1;
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
    outline: none;
  }

  .content:has(.open:focus-visible)::before {
    opacity: 1;
    outline: 2px solid var(--ink-2);
    outline-offset: -2px;
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
    display: flex;
    gap: 2px;
  }

  .actions button {
    width: 30px;
    height: 30px;
    display: grid;
    place-items: center;
    border-radius: 8px;
    color: var(--muted);
  }

  /* Touch screens hide the row actions (swipes cover them) but keep them for screen readers and keyboards. */
  @media (hover: none) {
    .content:not(:has(:global(:focus-visible))) .actions {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
    }
  }

  @media (hover: hover) {
    .row {
      overflow: clip;
      overflow-clip-margin: 10px;
    }

    .content:hover::before {
      opacity: 1;
    }

    .actions {
      position: absolute;
      right: 0;
      opacity: 0;
      transition: opacity 0.12s;
    }

    .trail {
      transition: opacity 0.12s;
    }

    .content:is(:hover, :has(.actions :global(:focus-visible))) .actions {
      opacity: 1;
    }

    .content:is(:hover, :has(.actions :global(:focus-visible))) .trail {
      opacity: 0;
    }

    .actions button:hover {
      background: var(--raised);
      color: var(--ink);
    }
  }

  @media (pointer: fine) {
    .content {
      min-height: 44px;
      padding: 7px 2px;
    }

    .compact .content {
      min-height: 38px;
      padding: 5px 2px;
    }
  }
</style>
