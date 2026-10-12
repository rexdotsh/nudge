<script lang="ts">
  import Composer from '../components/Composer.svelte';
  import EditSheet from '../components/EditSheet.svelte';
  import FocusCard from '../components/FocusCard.svelte';
  import Icon from '../components/Icon.svelte';
  import ReminderRow from '../components/ReminderRow.svelte';
  import SnoozeSheet from '../components/SnoozeSheet.svelte';
  import Toast from '../components/Toast.svelte';
  import { app } from '../lib/app.svelte';
  import { dayHeading, whenLabel } from '../lib/format';
  import { recentlyCompleted, triage } from '../lib/sections';
  import { shortcut } from '../lib/shortcuts';
  import { ui } from '../lib/ui.svelte';

  let { onSettings, composing = false }: { onSettings: () => void; composing?: boolean } = $props();

  let showCompleted = $state(false);

  const day = $derived(dayHeading(app.now, app.zone));
  const lists = $derived(triage(app.reminders, app.now, app.zone));
  const completed = $derived(recentlyCompleted(app.reminders, app.now));
  const editing = $derived(app.reminders.find((reminder) => reminder.id === ui.editing));
  const snoozing = $derived(app.reminders.find((reminder) => reminder.id === ui.snoozing));
</script>

<svelte:window onkeydown={shortcut} />

<div class="home">
  <header>
    <h1>{day.weekday} <span>{day.date}</span></h1>
    <div class="tools">
      {#if !app.online}<span class="chip">Offline</span>{/if}
      <button class="round" onclick={onSettings} aria-label="Settings"><Icon name="settings" size={16} /></button>
    </div>
  </header>

  <Composer autofocus={composing} />

  <FocusCard triage={lists} now={app.now} zone={app.zone} />

  {#if lists.today.length > 0}
    <section>
      <h2 class="label"><span>Next</span><span>today</span></h2>
      {#each lists.today as entry (entry.reminder.id)}
        <ReminderRow {entry} now={app.now} zone={app.zone} />
      {/each}
    </section>
  {/if}

  {#if lists.later.length > 0}
    <section>
      <h2 class="label"><span>Later</span><span>{lists.later.length}</span></h2>
      {#each lists.later as entry (entry.reminder.id)}
        <ReminderRow {entry} now={app.now} zone={app.zone} compact />
      {/each}
    </section>
  {/if}

  {#if completed.length > 0}
    <section>
      <button class="label toggle-done" aria-expanded={showCompleted} onclick={() => (showCompleted = !showCompleted)}>
        <span>Completed</span><span>{showCompleted ? 'hide' : completed.length}</span>
      </button>
      {#if showCompleted}
        {#each completed as { reminder, at } (reminder.id)}
          <div class="done">
            <span>{reminder.title}</span>
            <span>{whenLabel(at, app.now, app.zone)}</span>
          </div>
        {/each}
      {/if}
    </section>
  {/if}

  {#if editing && !snoozing}
    {#key editing.id}<EditSheet reminder={editing} />{/key}
  {/if}
  {#if snoozing}<SnoozeSheet reminder={snoozing} />{/if}
  <Toast />
</div>

<style>
  .home {
    max-width: 560px;
    margin: 0 auto;
    padding: calc(env(safe-area-inset-top) + 16px) 18px calc(env(safe-area-inset-bottom) + 120px);
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 40px;
    margin-bottom: 14px;
  }

  h1 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
  }

  h1 span {
    color: var(--muted);
    font-weight: 400;
  }

  .tools {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .round {
    width: 34px;
    height: 34px;
    display: grid;
    place-items: center;
    border-radius: 50%;
    background: var(--surface);
    color: var(--ink-2);
  }

  section {
    margin-top: 24px;
  }

  h2 {
    margin: 0 2px 2px;
  }

  .toggle-done {
    width: calc(100% - 4px);
    margin: 0 2px;
    padding: 6px 0;
  }

  .done {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    padding: 9px 2px;
    border-bottom: 1px solid var(--line);
    color: var(--muted);
    font-size: 14px;
  }

  .done span:first-child {
    text-decoration: line-through;
    text-decoration-color: var(--faint);
  }

  @media (min-width: 720px) {
    .home {
      padding-top: 28px;
      padding-bottom: 60px;
    }
  }
</style>
