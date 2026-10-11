class Ui {
  editing = $state<string | null>(null);
  snoozing = $state<string | null>(null);

  edit(id: string): void {
    this.snoozing = null;
    this.editing = id;
  }

  snooze(id: string): void {
    this.snoozing = id;
  }

  close(): void {
    this.editing = null;
    this.snoozing = null;
  }
}

export const ui = new Ui();
