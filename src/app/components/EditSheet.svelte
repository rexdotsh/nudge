<script lang="ts">
  import { untrack } from 'svelte';
  import { prefersReducedMotion } from 'svelte/motion';
  import { fly } from 'svelte/transition';
  import { LIMITS } from '../../shared/input';
  import type { Reminder } from '../../shared/reminder';
  import { complete, remove } from '../lib/actions';
  import { app } from '../lib/app.svelte';
  import { zoneLabel } from '../lib/format';
  import { tick } from '../lib/haptics';
  import { closeEditor, saveEditor } from '../lib/selection';
  import { CLOSE, SAVE, tip } from '../lib/shortcuts';
  import { toasts } from '../lib/toasts.svelte';
  import { ui } from '../lib/ui.svelte';
  import Icon from './Icon.svelte';
  import RepeatPicker from './RepeatPicker.svelte';
  import Sheet from './Sheet.svelte';
  import When from './When.svelte';

  let { reminder }: { reminder: Reminder } = $props();

  const ALERTS = [
    { minutes: 5, label: '5 min' },
    { minutes: 15, label: '15 min' },
    { minutes: 60, label: '1 hour' },
    { minutes: 1440, label: '1 day' },
  ];

  const draft = untrack(() => ui.draftFor(reminder));
  const zone = $derived(draft.fields.zone ?? app.zone);

  async function act(action: (current: Reminder) => Promise<void> | void) {
    await draft.persist();
    const current = app.reminders.find((candidate) => candidate.id === draft.id);
    if (current) await action(current);
  }

  async function skip(current: Reminder) {
    if (current.due === null) return;
    tick();
    await app.apply({ type: 'skip', id: current.id, due: current.due });
    toasts.show('Skipped to the next one');
    closeEditor();
  }
</script>

{#snippet form()}
  <nav>
    <button class="link quiet" onclick={closeEditor} title={tip('Cancel', CLOSE)}>Cancel</button>
    <button class="link" onclick={saveEditor} disabled={draft.parsed === null} title={tip('Save', SAVE)}>Save</button>
  </nav>

  <input
    class="bare heading"
    bind:value={draft.title}
    maxlength={LIMITS.title}
    aria-label="Title"
    placeholder="Title"
  />
  <textarea
    class="bare"
    bind:value={draft.notes}
    maxlength={LIMITS.notes}
    aria-label="Notes"
    placeholder="Add a note"
    rows="1"></textarea>

  <div class="group">
    <div class="field">
      <span>When</span>
      <When bind:date={draft.date} bind:time={draft.time} {zone} />
    </div>
    <RepeatPicker choice={draft.repeat} start={draft.fields.start} />
    <div class="field stacked">
      <span id="alerts-label">Also remind me before</span>
      <div class="alerts" role="group" aria-labelledby="alerts-label">
        {#each ALERTS as alert (alert.minutes)}
          <button aria-pressed={draft.alerts.includes(alert.minutes)} onclick={() => draft.toggleAlert(alert.minutes)}>
            {alert.label}
          </button>
        {/each}
      </div>
    </div>
  </div>

  <div class="group">
    <label class="field">
      <span>Important</span>
      <input class="toggle" type="checkbox" bind:checked={draft.important} />
    </label>
    {#if draft.showZone}
      <label class="field">
        <span
          >Keep this time zone<small
            >{draft.pinned ? `Always ${zoneLabel(zone, app.now)}` : 'Follows you when you travel'}</small
          ></span
        >
        <input class="toggle" type="checkbox" bind:checked={draft.pinned} />
      </label>
    {/if}
  </div>

  <div class="acts">
    {#if reminder.due !== null}
      <button class="btn" disabled={!draft.parsed} onclick={() => act((current) => complete(current).then(closeEditor))}
        ><Icon name="check" size={16} />Done</button
      >
      <button class="btn" disabled={!draft.parsed} onclick={() => act((current) => ui.snooze(current.id))}
        ><Icon name="clock" size={16} />Snooze</button
      >
      {#if reminder.repeat}
        <button class="btn" disabled={!draft.parsed} onclick={() => act(skip)}
          ><Icon name="skip" size={16} />Skip</button
        >
      {/if}
    {/if}
    <button class="link delete" onclick={() => void remove(reminder).then(closeEditor)}>Delete</button>
  </div>
{/snippet}

{#if ui.docked}
  <section
    id="editor"
    class="docked"
    tabindex="-1"
    aria-label="Edit {draft.original.title}"
    in:fly={{ x: prefersReducedMotion.current ? 0 : 12, duration: 180 }}
  >
    {@render form()}
  </section>
{:else}
  <Sheet label="Edit {draft.original.title}" onClose={closeEditor}>
    <div id="editor">{@render form()}</div>
  </Sheet>
{/if}

<style>
  .docked {
    padding: 28px 24px 24px;
    outline: none;
  }

  .docked nav {
    min-height: 40px;
    align-items: center;
    padding: 0 0 8px;
  }

  nav {
    display: flex;
    justify-content: space-between;
    padding: 2px 0 10px;
  }

  textarea {
    margin: 4px 0 16px;
    color: var(--ink-2);
    resize: none;
    field-sizing: content;
  }

  .group + .group {
    margin-top: 12px;
  }

  .alerts {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 2px;
    padding: 2px;
    border-radius: 10px;
    background: var(--bg);
    box-shadow: inset 0 0 0 1px var(--edge);
  }

  .alerts button {
    height: 32px;
    border-radius: 8px;
    color: var(--ink-2);
    font-size: 13.5px;
    font-weight: 500;
  }

  .alerts button[aria-pressed='true'] {
    background: var(--on);
    color: var(--on-ink);
    font-weight: 600;
  }

  .acts {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 16px;
  }

  .acts .btn {
    flex: 1;
    padding: 0 12px;
  }

  .delete {
    flex-basis: 100%;
    padding: 12px;
    font-size: 14px;
  }

  @media (min-width: 720px) {
    .acts .btn {
      flex: none;
    }

    .delete {
      flex-basis: auto;
      margin-left: auto;
      padding: 0 4px;
    }
  }
</style>
