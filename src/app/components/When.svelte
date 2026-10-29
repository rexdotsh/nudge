<script lang="ts">
  import { clockLabel } from '../lib/format';
  import { parseTime } from '../lib/pickers';
  import { ui } from '../lib/ui.svelte';
  import DatePicker from './DatePicker.svelte';
  import Popover from './Popover.svelte';
  import TimeList from './TimeList.svelte';

  let { date = $bindable(), time = $bindable(), zone }: { date: string; time: string; zone: string } = $props();

  const clock = $derived(parseTime(time));
  const timeText = $derived(clock === null ? time : clockLabel(clock));

  let open = $state(false);
  let timeChip: HTMLButtonElement | undefined = $state();
</script>

<span class="when">
  <DatePicker bind:date {zone} />
  {#if ui.fine}
    <button
      type="button"
      class="picker press"
      aria-label="Time, {timeText}"
      aria-haspopup="dialog"
      aria-expanded={open}
      bind:this={timeChip}
      onclick={() => (open = !open)}>{timeText}</button
    >
    {#each open && timeChip ? [timeChip] : [] as anchor (anchor)}
      <Popover {anchor} role="dialog" aria-label="Choose a time" onClose={() => (open = false)}>
        <TimeList
          value={time}
          onPick={(picked) => {
            time = picked;
            open = false;
            anchor.focus();
          }}
        />
      </Popover>
    {/each}
  {:else}
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
</style>
