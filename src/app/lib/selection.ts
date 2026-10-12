import { tick } from 'svelte';
import type { Reminder } from '../../shared/reminder';
import { complete, snooze } from './actions';
import { ui } from './ui.svelte';

export function rowOf(element: Element | null): HTMLElement | null {
  return element?.closest<HTMLElement>('[data-reminder]') ?? null;
}

export function rows(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[data-reminder]')];
}

export function focusRow(id: string): boolean {
  const opener = rows()
    .find((row) => row.dataset.reminder === id)
    ?.querySelector<HTMLElement>('.open');
  opener?.focus();
  return opener !== undefined;
}

export function openEditor(id: string): void {
  ui.edit(id);
  if (ui.docked) void tick().then(() => document.getElementById('editor')?.focus());
}

export function closeEditor(): void {
  const id = ui.editing;
  ui.close();
  if (id) void tick().then(() => focusRow(id));
}

/** Runs an action on a row and keeps a row selected, moving to its neighbour when the row leaves the list. */
export async function keepSelection(id: string, action: () => Promise<void>): Promise<void> {
  const before = rows();
  const index = before.findIndex((row) => row.dataset.reminder === id);
  const neighbour = (before[index + 1] ?? before[index - 1])?.dataset.reminder;
  await action();
  await tick();
  // A reused node (the focus card) can hold focus while showing another reminder, so compare ids, not nodes.
  if (rowOf(document.activeElement)?.dataset.reminder === id) return;
  const stayed = rows()[index]?.dataset.reminder === id;
  if (stayed || !(neighbour && focusRow(neighbour))) focusRow(id);
}

export async function saveEditor(): Promise<void> {
  const draft = ui.draft;
  if (!draft?.parsed) return;
  await draft.save();
  closeEditor();
}

/** A docked editor stays beside the list; a sheet editor was only hidden behind the snooze sheet and goes too. */
export async function snoozeTo(reminder: Reminder, at: number): Promise<void> {
  await snooze(reminder, at);
  if (ui.docked) ui.snoozing = null;
  else ui.close();
}

/** Completes from a Done control; activated from the keyboard, focus moves on to a neighbour instead of the page. */
export function completeFrom(event: MouseEvent, reminder: Reminder): Promise<void> {
  // Keyboard activation of a button dispatches a click with no pointer presses counted.
  return event.detail === 0 ? keepSelection(reminder.id, () => complete(reminder)) : complete(reminder);
}
