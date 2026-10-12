import { tick } from 'svelte';
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
  if (rowOf(document.activeElement)) return;
  const stayed = rows()[index]?.dataset.reminder === id;
  if (stayed || !(neighbour && focusRow(neighbour))) focusRow(id);
}
