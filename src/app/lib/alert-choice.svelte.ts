import { LIMITS } from '../../shared/input';
import { sortedUnique } from '../../shared/numbers';
import { leadMinutes } from '../../shared/phrases';

export const PRESET_ALERTS = [5, 15, 60, 24 * 60];

type Typed =
  | { kind: 'empty' }
  | { kind: 'unclear' }
  | { kind: 'long' }
  | { kind: 'full' }
  | { kind: 'chosen'; minutes: number }
  | { kind: 'new'; minutes: number };

export class AlertChoice {
  chosen = $state<number[]>([]);
  phrase = $state('');
  typing = $state(false);

  readonly typed = $derived.by((): Typed => {
    if (this.phrase.trim() === '') return { kind: 'empty' };
    const minutes = leadMinutes(this.phrase);
    if (minutes === null) return { kind: 'unclear' };
    if (minutes > LIMITS.alertMinutes) return { kind: 'long' };
    if (this.chosen.includes(minutes)) return { kind: 'chosen', minutes };
    return this.full ? { kind: 'full' } : { kind: 'new', minutes };
  });

  constructor(initial: readonly number[]) {
    this.chosen = [...initial];
  }

  get minutes(): number[] {
    const { typed } = this;
    return sortedUnique(typed.kind === 'new' ? [...this.chosen, typed.minutes] : this.chosen);
  }

  get custom(): number[] {
    return sortedUnique(this.chosen.filter((minutes) => !PRESET_ALERTS.includes(minutes)));
  }

  get full(): boolean {
    return this.chosen.length >= LIMITS.alerts;
  }

  get understood(): boolean {
    const { kind } = this.typed;
    return kind === 'empty' || kind === 'chosen' || kind === 'new';
  }

  toggle(minutes: number): void {
    if (this.chosen.includes(minutes)) this.chosen = this.chosen.filter((value) => value !== minutes);
    else if (!this.full) this.chosen = [...this.chosen, minutes];
  }

  open(): void {
    this.typing = true;
  }

  apply(): void {
    const { typed } = this;
    if (typed.kind !== 'new') return;
    this.chosen = [...this.chosen, typed.minutes];
    this.cancel();
  }

  cancel(): void {
    this.typing = false;
    this.phrase = '';
  }
}
