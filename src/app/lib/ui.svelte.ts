import { MediaQuery, SvelteMap } from 'svelte/reactivity';
import type { Reminder } from '../../shared/reminder';
import { Draft } from './draft.svelte';
import { toasts } from './toasts.svelte';

interface Menu {
  id: string;
  x: number;
  y: number;
  fromKeyboard: boolean;
}

const wide = new MediaQuery('min-width: 960px');
const fine = new MediaQuery('pointer: fine');

class Ui {
  editing = $state<string | null>(null);
  snoozing = $state<string | null>(null);
  menu = $state<Menu | null>(null);
  help = $state(false);
  composing = $state('');
  readonly #drafts = new SvelteMap<string, Draft>();

  get docked(): boolean {
    return wide.current;
  }

  get fine(): boolean {
    return fine.current;
  }

  get idle(): boolean {
    return (
      (this.editing === null || this.docked) &&
      this.snoozing === null &&
      this.menu === null &&
      !this.help &&
      ![...this.#drafts.values()].some((draft) => draft.dirty) &&
      this.composing.trim() === ''
    );
  }

  get draft(): Draft | null {
    return (this.editing !== null && this.#drafts.get(this.editing)) || null;
  }

  draftFor(reminder: Reminder): Draft {
    const existing = this.#drafts.get(reminder.id);
    if (existing) return existing;
    const draft = new Draft(reminder);
    this.#drafts.set(reminder.id, draft);
    return draft;
  }

  edit(id: string): void {
    const leaving = this.draft;
    if (leaving && leaving.id !== id) void this.#leave(leaving);
    this.snoozing = null;
    this.menu = null;
    this.editing = id;
  }

  snooze(id: string): void {
    this.menu = null;
    this.snoozing = id;
  }

  async #leave(draft: Draft): Promise<void> {
    if (draft.parsed === null) {
      toasts.show(`Kept unsaved changes to “${draft.original.title}”`);
      return;
    }
    await draft.save();
    if (this.editing !== draft.id && !draft.dirty) this.#drafts.delete(draft.id);
  }

  close(): void {
    if (this.editing !== null) this.#drafts.delete(this.editing);
    this.editing = null;
    this.snoozing = null;
  }
}

export const ui = new Ui();
