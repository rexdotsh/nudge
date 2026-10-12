import { MediaQuery } from 'svelte/reactivity';

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
  /** Set by the open editor: opening another reminder beside it saves its edits instead of dropping them. */
  keepEdits: (() => void) | null = null;

  /** Wide windows dock the editor beside the list instead of covering it. */
  get docked(): boolean {
    return wide.current;
  }

  edit(id: string): void {
    if (this.editing !== null && this.editing !== id) this.keepEdits?.();
    this.snoozing = null;
    this.menu = null;
    this.editing = id;
  }

  snooze(id: string): void {
    this.menu = null;
    this.snoozing = id;
  }

  close(): void {
    this.editing = null;
    this.snoozing = null;
  }
}

export const ui = new Ui();
