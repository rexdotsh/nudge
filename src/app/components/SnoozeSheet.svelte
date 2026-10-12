<script lang="ts">
  import { untrack } from 'svelte';
  import { HOUR_MS, formatLocal, parseLocal, toInstant, toLocal } from '../../shared/time';
  import type { Reminder } from '../../shared/reminder';
  import { snooze, snoozeFrom, snoozeOptions } from '../lib/actions';
  import { app } from '../lib/app.svelte';
  import { whenLabel } from '../lib/format';
  import { ui } from '../lib/ui.svelte';
  import Sheet from './Sheet.svelte';

  let { reminder }: { reminder: Reminder } = $props();

  const from = $derived(snoozeFrom(reminder, app.now, app.zone));
  const options = $derived(snoozeOptions(reminder, app.now, app.zone));
  let custom = $state(formatLocal(toLocal(untrack(() => from) + HOUR_MS, app.zone)));

  async function pick(at: number) {
    await snooze(reminder, at);
    // A docked editor stays beside the list; a sheet editor was only hidden behind this one and goes too.
    if (ui.docked) ui.snoozing = null;
    else ui.close();
  }

  const customAt = $derived.by(() => {
    const local = parseLocal(custom.slice(0, 16));
    return local ? toInstant(local, app.zone) : null;
  });
  const settable = $derived(customAt !== null && customAt > from ? customAt : null);

  function pickCustom() {
    if (settable !== null) void pick(settable);
  }

  function pickByNumber(event: KeyboardEvent) {
    if (event.ctrlKey || event.metaKey || event.altKey || event.target instanceof HTMLInputElement) return;
    const option = options[Number(event.key) - 1];
    if (!option) return;
    event.preventDefault();
    void pick(option.at);
  }
</script>

<svelte:window onkeydown={pickByNumber} />

<Sheet label="Snooze {reminder.title}" onClose={() => (ui.snoozing = null)}>
  <h2 class="heading">Snooze</h2>
  <p class="what">{reminder.title}</p>
  <div class="group">
    {#each options as option, index (option.key)}
      <button class="field" onclick={() => pick(option.at)}>
        <span><kbd>{index + 1}</kbd>{option.label}</span>
        <span class="value">{whenLabel(option.at, app.now, app.zone)}</span>
      </button>
    {/each}
    <div class="field">
      <label class="picker">
        <span>{customAt === null ? 'Pick a time' : whenLabel(customAt, app.now, app.zone)}</span>
        <input type="datetime-local" bind:value={custom} aria-label="Pick a time" />
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
