import type { Reminder } from '../../shared/reminder';
import { complete, remove, snoozeOptions } from './actions';
import { app } from './app.svelte';
import { closeEditor, keepSelection, openEditor, rowOf, rows, saveEditor, snoozeTo } from './selection';
import { toasts } from './toasts.svelte';
import { ui } from './ui.svelte';

type Keys = readonly [string, ...string[]];

interface Hint {
  label: string;
  keys: Keys;
  /** Apple keyboards' keys, where their conventions differ. */
  apple?: Keys;
}

interface Binding extends Hint {
  /** Its modifier combos and Escape also work while typing in a field. */
  inFields?: true;
  /** Enter and Space stay with the focused button unless it opens a reminder. */
  yields?: true;
  /** Shown on the idle details pane. */
  featured?: true;
  /** Returns whether it handled the key, so unhandled keys keep their default. */
  run: (context: Context) => boolean;
}

interface Context {
  /** The reminder whose row has focus. */
  target: Reminder | undefined;
  key: string;
  openSettings: () => void;
}

const APPLE = app.platform === 'mac' || app.platform === 'ios';

export const NEW_REMINDER: Binding = {
  label: 'New reminder',
  keys: ['mod+k', 'n', '/'],
  inFields: true,
  featured: true,
  run: focusComposer,
};

export const SETTINGS: Binding = {
  label: 'Settings',
  keys: ['mod+,'],
  inFields: true,
  run: ({ openSettings }) => {
    openSettings();
    return true;
  },
};

export const HELP: Binding = { label: 'Keyboard shortcuts', keys: ['?'], run: showHelp };

export const CLOSE: Binding = { label: 'Close', keys: ['Escape'], inFields: true, run: escape };

const GENERAL: readonly Binding[] = [
  NEW_REMINDER,
  { label: 'Undo', keys: ['mod+z'], run: undo },
  SETTINGS,
  HELP,
  CLOSE,
];

export const OPEN: Binding = {
  label: 'Open',
  keys: ['Enter', 'e'],
  yields: true,
  featured: true,
  run: ({ target }) => act(target, ({ id }) => openEditor(id)),
};

export const DONE: Binding = {
  label: 'Done',
  keys: ['x', ' '],
  yields: true,
  featured: true,
  run: ({ target }) => act(target, (reminder) => keepSelection(reminder.id, () => complete(reminder))),
};

export const SNOOZE: Binding = {
  label: 'Snooze',
  keys: ['s'],
  featured: true,
  run: ({ target }) => act(target, ({ id }) => ui.snooze(id)),
};

export const DELETE: Binding = {
  label: 'Delete',
  keys: ['Delete', 'Backspace'],
  apple: ['Backspace', 'mod+Backspace'],
  run: ({ target }) => act(target, (reminder) => keepSelection(reminder.id, () => remove(reminder))),
};

const REMINDERS: readonly Binding[] = [
  { label: 'Next reminder', keys: ['j', 'ArrowDown'], featured: true, run: () => move(1) },
  { label: 'Previous reminder', keys: ['k', 'ArrowUp'], run: () => move(-1) },
  OPEN,
  DONE,
  SNOOZE,
  DELETE,
];

export const SAVE: Binding = {
  label: 'Save',
  keys: ['mod+Enter'],
  inFields: true,
  run: () => {
    void saveEditor();
    return true;
  },
};

const EDITING: readonly Binding[] = [SAVE];

const SNOOZING: readonly Binding[] = [
  { label: 'Pick a snooze time', keys: ['1', '2', '3', '4', '5'], run: ({ key }) => pickSnooze(Number(key)) },
];

export const FEATURED = [...GENERAL, ...REMINDERS].filter((binding) => binding.featured);

export const GROUPS: readonly { title: string; items: readonly Hint[] }[] = [
  { title: 'General', items: GENERAL },
  { title: 'Reminders', items: REMINDERS },
  { title: 'Editing', items: [...EDITING, ...SNOOZING] },
];

const NAMES: Record<string, string> = {
  ArrowDown: '↓',
  ArrowUp: '↑',
  ' ': 'Space',
  Delete: 'Del',
  Backspace: '⌫',
  Escape: 'Esc',
};

const APPLE_NAMES: Record<string, string> = { ...NAMES, Delete: '⌦', Enter: '↩' };

interface Combo {
  mod: boolean;
  key: string;
}

function combo(key: string): Combo {
  return key.startsWith('mod+') ? { mod: true, key: key.slice(4) } : { mod: false, key };
}

function keysOf({ keys, apple }: Hint): Keys {
  return (APPLE && apple) || keys;
}

function keyLabel(key: string): string {
  const { mod, key: base } = combo(key);
  const name = (APPLE ? APPLE_NAMES : NAMES)[base] ?? (base.length === 1 ? base.toUpperCase() : base);
  if (!mod) return name;
  return APPLE ? `⌘${name}` : `Ctrl ${name}`;
}

export function keyLabels(binding: Hint): string[] {
  return keysOf(binding).map(keyLabel);
}

export function hint(binding: Hint): string {
  return keyLabel(keysOf(binding)[0]);
}

export function tip(label: string, binding: Hint): string {
  return `${label} (${hint(binding)})`;
}

// Command on Apple keyboards and Ctrl elsewhere; the other one belongs to the system (Control-key text editing on a
// Mac, the Windows key on a PC), so a press with it never matches.
function matches({ mod, key }: Combo, event: KeyboardEvent): boolean {
  const [command, other] = APPLE ? [event.metaKey, event.ctrlKey] : [event.ctrlKey, event.metaKey];
  if (event.altKey || other || command !== mod || (mod && event.shiftKey)) return false;
  return event.key === key || event.key.toLowerCase() === key;
}

/** Keys pressed while an input method is composing text belong to it (Escape cancels the candidate, not the editor). */
export function composing(event: KeyboardEvent): boolean {
  // Safari reports the key that ends a composition as 229 with isComposing already false.
  return event.isComposing || event.keyCode === 229;
}

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement
  );
}

function showHelp(): boolean {
  ui.help = true;
  return true;
}

function act(target: Reminder | undefined, action: (reminder: Reminder) => unknown): boolean {
  if (!target) return false;
  void action(target);
  return true;
}

function undo(): boolean {
  if (!toasts.current?.undo) return false;
  toasts.undo();
  return true;
}

function focusComposer(): boolean {
  const composer = document.getElementById('composer');
  composer?.focus();
  return composer !== null;
}

function escape(): boolean {
  const active = document.activeElement;
  if (isTyping(active) && active instanceof HTMLElement && !active.closest('#editor')) {
    active.blur();
    return true;
  }
  if (!ui.docked || !ui.editing) return false;
  closeEditor();
  return true;
}

function pickSnooze(position: number): boolean {
  const reminder = app.reminders.find((candidate) => candidate.id === ui.snoozing);
  const option = reminder && snoozeOptions(reminder, app.now, app.zone)[position - 1];
  if (!reminder || !option) return false;
  void snoozeTo(reminder, option.at);
  return true;
}

function move(step: number): boolean {
  const list = rows();
  if (list.length === 0) return false;
  const current =
    rowOf(document.activeElement) ?? list.find((row) => ui.docked && row.dataset.reminder === ui.editing) ?? null;
  const index = current ? list.indexOf(current) : -1;
  const next = list[Math.min(Math.max(index + step, 0), list.length - 1)];
  next?.querySelector<HTMLElement>('.open')?.focus();
  const id = next?.dataset.reminder;
  if (id && ui.docked && ui.editing) ui.edit(id);
  return true;
}

/** Which bindings apply right now: an open sheet or menu owns the keyboard, and the list's keys stay out of the editor. */
function inPlay(target: Element | null): readonly Binding[] {
  if (ui.menu || ui.help) return [];
  if (ui.snoozing) return SNOOZING;
  if (ui.editing && !ui.docked) return EDITING;
  return target?.closest('#editor') ? [...GENERAL, ...EDITING] : [...GENERAL, ...REMINDERS];
}

export function shortcut(event: KeyboardEvent, openSettings: () => void): void {
  if (event.defaultPrevented || composing(event)) return;
  const target = event.target instanceof Element ? event.target : null;
  const typing = isTyping(target);
  for (const binding of inPlay(target)) {
    const hit = keysOf(binding)
      .map(combo)
      .find((candidate) => matches(candidate, event));
    if (!hit) continue;
    if (typing && !(binding.inFields && (hit.mod || hit.key === 'Escape'))) return;
    if (binding.yields && target?.closest('button, a') && !target.classList.contains('open')) return;
    const focused = rowOf(document.activeElement)?.dataset.reminder;
    const reminder = app.reminders.find((candidate) => candidate.id === focused);
    if (binding.run({ target: reminder, key: hit.key, openSettings })) event.preventDefault();
    return;
  }
}
