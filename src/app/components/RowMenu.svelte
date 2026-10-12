<script lang="ts">
  import type { Reminder } from '../../shared/reminder';
  import { complete, remove, snooze, snoozeOptions } from '../lib/actions';
  import { app } from '../lib/app.svelte';
  import { closeOnBack } from '../lib/close';
  import { shortWhen } from '../lib/format';
  import { focusRow, keepSelection, openEditor } from '../lib/selection';
  import { DELETE, DONE, OPEN, SNOOZE, composing, hint } from '../lib/shortcuts';
  import { ui } from '../lib/ui.svelte';
  import Popover from './Popover.svelte';

  let { reminder, x, y, fromKeyboard }: { reminder: Reminder; x: number; y: number; fromKeyboard: boolean } = $props();

  const STEPS: Record<string, number> = { ArrowDown: 1, ArrowUp: -1 };

  const options = $derived(snoozeOptions(reminder, app.now, app.zone));

  function close() {
    ui.menu = null;
  }

  $effect(() => closeOnBack(close));

  // Once closed, Home has no reminder left to pass down, so take it before closing.
  function run(action: (target: Reminder) => void | Promise<void>) {
    const target = reminder;
    close();
    void action(target);
  }

  function navigate(event: KeyboardEvent & { currentTarget: HTMLDivElement }) {
    if (composing(event)) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      run(({ id }) => {
        focusRow(id);
      });
      return;
    }
    const step = STEPS[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    const index = items.findIndex((item) => item === document.activeElement);
    const from = index === -1 && step < 0 ? items.length : index;
    items[(from + step + items.length) % items.length]?.focus();
  }
</script>

<Popover
  anchor={{ x, y }}
  onClose={close}
  style="min-width: 220px; max-width: calc(100vw - 16px)"
  role="menu"
  tabindex={-1}
  aria-label={reminder.title}
  onkeydown={navigate}
>
  <button
    class="item"
    role="menuitem"
    data-autofocus={fromKeyboard || undefined}
    onclick={() => run(({ id }) => openEditor(id))}>Open<kbd>{hint(OPEN)}</kbd></button
  >
  <button class="item" role="menuitem" onclick={() => run((target) => keepSelection(target.id, () => complete(target)))}
    >Done<kbd>{hint(DONE)}</kbd></button
  >
  <div class="rule" role="separator"></div>
  <p class="caption" role="presentation">Snooze</p>
  {#each options as option (option.key)}
    <button
      class="item"
      role="menuitem"
      onclick={() => run((target) => keepSelection(target.id, () => snooze(target, option.at)))}
      >{option.label}<span class="time">{shortWhen(option.at, app.now, app.zone)}</span></button
    >
  {/each}
  <button class="item" role="menuitem" onclick={() => run(({ id }) => ui.snooze(id))}
    >Pick a time…<kbd>{hint(SNOOZE)}</kbd></button
  >
  <div class="rule" role="separator"></div>
  <button
    class="item danger"
    role="menuitem"
    onclick={() => run((target) => keepSelection(target.id, () => remove(target)))}
    >Delete<kbd>{hint(DELETE)}</kbd></button
  >
</Popover>

<style>
  kbd,
  .time {
    padding: 0;
    background: none;
    box-shadow: none;
    color: var(--muted);
    font-size: 12px;
  }

  button:is(:hover, :focus) :is(kbd, .time) {
    color: var(--ink-2);
  }

  .danger {
    color: var(--accent);
  }

  .rule {
    height: 1px;
    margin: 4px 6px;
    background: var(--edge);
  }

  .caption {
    margin: 0;
    padding: 6px 10px 2px;
    color: var(--muted);
    font-size: 12px;
    font-weight: 600;
  }

  /* Android opens it with a long press. */
  @media (pointer: coarse) {
    .item {
      height: 44px;
      font-size: 15px;
    }

    kbd {
      display: none;
    }
  }
</style>
