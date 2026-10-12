<script lang="ts">
  import type { Reminder } from '../../shared/reminder';
  import { complete, remove, snooze, snoozeOptions } from '../lib/actions';
  import { app } from '../lib/app.svelte';
  import { closeOnBack } from '../lib/close';
  import { shortWhen } from '../lib/format';
  import { focusRow, keepSelection, openEditor } from '../lib/selection';
  import { DELETE, DONE, OPEN, SNOOZE, composing, hint } from '../lib/shortcuts';
  import { ui } from '../lib/ui.svelte';

  let { reminder, x, y, fromKeyboard }: { reminder: Reminder; x: number; y: number; fromKeyboard: boolean } = $props();

  const MARGIN_PX = 8;
  const STEPS: Record<string, number> = { ArrowDown: 1, ArrowUp: -1 };

  const options = $derived(snoozeOptions(reminder, app.now, app.zone));
  let left = $state(0);
  let top = $state(0);

  let menu: HTMLElement | undefined = $state();

  function show(node: HTMLElement) {
    const { width, height } = node.getBoundingClientRect();
    left = Math.max(MARGIN_PX, Math.min(x, innerWidth - width - MARGIN_PX));
    top = y + height > innerHeight - MARGIN_PX ? Math.max(MARGIN_PX, y - height) : y;
    // Like the system's menus, only one opened from the keyboard starts with an item picked.
    (fromKeyboard ? node.querySelector<HTMLElement>('[role="menuitem"]') : node)?.focus();
  }

  function close() {
    ui.menu = null;
  }

  $effect(() => closeOnBack(close));

  function outside(event: Event) {
    if (!(event.target instanceof Node && menu?.contains(event.target))) close();
  }

  // Once closed, Home has no reminder left to pass down, so take it before closing.
  function run(action: (target: Reminder) => unknown) {
    const target = reminder;
    close();
    void action(target);
  }

  function navigate(event: KeyboardEvent & { currentTarget: HTMLElement }) {
    if (composing(event)) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      run(({ id }) => focusRow(id));
      return;
    }
    const step = STEPS[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    const index = items.findIndex((item) => item === document.activeElement);
    // With no item picked yet, Down picks the first and Up the last.
    const from = index === -1 && step < 0 ? items.length : index;
    items[(from + step + items.length) % items.length]?.focus();
  }
</script>

<svelte:window onpointerdowncapture={outside} onresize={close} onblur={close} />

<div
  class="menu"
  role="menu"
  tabindex="-1"
  aria-label={reminder.title}
  style:left="{left}px"
  style:top="{top}px"
  bind:this={menu}
  {@attach show}
  onkeydown={navigate}
  onfocusout={(event) => event.relatedTarget instanceof Node && !menu?.contains(event.relatedTarget) && close()}
>
  <button role="menuitem" onclick={() => run(({ id }) => openEditor(id))}>Open<kbd>{hint(OPEN)}</kbd></button>
  <button role="menuitem" onclick={() => run((target) => keepSelection(target.id, () => complete(target)))}
    >Done<kbd>{hint(DONE)}</kbd></button
  >
  <div class="rule" role="separator"></div>
  <p class="caption" role="presentation">Snooze</p>
  {#each options as option (option.key)}
    <button role="menuitem" onclick={() => run((target) => keepSelection(target.id, () => snooze(target, option.at)))}
      >{option.label}<span class="time">{shortWhen(option.at, app.now, app.zone)}</span></button
    >
  {/each}
  <button role="menuitem" onclick={() => run(({ id }) => ui.snooze(id))}>Pick a time…<kbd>{hint(SNOOZE)}</kbd></button>
  <div class="rule" role="separator"></div>
  <button role="menuitem" class="danger" onclick={() => run((target) => keepSelection(target.id, () => remove(target)))}
    >Delete<kbd>{hint(DELETE)}</kbd></button
  >
</div>

<style>
  .menu {
    position: fixed;
    z-index: 50;
    min-width: 220px;
    max-width: calc(100vw - 16px);
    padding: 4px;
    border: 1px solid var(--edge);
    border-radius: 10px;
    background: var(--surface);
    color: var(--ink);
    box-shadow: var(--shadow);
    transform-origin: top left;
    animation: open 0.12s var(--ease);
  }

  .menu:focus {
    outline: none;
  }

  button {
    width: 100%;
    height: 30px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 0 10px;
    border-radius: 6px;
    font-size: 13.5px;
    text-align: left;
    white-space: nowrap;
  }

  button:is(:hover, :focus) {
    outline: none;
    background: var(--edge);
  }

  kbd,
  .time {
    padding: 0;
    background: none;
    box-shadow: none;
    color: var(--muted);
    font-size: 12px;
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
    button {
      height: 44px;
      font-size: 15px;
    }

    kbd {
      display: none;
    }
  }

  @keyframes open {
    from {
      opacity: 0;
      transform: scale(0.97);
    }
  }
</style>
