<script lang="ts">
  import { untrack } from 'svelte';
  import { HOUR_MS, formatClock, formatDate, parseLocal, toInstant, toLocal } from '../../shared/time';
  import type { Reminder } from '../../shared/reminder';
  import { snoozeFrom, snoozeOptions } from '../lib/actions';
  import { app } from '../lib/app.svelte';
  import { whenLabel } from '../lib/format';
  import { snoozeTo } from '../lib/selection';
  import { ui } from '../lib/ui.svelte';
  import Sheet from './Sheet.svelte';
  import When from './When.svelte';

  let { reminder }: { reminder: Reminder } = $props();

  const from = $derived(snoozeFrom(reminder, app.now, app.zone));
  const options = $derived(snoozeOptions(reminder, app.now, app.zone));
  const initial = toLocal(untrack(() => from) + HOUR_MS, app.zone);
  let date = $state(formatDate(initial));
  let time = $state(formatClock(initial));

  const customAt = $derived.by(() => {
    const local = parseLocal(`${date}T${time}`);
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
      <When bind:date bind:time zone={app.zone} />
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
