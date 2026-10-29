<script lang="ts">
  import type { Reminder } from '../../shared/reminder';
  import { epochDay, formatDate, fromEpochDay, toInstant, toLocal } from '../../shared/time';
  import { pause } from '../lib/actions';
  import { app } from '../lib/app.svelte';
  import { parseDate } from '../lib/pickers';
  import { ui } from '../lib/ui.svelte';
  import DatePicker from './DatePicker.svelte';
  import TimeSheet from './TimeSheet.svelte';

  let { reminder }: { reminder: Reminder } = $props();

  const today = $derived(epochDay(toLocal(app.now, app.zone)));
  let date = $state(formatDate(fromEpochDay(epochDay(toLocal(Date.now(), app.zone)) + 7)));
  const back = $derived.by(() => {
    const day = parseDate(date);
    return day !== null && day > today ? day : null;
  });

  async function pauseUntil(until: number | null) {
    await pause(reminder, until);
    ui.closeSheet();
  }
</script>

<TimeSheet title="Pause" {reminder}>
  <div class="group">
    <button class="field" onclick={() => pauseUntil(null)}>Until I resume it</button>
    <div class="field">
      <span class="until">Until <DatePicker bind:date zone={app.zone} /></span>
      <button
        class="link"
        disabled={back === null}
        onclick={() => back !== null && pauseUntil(toInstant({ ...fromEpochDay(back), hour: 0, minute: 0 }, app.zone))}
        >Pause</button
      >
    </div>
  </div>
  <p class="hint">Nothing goes off while it's paused. It picks up again at the next one after that.</p>
</TimeSheet>

<style>
  .until {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .hint {
    margin: 10px 2px 0;
    color: var(--muted);
    font-size: 13px;
  }
</style>
