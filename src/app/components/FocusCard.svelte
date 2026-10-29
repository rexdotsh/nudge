<script lang="ts">
  import { snooze, snoozeOptions } from '../lib/actions';
  import { timeLabel, untilLabel, whenLabel } from '../lib/format';
  import { quietSummary, type Triage } from '../lib/sections';
  import { completeFrom } from '../lib/selection';
  import { ui } from '../lib/ui.svelte';
  import CheckCircle from './CheckCircle.svelte';

  let { triage, now, zone }: { triage: Triage; now: number; zone: string } = $props();

  const focus = $derived(triage.focus);
  const options = $derived(focus ? snoozeOptions(focus.reminder, now, zone) : []);
  const hour = $derived(options.find((option) => option.key === 'hour'));
  const tonight = $derived(options.find((option) => option.key === 'evening' || option.key === 'morning'));
  const summary = $derived(quietSummary(triage, now, zone));
</script>

{#if focus}
  <section class="surface card" aria-label="Now" data-reminder={focus.reminder.id} data-glide="now:{focus.reminder.id}">
    <p class="when">
      <span class="chip hot">{focus.late ? 'late' : untilLabel(focus.at, now)}</span>
      {focus.late ? whenLabel(focus.at, now, zone) : timeLabel(focus.at, zone)}
    </p>
    <button class="heading title open" onclick={() => ui.edit(focus.reminder.id)}>{focus.reminder.title}</button>
    <div class="acts">
      <button class="btn primary" onclick={(event) => void completeFrom(event, focus.reminder)}>Done</button>
      {#if hour}<button class="btn" onclick={() => void snooze(focus.reminder, hour.at)}>+1 hour</button>{/if}
      {#if tonight}
        <button class="btn" onclick={() => void snooze(focus.reminder, tonight.at)}>
          {tonight.key === 'evening' ? 'Tonight' : 'Tomorrow'}
        </button>
      {/if}
      <button class="btn more" onclick={() => ui.open('snooze', focus.reminder.id)} aria-label="More snooze options"
        >···</button
      >
    </div>
    {#each triage.late as entry (entry.reminder.id)}
      <div class="also" data-reminder={entry.reminder.id} data-glide="late:{entry.reminder.id}">
        <CheckCircle
          late
          small
          label={`Complete ${entry.reminder.title}`}
          onToggle={(event) => void completeFrom(event, entry.reminder)}
        />
        <button class="name open" onclick={() => ui.edit(entry.reminder.id)}>{entry.reminder.title}</button>
        <span class="chip hot">late</span>
      </div>
    {/each}
  </section>
{:else}
  <section class="surface card quiet" aria-label="Now" data-glide="now">
    <p class="heading"><b>{summary.lead}</b> {summary.rest}</p>
  </section>
{/if}

<style>
  .card {
    padding: 16px;
    border-radius: 20px;
  }

  .when {
    margin: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--muted);
    font-size: 13px;
    font-variant-numeric: tabular-nums;
  }

  .title {
    display: block;
    margin: 8px 0 14px;
    text-align: left;
    overflow-wrap: anywhere;
  }

  .acts {
    display: flex;
    gap: 6px;
  }

  .acts .btn {
    flex: 1;
    padding: 0;
  }

  .acts .more {
    flex: 0 0 44px;
  }

  @media (pointer: fine) {
    .acts .btn {
      flex: none;
      padding: 0 14px;
    }

    .acts .more {
      flex: none;
      width: 40px;
    }
  }

  .also {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 12px;
    padding-top: 11px;
    border-top: 1px solid var(--edge);
  }

  .name {
    flex: 1;
    min-width: 0;
    color: var(--ink-2);
    font-size: 14.5px;
    text-align: left;
  }

  .quiet p {
    color: var(--muted);
  }

  .quiet b {
    color: var(--ink);
    font-weight: 600;
  }
</style>
