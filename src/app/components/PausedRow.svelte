<script lang="ts">
  import type { Reminder } from '../../shared/reminder';
  import { resume } from '../lib/actions';
  import { dayLabel } from '../lib/format';
  import { PAUSE, tip } from '../lib/shortcuts';
  import { ui } from '../lib/ui.svelte';
  import Icon from './Icon.svelte';

  let { reminder, now, zone }: { reminder: Reminder; now: number; zone: string } = $props();

  const until = $derived(reminder.paused?.until ?? null);
  const selected = $derived(ui.docked && ui.editing === reminder.id);
</script>

<div class="row" class:selected data-reminder={reminder.id} data-glide={reminder.id}>
  <button
    class="resume press"
    onclick={() => void resume(reminder)}
    aria-label={`Resume ${reminder.title}`}
    title={tip('Resume', PAUSE)}><span class="ring"><Icon name="play" size={10} /></span></button
  >
  <button class="open" onclick={() => ui.edit(reminder.id)} aria-current={selected || undefined}>
    <span class="title">{reminder.title}</span>
    {#if until !== null}<span class="until">until {dayLabel(until, now, zone)}</span>{/if}
  </button>
</div>

<style>
  .row {
    position: relative;
    isolation: isolate;
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 44px;
    padding: 0 2px;
    border-bottom: 1px solid var(--line);
  }

  .selected::before {
    content: '';
    position: absolute;
    inset: 2px -10px;
    z-index: -1;
    border-radius: 10px;
    background: var(--raised);
  }

  .resume {
    flex: none;
    width: 24px;
    height: 24px;
    display: grid;
    place-items: center;
    border-radius: 50%;
    color: var(--muted);
  }

  .ring {
    width: 18px;
    height: 18px;
    display: grid;
    place-items: center;
    padding-left: 1px;
    border-radius: 50%;
    box-shadow: inset 0 0 0 1.4px var(--faint);
  }

  .resume:hover {
    color: var(--ink);
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

  .title {
    flex: 1;
    min-width: 0;
    color: var(--muted);
    font-size: 14px;
    overflow-wrap: anywhere;
  }

  .selected .title {
    color: var(--ink);
  }

  .until {
    flex: none;
    color: var(--muted);
    font-size: 13px;
  }

  @media (pointer: fine) {
    .row {
      min-height: 38px;
    }
  }
</style>
