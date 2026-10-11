import { complete, remove } from './actions';
import { app } from './app.svelte';
import { toasts } from './toasts.svelte';
import { ui } from './ui.svelte';

const MOVES: Record<string, number> = { j: 1, ArrowDown: 1, k: -1, ArrowUp: -1 };

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement
  );
}

export function shortcut(event: KeyboardEvent): void {
  if (isTyping(event.target) || ui.editing || ui.snoozing) return;
  if ((event.ctrlKey || event.metaKey) && event.key === 'z') {
    toasts.current?.undo?.();
    toasts.dismiss();
    return;
  }
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const rows = [...document.querySelectorAll<HTMLElement>('[data-reminder]')];
  const focused = document.activeElement?.closest<HTMLElement>('[data-reminder]') ?? null;
  const move = MOVES[event.key];
  if (move !== undefined) {
    event.preventDefault();
    const index = focused ? rows.indexOf(focused) : -1;
    rows[Math.min(Math.max(index + move, 0), rows.length - 1)]?.focus();
    return;
  }
  const target = app.reminders.find((reminder) => reminder.id === focused?.dataset.reminder);
  if (!target) return;
  if (event.key === 'e') ui.edit(target.id);
  else if (event.key === 'd') void complete(target);
  else if (event.key === 's') ui.snooze(target.id);
  else if (event.key === 'Delete' || event.key === 'Backspace') void remove(target);
}
