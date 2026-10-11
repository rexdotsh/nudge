<script lang="ts">
  import { complete, snooze, snoozeOptions } from '../lib/actions';
  import { timeLabel, untilLabel, whenLabel } from '../lib/format';
  import { quietSummary, type Triage } from '../lib/sections';
  import { ui } from '../lib/ui.svelte';
  import CheckCircle from './CheckCircle.svelte';

  let { triage, now, zone }: { triage: Triage; now: number; zone: string } = $props();

  const focus = $derived(triage.focus);
  const options = $derived(snoozeOptions(now, zone));
  const hour = $derived(options.find((option) => option.key === 'hour'));
  const tonight = $derived(options.find((option) => option.key === 'evening' || option.key === 'morning'));
  const summary = $derived(quietSummary(triage, now, zone));
</script>

{#if focus}
  <section class="card" aria-label="Now">
    <p class="when">
      <span class="chip hot">{focus.late ? 'late' : untilLabel(focus.at, now)}</span>
      {focus.late ? whenLabel(focus.at, now, zone) : timeLabel(focus.at, zone)}
    </p>
    <button class="title" onclick={() => ui.edit(focus.reminder.id)}>{focus.reminder.title}</button>
    <div class="acts">
      <button class="btn primary" onclick={() => void complete(focus.reminder)}>Done</button>
      {#if hour}<button class="btn" onclick={() => void snooze(focus.reminder, hour.at)}>+1 hour</button>{/if}
      {#if tonight}
        <button class="btn" onclick={() => void snooze(focus.reminder, tonight.at)}>
          {tonight.key === 'evening' ? 'Tonight' : 'Tomorrow'}
        </button>
      {/if}
      <button class="btn more" onclick={() => ui.snooze(focus.reminder.id)} aria-label="More snooze options">···</button
      >
    </div>
    {#each triage.late as entry (entry.reminder.id)}
      <div class="also">
        <CheckCircle
          late
          small
          label={`Complete ${entry.reminder.title}`}
          onToggle={() => void complete(entry.reminder)}
        />
        <button class="name" onclick={() => ui.edit(entry.reminder.id)}>{entry.reminder.title}</button>
        <span class="chip hot">late</span>
      </div>
    {/each}
  </section>
{:else}
  <section class="card quiet" aria-label="Now">
    <p><b>{summary.lead}</b> {summary.rest}</p>
  </section>
{/if}

<style>
  .card {
    padding: 16px;
    border-radius: 20px;
    background: var(--surface);
    box-shadow: inset 0 0 0 1px var(--edge);
    animation: rise 0.4s var(--ease) both;
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
    font-size: 22px;
    font-weight: 600;
    line-height: 1.2;
    letter-spacing: -0.02em;
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
    margin: 0;
    color: var(--muted);
    font-size: 21px;
    font-weight: 600;
    line-height: 1.25;
    letter-spacing: -0.02em;
  }

  .quiet b {
    color: var(--ink);
    font-weight: 600;
  }
</style>
