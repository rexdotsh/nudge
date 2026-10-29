import { MediaQuery, SvelteMap } from 'svelte/reactivity';
import type { Reminder } from '../../shared/reminder';
import { Draft } from './draft.svelte';
import { toasts } from './toasts.svelte';

/** A sheet that picks a time for one reminder: when a snooze ends, or until when a series is paused. */
interface TimeSheet {
  kind: 'snooze' | 'pause';
  id: string;
}

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
  sheet = $state<TimeSheet | null>(null);
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
      this.sheet === null &&
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
    this.sheet = null;
    this.menu = null;
    this.editing = id;
  }

  open(kind: TimeSheet['kind'], id: string): void {
    this.menu = null;
    this.sheet = { kind, id };
  }

  /** A docked editor stays beside the list; a sheet editor was only hidden behind the time sheet and goes too. */
  closeSheet(): void {
    if (this.docked) this.sheet = null;
    else this.close();
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
    this.sheet = null;
  }
}

export const ui = new Ui();
