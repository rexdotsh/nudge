import { parseQuickAdd } from '../../shared/quick-add';
import type { Repeat } from '../../shared/reminder';
import type { Span } from '../../shared/scanner';
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
type Settled = Preset | 'custom';
type Choice = Settled | 'type';

const TITLE = 'x ';

export const isPreset = (value: string): value is Preset => Object.hasOwn(PRESETS, value);
const isChoice = (value: string): value is Choice => isPreset(value) || value === 'custom' || value === 'type';

function choiceOf(repeat: Repeat | null): Settled {
  if (repeat === null) return 'none';
  if (repeat.anchor !== 'schedule') return 'custom';
  const preset = Object.entries(PRESETS).find(([, { rule }]) => rule === repeat.rule)?.[0];
  return preset !== undefined && isPreset(preset) ? preset : 'custom';
}

export class RepeatChoice {
  selected: Choice = $state('none');
  phrase = $state('');
  #custom: Repeat | null = $state(null);
  #previous: Settled = 'none';
  readonly #parsed = $derived(
    this.phrase.trim() === '' ? null : parseQuickAdd(`${TITLE}${this.phrase}`, app.now, app.zone),
  );

  constructor(initial: Repeat | null) {
    this.selected = choiceOf(initial);
    if (this.selected === 'custom') this.#custom = initial;
  }

  get custom(): Repeat | null {
    return this.#custom;
  }

  get typed(): Repeat | null {
    return this.selected === 'type' ? (this.#parsed?.repeat ?? null) : null;
  }

  get time(): string | null {
    const start = this.#parsed?.start;
    return this.typed && this.#parsed?.timed && start ? start.slice(11, 16) : null;
  }

  get spans(): Span[] {
    if (!this.typed || !this.#parsed) return [];
    return this.#parsed.spans
      .filter((span) => span.kind !== 'flag')
      .map(({ start, end, kind }) => ({ start: start - TITLE.length, end: end - TITLE.length, kind }));
  }

  get repeat(): Repeat | null {
    return this.selected === 'type' ? (this.typed ?? this.#settled(this.#previous)) : this.#settled(this.selected);
  }

  get understood(): boolean {
    return this.selected !== 'type' || this.phrase.trim() === '' || this.typed !== null;
  }

  select(value: string): void {
    if (!isChoice(value)) return;
    if (value === 'type' && this.selected !== 'type') this.#previous = this.selected;
    this.selected = value;
    this.phrase = '';
  }

  apply(): void {
    const typed = this.typed;
    if (!typed) return;
    this.select(choiceOf(typed));
    if (this.selected === 'custom') this.#custom = typed;
  }

  cancel(): void {
    this.select(this.#previous);
  }

  #settled(choice: Settled): Repeat | null {
    if (choice === 'custom') return this.#custom;
    const { rule } = PRESETS[choice];
    return rule === null ? null : { rule, anchor: 'schedule' };
  }
}
