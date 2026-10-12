<script lang="ts">
  import { openPicker } from '../lib/picker';
  import { untrack } from 'svelte';
  import { HOUR_MS, formatLocal, parseLocal, toInstant, toLocal } from '../../shared/time';
  import type { Reminder } from '../../shared/reminder';
  import { snoozeFrom, snoozeOptions } from '../lib/actions';
  import { app } from '../lib/app.svelte';
  import { whenLabel } from '../lib/format';
  import { snoozeTo } from '../lib/selection';
  import { ui } from '../lib/ui.svelte';
  import Sheet from './Sheet.svelte';

  let { reminder }: { reminder: Reminder } = $props();

  const from = $derived(snoozeFrom(reminder, app.now, app.zone));
  const options = $derived(snoozeOptions(reminder, app.now, app.zone));
  let custom = $state(formatLocal(toLocal(untrack(() => from) + HOUR_MS, app.zone)));

  const customAt = $derived.by(() => {
    const local = parseLocal(custom.slice(0, 16));
    return local ? toInstant(local, app.zone) : null;
  });
  const settable = $derived(customAt !== null && customAt > from ? customAt : null);

  function pickCustom() {
    if (settable !== null) void snoozeTo(reminder, settable);
  }
</script>

<Sheet label="Snooze {reminder.title}" onClose={() => (ui.snoozing = null)}>
  <h2 class="heading">Snooze</h2>
  <p class="what">{reminder.title}</p>
  <div class="group">
    {#each options as option, index (option.key)}
      <button class="field" onclick={() => snoozeTo(reminder, option.at)}>
        <span><kbd>{index + 1}</kbd>{option.label}</span>
        <span class="value">{whenLabel(option.at, app.now, app.zone)}</span>
      </button>
    {/each}
    <div class="field">
      <label class="picker">
        <span>{customAt === null ? 'Pick a time' : whenLabel(customAt, app.now, app.zone)}</span>
        <input type="datetime-local" bind:value={custom} aria-label="Pick a time" onclick={openPicker} />
      </label>
      <button class="link" onclick={pickCustom} disabled={settable === null}>Set</button>
    </div>
  </div>
</Sheet>

<style>
  h2 {
    margin-top: 2px;
  }

  kbd {
    display: none;
    margin-right: 10px;
  }

  @media (pointer: fine) {
    kbd {
      display: inline-block;
    }
  }

  .what {
    margin: 2px 0 16px;
    overflow: hidden;
    color: var(--muted);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
