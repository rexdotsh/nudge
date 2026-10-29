<script lang="ts">
  import Composer from '../components/Composer.svelte';
  import EditSheet from '../components/EditSheet.svelte';
  import FocusCard from '../components/FocusCard.svelte';
  import CheckCircle from '../components/CheckCircle.svelte';
  import Icon from '../components/Icon.svelte';
  import Pane from '../components/Pane.svelte';
  import PausedRow from '../components/PausedRow.svelte';
  import PauseSheet from '../components/PauseSheet.svelte';
  import ReminderRow from '../components/ReminderRow.svelte';
  import RowMenu from '../components/RowMenu.svelte';
  import ShortcutsSheet from '../components/ShortcutsSheet.svelte';
  import SnoozeSheet from '../components/SnoozeSheet.svelte';
  import Toast from '../components/Toast.svelte';
  import { remove, reopen } from '../lib/actions';
  import { app } from '../lib/app.svelte';
  import { dayHeading, whenLabel } from '../lib/format';
  import { glide } from '../lib/motion.svelte';
  import { triage } from '../../shared/triage';
  import { recentlyCompleted } from '../lib/sections';
  import { rowOf } from '../lib/selection';
  import { SETTINGS, shortcut, tip } from '../lib/shortcuts';
  import { ui } from '../lib/ui.svelte';

  let { onSettings, composing = false }: { onSettings: () => void; composing?: boolean } = $props();

  let showCompleted = $state(false);
  let page: HTMLElement | undefined = $state();

  const day = $derived(dayHeading(app.now, app.zone));
  const lists = $derived(triage(app.reminders, app.now, app.zone));
  const completed = $derived(recentlyCompleted(app.reminders, app.now));
  const editing = $derived(app.reminders.find((reminder) => reminder.id === ui.editing && !reminder.deleted));
  const sheet = $derived.by(() => {
    const open = ui.sheet;
    const reminder = open && app.reminders.find((candidate) => candidate.id === open.id);
    return open && reminder ? { kind: open.kind, reminder } : null;
  });
  const menu = $derived.by(() => {
    const at = ui.menu;
    const reminder = at && app.reminders.find((candidate) => candidate.id === at.id);
    return at && reminder ? { ...at, reminder } : null;
  });

  glide(
    () => page,
    () => [lists, completed, showCompleted],
  );

  function openMenu(event: MouseEvent) {
    const row = rowOf(event.target instanceof Element ? event.target : null);
    const id = row?.dataset.reminder;
    if (!row || !id) return;
    event.preventDefault();
    // A context menu opened from the keyboard has no pointer position, so it hangs off the row.
    const fromKeyboard = event.clientX === 0 && event.clientY === 0;
    const box = row.getBoundingClientRect();
    ui.menu = {
      id,
      x: fromKeyboard ? box.left + 32 : event.clientX,
      y: fromKeyboard ? box.bottom : event.clientY,
      fromKeyboard,
    };
  }
</script>

<svelte:window onkeydown={(event) => shortcut(event, onSettings)} oncontextmenu={openMenu} />

<div class="page home" bind:this={page}>
  <header>
    <h1>{day.weekday} <span>{day.date}</span></h1>
    <div class="tools">
      {#if !app.online}<span class="chip">Offline</span>{/if}
      <button class="round press" onclick={onSettings} aria-label="Settings" title={tip('Settings', SETTINGS)}
        ><Icon name="settings" size={16} /></button
      >
    </div>
  </header>

  <Composer autofocus={composing} />

  <FocusCard triage={lists} now={app.now} zone={app.zone} />

  {#if lists.today.length > 0}
    <section>
      <h2 class="label" data-glide="next"><span>Next</span><span>today</span></h2>
      {#each lists.today as entry (entry.reminder.id)}
        <ReminderRow {entry} now={app.now} zone={app.zone} />
      {/each}
    </section>
  {/if}

  {#if lists.later.length > 0}
    <section>
      <h2 class="label" data-glide="later"><span>Later</span><span>{lists.later.length}</span></h2>
      {#each lists.later as entry (entry.reminder.id)}
        <ReminderRow {entry} now={app.now} zone={app.zone} compact />
      {/each}
    </section>
  {/if}

  {#if lists.paused.length > 0}
    <section>
      <h2 class="label" data-glide="paused"><span>Paused</span><span>{lists.paused.length}</span></h2>
      {#each lists.paused as reminder (reminder.id)}
        <PausedRow {reminder} now={app.now} zone={app.zone} />
      {/each}
    </section>
  {/if}

  {#if completed.length > 0}
    <section>
      <button
        class="label toggle-done press"
        data-glide="completed"
        aria-expanded={showCompleted}
        onclick={() => (showCompleted = !showCompleted)}
      >
        <span>Completed</span><span>{showCompleted ? 'hide' : completed.length}</span>
      </button>
      {#if showCompleted}
        {#each completed as { reminder, at } (reminder.id)}
          <div class="done action-row hover-focus" data-glide="done:{reminder.id}">
            <!-- An ended series does not keep which occurrence was its last, so only a one-off can be put back. -->
            {#if !reminder.repeat}
              <CheckCircle
                small
                checked
                label={`Mark ${reminder.title} not done`}
                onToggle={() => void reopen(reminder)}
              />
            {/if}
            <span class="title">{reminder.title}</span>
            <span class="hover-trail">{whenLabel(at, app.now, app.zone)}</span>
            <button
              class="forget icon-button press hover-actions"
              onclick={() => void remove(reminder)}
              aria-label={`Delete ${reminder.title}`}
              title="Delete"><Icon name="close" size={14} /></button
            >
          </div>
        {/each}
        <button
          class="link clear"
          data-glide="clear"
          onclick={() => void remove(...completed.map(({ reminder }) => reminder))}>Clear completed</button
        >
      {/if}
    </section>
  {/if}

  {#each editing && !sheet && !ui.docked ? [editing] : [] as reminder (reminder.id)}
    <EditSheet {reminder} />
  {/each}
  {#each sheet ? [sheet] : [] as { kind, reminder } (reminder.id)}
    {#if kind === 'snooze'}<SnoozeSheet {reminder} />{:else}<PauseSheet {reminder} />{/if}
  {/each}
  {#each menu ? [menu] : [] as opened (opened.id)}
    <RowMenu reminder={opened.reminder} x={opened.x} y={opened.y} fromKeyboard={opened.fromKeyboard} />
  {/each}
  {#if ui.help}<ShortcutsSheet />{/if}
  <Toast />
</div>
{#if ui.docked}<Pane {editing} />{/if}

<style>
  .home {
    padding-bottom: calc(env(safe-area-inset-bottom) + 120px);
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
    align-items: center;
    gap: 12px;
    min-height: 40px;
    padding: 4px 0 4px 2px;
    border-bottom: 1px solid var(--line);
    color: var(--muted);
    font-size: 14px;
  }

  .done .title {
    flex: 1;
    min-width: 0;
    text-decoration: line-through;
    text-decoration-color: var(--faint);
    overflow-wrap: anywhere;
  }

  .forget {
    --icon-size: 32px;
  }

  @media (hover: none) {
    .forget {
      margin-right: -6px;
    }
  }

  .clear {
    display: block;
    margin: 4px 0 0 auto;
    padding: 10px 2px;
    font-size: 13.5px;
  }

  @media (min-width: 720px) {
    .home {
      padding-top: calc(env(titlebar-area-height, 0px) + 28px);
      padding-bottom: 60px;
    }
  }

  @media (min-width: 960px) {
    .home {
      --pane: var(--pane-width);
      --gutter: max(32px, calc((100% - var(--pane) - 680px) / 2));
      max-width: none;
      padding-left: var(--gutter);
      padding-right: calc(var(--gutter) + var(--pane));
    }
  }
</style>
