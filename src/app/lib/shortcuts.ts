import type { Reminder } from '../../shared/reminder';
import { complete, remove } from './actions';
import { app } from './app.svelte';
import { closeEditor, keepSelection, openEditor, rowOf, rows } from './selection';
import { toasts } from './toasts.svelte';
import { ui } from './ui.svelte';

interface Hint {
  label: string;
  keys: readonly string[];
}

interface Binding extends Hint {
  /** Its modifier combos and Escape also work while typing in a field. */
  inFields?: true;
  /** Enter and Space stay with the focused button unless it opens a reminder. */
  yields?: true;
  /** Shown on the idle details pane. */
  featured?: true;
  /** Returns whether it handled the key, so unhandled keys keep their default. */
  run: (target: Reminder | undefined, openSettings: () => void) => boolean;
}

const GENERAL: readonly Binding[] = [
  { label: 'New reminder', keys: ['n', '/', 'mod+k'], inFields: true, featured: true, run: focusComposer },
  { label: 'Undo', keys: ['mod+z'], run: undo },
  {
    label: 'Settings',
    keys: ['mod+,'],
    inFields: true,
    run: (_, openSettings) => {
      openSettings();
      return true;
    },
  },
  { label: 'Keyboard shortcuts', keys: ['?'], run: showHelp },
  { label: 'Close', keys: ['Escape'], inFields: true, run: escape },
];

const REMINDERS: readonly Binding[] = [
  { label: 'Next reminder', keys: ['j', 'ArrowDown'], featured: true, run: () => move(1) },
  { label: 'Previous reminder', keys: ['k', 'ArrowUp'], run: () => move(-1) },
  {
    label: 'Open',
    keys: ['Enter', 'e'],
    yields: true,
    featured: true,
    run: (target) => act(target, ({ id }) => openEditor(id)),
  },
  {
    label: 'Done',
    keys: ['x', ' '],
    yields: true,
    featured: true,
    run: (target) => act(target, (reminder) => keepSelection(reminder.id, () => complete(reminder))),
  },
  { label: 'Snooze', keys: ['s'], featured: true, run: (target) => act(target, ({ id }) => ui.snooze(id)) },
  {
    label: 'Delete',
    keys: ['Delete', 'Backspace'],
    run: (target) => act(target, (reminder) => keepSelection(reminder.id, () => remove(reminder))),
  },
];

export const FEATURED = [...GENERAL, ...REMINDERS].filter((binding) => binding.featured);

export const GROUPS: readonly { title: string; items: readonly Hint[] }[] = [
  { title: 'General', items: GENERAL },
  { title: 'Reminders', items: REMINDERS },
  {
    title: 'Editing',
    items: [
      { label: 'Save', keys: ['mod+Enter'] },
      { label: 'Pick a snooze time', keys: ['1–5'] },
    ],
  },
];

const NAMES: Record<string, string> = {
  ArrowDown: '↓',
  ArrowUp: '↑',
  ' ': 'Space',
  Delete: 'Del',
  Backspace: '⌫',
  Escape: 'Esc',
};

interface Combo {
  mod: boolean;
  key: string;
}

function combo(key: string): Combo {
  return key.startsWith('mod+') ? { mod: true, key: key.slice(4) } : { mod: false, key };
}

export function keyLabel(key: string): string {
  const { mod, key: base } = combo(key);
  const name = NAMES[base] ?? (base.length === 1 ? base.toUpperCase() : base);
  if (!mod) return name;
  return app.platform === 'mac' || app.platform === 'ios' ? `⌘${name}` : `Ctrl ${name}`;
}

export function tip(label: string, key: string): string {
  return `${label} (${keyLabel(key)})`;
}

function matches({ mod, key }: Combo, event: KeyboardEvent): boolean {
  if (event.altKey || mod !== (event.ctrlKey || event.metaKey) || (mod && event.shiftKey)) return false;
  return event.key === key || event.key.toLowerCase() === key;
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

export function shortcut(event: KeyboardEvent, openSettings: () => void): void {
  if (event.defaultPrevented || ui.menu || document.querySelector('dialog:modal')) return;
  const target = event.target instanceof Element ? event.target : null;
  const typing = isTyping(target);
  const pool = target?.closest('#editor') ? GENERAL : [...GENERAL, ...REMINDERS];
  for (const binding of pool) {
    const hit = binding.keys.map(combo).find((candidate) => matches(candidate, event));
    if (!hit) continue;
    if (typing && !(binding.inFields && (hit.mod || hit.key === 'Escape'))) return;
    if (binding.yields && target?.closest('button, a') && !target.classList.contains('open')) return;
    const focused = rowOf(document.activeElement)?.dataset.reminder;
    if (
      binding.run(
        app.reminders.find((reminder) => reminder.id === focused),
        openSettings,
      )
    )
      event.preventDefault();
    return;
  }
}
