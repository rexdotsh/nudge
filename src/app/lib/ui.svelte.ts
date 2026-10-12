import { MediaQuery } from 'svelte/reactivity';
import type { Reminder } from '../../shared/reminder';
import { Draft } from './draft.svelte';

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
  /** The open editor's changes. It lives here, not in the editor, so a remount (the layout crossing its breakpoint) keeps them. */
  draft: Draft | null = null;

  /** Wide windows dock the editor beside the list instead of covering it. */
  get docked(): boolean {
    return wide.current;
  }

  draftFor(reminder: Reminder): Draft {
    if (this.draft?.id !== reminder.id) this.draft = new Draft(reminder);
    return this.draft;
  }

  edit(id: string): void {
    // Opening another reminder beside the docked editor keeps that editor's changes instead of dropping them.
    if (this.draft && this.draft.id !== id) {
      void this.draft.save();
      this.draft = null;
    }
    this.snoozing = null;
    this.menu = null;
    this.editing = id;
  }

  snooze(id: string): void {
    this.menu = null;
    this.snoozing = id;
  }

  close(): void {
    this.draft = null;
    this.editing = null;
    this.snoozing = null;
  }
}

export const ui = new Ui();
