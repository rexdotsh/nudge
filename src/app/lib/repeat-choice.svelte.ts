import { parseQuickAdd } from '../../shared/quick-add';
import type { Repeat } from '../../shared/reminder';
import { app } from './app.svelte';

export const PRESETS = {
  none: { label: 'Never', rule: null },
  daily: { label: 'Every day', rule: 'FREQ=DAILY' },
  weekdays: { label: 'Weekdays', rule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' },
  weekly: { label: 'Every week', rule: 'FREQ=WEEKLY' },
  biweekly: { label: 'Every 2 weeks', rule: 'FREQ=WEEKLY;INTERVAL=2' },
  monthly: { label: 'Every month', rule: 'FREQ=MONTHLY' },
  yearly: { label: 'Every year', rule: 'FREQ=YEARLY' },
} as const;

type Preset = keyof typeof PRESETS;
type Choice = Preset | 'custom' | 'type';

export const isPreset = (value: string): value is Preset => Object.hasOwn(PRESETS, value);
const isChoice = (value: string): value is Choice => isPreset(value) || value === 'custom' || value === 'type';

function choiceOf(repeat: Repeat | null): Choice {
  if (repeat === null) return 'none';
  if (repeat.anchor !== 'schedule') return 'custom';
  const preset = Object.entries(PRESETS).find(([, { rule }]) => rule === repeat.rule)?.[0];
  return preset !== undefined && isPreset(preset) ? preset : 'custom';
}

/** The editor's repeat: a preset, the reminder's own custom repeat, or one typed in words. */
export class RepeatChoice {
  readonly #initial: Repeat | null;
  selected: Choice = $state('none');
  phrase = $state('');
  readonly #typed = $derived(
    this.phrase.trim() === '' ? null : parseQuickAdd(`x ${this.phrase}`, app.now, app.zone).repeat,
  );

  constructor(initial: Repeat | null) {
    this.#initial = initial;
    this.selected = choiceOf(initial);
  }

  get custom(): Repeat | null {
    return this.phrase.trim() === '' ? this.#initial : this.#typed;
  }

  get repeat(): Repeat | null {
    if (!isPreset(this.selected)) return this.custom;
    const { rule } = PRESETS[this.selected];
    return rule === null ? null : { rule, anchor: 'schedule' };
  }

  /** False while typed words aren't understood, so saving can't silently drop the repeat. */
  get understood(): boolean {
    return isPreset(this.selected) || this.phrase.trim() === '' || this.#typed !== null;
  }

  select(value: string): void {
    if (isChoice(value)) this.selected = value;
  }
}
