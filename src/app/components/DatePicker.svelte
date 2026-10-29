<script lang="ts">
  import { epochDay, formatDate, fromEpochDay, toLocal } from '../../shared/time';
  import { app } from '../lib/app.svelte';
  import { calendarLabel } from '../lib/format';
  import { parseDate } from '../lib/pickers';
  import { ui } from '../lib/ui.svelte';
  import Calendar from './Calendar.svelte';
  import Popover from './Popover.svelte';

  let { date = $bindable(), zone }: { date: string; zone: string } = $props();

  const day = $derived(parseDate(date));
  const text = $derived(day === null ? date : calendarLabel(day, 'date'));

  let open = $state(false);
  let chip: HTMLButtonElement | undefined = $state();
</script>

{#if ui.fine}
  <button
    type="button"
    class="picker press"
    aria-label="Date, {text}"
    aria-haspopup="dialog"
    aria-expanded={open}
    bind:this={chip}
    onclick={() => (open = !open)}>{text}</button
  >
  {#each open && chip ? [chip] : [] as anchor (anchor)}
    <Popover {anchor} role="dialog" aria-label="Choose a date" onClose={() => (open = false)}>
      <Calendar
        selected={day}
        today={epochDay(toLocal(app.now, zone))}
        onPick={(picked) => {
          date = formatDate(fromEpochDay(picked));
          open = false;
          anchor.focus();
        }}
      />
    </Popover>
  {/each}
{:else}
  <label class="picker">
    <span>{text}</span>
    <input type="date" bind:value={date} aria-label="Date" required />
  </label>
{/if}
