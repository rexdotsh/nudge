export interface Toast {
  id: number;
  message: string;
  undo?: () => void;
}

const DURATION_MS = 4500;

class Toasts {
  current = $state<Toast | null>(null);
  private next = 1;
  private timer: ReturnType<typeof setTimeout> | undefined;

  show(message: string, undo?: () => void): void {
    clearTimeout(this.timer);
    this.current = { id: this.next++, message, undo };
    this.timer = setTimeout(() => this.dismiss(), DURATION_MS);
  }

  dismiss(): void {
    clearTimeout(this.timer);
    this.current = null;
  }
}

export const toasts = new Toasts();
