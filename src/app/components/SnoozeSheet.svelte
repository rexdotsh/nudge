<script lang="ts">
  import { formatLocal, parseLocal, toInstant, toLocal } from '../../shared/time';
  import type { Reminder } from '../../shared/reminder';
  import { snooze, snoozeOptions } from '../lib/actions';
  import { app } from '../lib/app.svelte';
  import { whenLabel } from '../lib/format';
  import { ui } from '../lib/ui.svelte';
  import Sheet from './Sheet.svelte';

  let { reminder }: { reminder: Reminder } = $props();

  const options = $derived(snoozeOptions(app.now, app.zone));
  let custom = $state(formatLocal(toLocal(app.now + 3_600_000, app.zone)));

  async function pick(at: number) {
    await snooze(reminder, at);
    ui.close();
  }

  const customAt = $derived.by(() => {
    const local = parseLocal(custom.slice(0, 16));
    return local ? toInstant(local, app.zone) : null;
  });

  function pickCustom() {
    if (customAt !== null) void pick(customAt);
  }
</script>

<Sheet label="Snooze {reminder.title}" onClose={() => ui.close()}>
  <h2>Snooze</h2>
  <p class="what">{reminder.title}</p>
  <div class="group">
    {#each options as option (option.key)}
      <button class="field" onclick={() => pick(option.at)}>
        <span>{option.label}</span>
        <span class="value">{whenLabel(option.at, app.now, app.zone)}</span>
      </button>
    {/each}
    <div class="field">
      <label class="picker">
        <span>{customAt === null ? 'Pick a time' : whenLabel(customAt, app.now, app.zone)}</span>
        <input type="datetime-local" bind:value={custom} aria-label="Pick a time" />
      </label>
      <button class="set" onclick={pickCustom} disabled={customAt === null}>Set</button>
    </div>
  </div>
</Sheet>

<style>
  h2 {
    margin: 2px 0 0;
    font-size: 22px;
    font-weight: 600;
    letter-spacing: -0.02em;
  }

  .what {
    margin: 2px 0 16px;
    overflow: hidden;
    color: var(--muted);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .set:disabled {
    opacity: 0.4;
  }

  .set {
    color: var(--accent);
    font-weight: 600;
  }
</style>
