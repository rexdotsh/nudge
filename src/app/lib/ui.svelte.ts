import { MediaQuery, SvelteMap } from 'svelte/reactivity';
import type { Reminder } from '../../shared/reminder';
import { Draft } from './draft.svelte';
import { toasts } from './toasts.svelte';

interface Menu {
  id: string;
  x: number;
  y: number;
}

const wide = new MediaQuery('min-width: 960px');

class Ui {
  editing = $state<string | null>(null);
  snoozing = $state<string | null>(null);
  menu = $state<Menu | null>(null);
  help = $state(false);
  composing = $state('');
  /** Unsaved changes by reminder. They live here, not in the editor, and stay until saved or discarded, so neither a
   * remount (the layout crossing its breakpoint) nor opening another reminder loses them. */
  readonly #drafts = new SvelteMap<string, Draft>();

  /** Wide windows dock the editor beside the list instead of covering it. */
  get docked(): boolean {
    return wide.current;
  }

  /** Nothing typed or open that a reload would lose. */
  get idle(): boolean {
    return (
      this.editing === null &&
      this.snoozing === null &&
      this.menu === null &&
      !this.help &&
      this.#drafts.size === 0 &&
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

  /** Opening another reminder beside the docked editor saves this one's changes, or keeps them if they can't be saved yet. */
  async #leave(draft: Draft): Promise<void> {
    if (draft.parsed === null) {
      toasts.show(`Kept unsaved changes to “${draft.original.title}”`);
      return;
    }
    await draft.save();
    if (this.editing !== draft.id) this.#drafts.delete(draft.id);
  }

  /** Closing the editor ends its draft: callers have saved it already, or the user discarded it. */
  close(): void {
    if (this.editing !== null) this.#drafts.delete(this.editing);
    this.editing = null;
    this.snoozing = null;
  }
}

export const ui = new Ui();
