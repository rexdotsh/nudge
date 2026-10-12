<script lang="ts">
  import { epochDay, formatDate, fromEpochDay, toLocal } from '../../shared/time';
  import { app } from '../lib/app.svelte';
  import { calendarLabel, clockLabel } from '../lib/format';
  import { parseDate, parseTime } from '../lib/pickers';
  import { ui } from '../lib/ui.svelte';
  import Calendar from './Calendar.svelte';
  import Popover from './Popover.svelte';
  import TimeList from './TimeList.svelte';

  let { date = $bindable(), time = $bindable(), zone }: { date: string; time: string; zone: string } = $props();

  const day = $derived(parseDate(date));
  const clock = $derived(parseTime(time));
  const dateText = $derived(day === null ? date : calendarLabel(day, 'date'));
  const timeText = $derived(clock === null ? time : clockLabel(clock));

  let open = $state<'date' | 'time' | null>(null);
  let dateChip: HTMLButtonElement | undefined = $state();
  let timeChip: HTMLButtonElement | undefined = $state();

  function close(chip: HTMLElement | undefined) {
    open = null;
    chip?.focus();
  }
</script>

<span class="when">
  {#if ui.fine}
    <button
      type="button"
      class="picker press"
      aria-label="Date, {dateText}"
      aria-haspopup="dialog"
      aria-expanded={open === 'date'}
      bind:this={dateChip}
      onclick={() => (open = open === 'date' ? null : 'date')}>{dateText}</button
    >
    <button
      type="button"
      class="picker press"
      aria-label="Time, {timeText}"
      aria-haspopup="dialog"
      aria-expanded={open === 'time'}
      bind:this={timeChip}
      onclick={() => (open = open === 'time' ? null : 'time')}>{timeText}</button
    >
    {#if open === 'date' && dateChip}
      <Popover anchor={dateChip} role="dialog" aria-label="Choose a date" onClose={() => (open = null)}>
        <Calendar
          selected={day}
          today={epochDay(toLocal(app.now, zone))}
          onPick={(picked) => {
            date = formatDate(fromEpochDay(picked));
            close(dateChip);
          }}
        />
      </Popover>
    {:else if open === 'time' && timeChip}
      <Popover anchor={timeChip} role="dialog" aria-label="Choose a time" onClose={() => (open = null)}>
        <TimeList
          value={time}
          onPick={(picked) => {
            time = picked;
            close(timeChip);
          }}
        />
      </Popover>
    {/if}
  {:else}
    <label class="picker">
      <span>{dateText}</span>
      <input type="date" bind:value={date} aria-label="Date" required />
    </label>
    <label class="picker">
      <span>{timeText}</span>
      <input type="time" bind:value={time} aria-label="Time" required />
    </label>
  {/if}
</span>

<style>
  .when {
    display: flex;
    gap: 6px;
    color: var(--ink-2);
  }

  button.picker:hover,
  .picker[aria-expanded='true'] {
    color: var(--ink);
  }
</style>
