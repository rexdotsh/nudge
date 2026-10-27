import { parseFields } from '../../shared/input';
import { fieldsOf, type Reminder, type ReminderFields } from '../../shared/reminder';
import { AlertChoice } from './alert-choice.svelte';
import { app } from './app.svelte';
import { RepeatChoice } from './repeat-choice.svelte';
import { toasts } from './toasts.svelte';

export class Draft {
  original: Reminder;
  readonly repeat: RepeatChoice;
  readonly alerts: AlertChoice;
  title = $state('');
  notes = $state('');
  date = $state('');
  time = $state('');
  important = $state(false);
  pinned = $state(false);
  showZone = $state(false);

  readonly fields = $derived.by<ReminderFields>(() => ({
    title: this.title.trim(),
    notes: this.notes,
    start: `${this.date}T${this.repeat.time ?? this.time}`,
    zone: this.pinned ? (this.original.zone ?? app.zone) : null,
    repeat: this.repeat.repeat,
    important: this.important,
    alerts: this.alerts.minutes,
  }));
  readonly parsed = $derived.by(() =>
    this.repeat.understood && this.alerts.understood ? parseFields(this.fields) : null,
  );
  get dirty(): boolean {
    return this.parsed === null || this.changed;
  }

  readonly changed = $derived.by(
    () => this.parsed !== null && JSON.stringify(this.parsed) !== JSON.stringify(fieldsOf(this.original)),
  );

  constructor(reminder: Reminder) {
    const original = $state.snapshot(reminder);
    this.original = $state.raw(original);
    this.repeat = new RepeatChoice(original.repeat);
    this.title = original.title;
    this.notes = original.notes;
    this.date = original.start.slice(0, 10);
    this.time = original.start.slice(11, 16);
    this.important = original.important;
    this.alerts = new AlertChoice(original.alerts);
    this.pinned = original.zone !== null;
    this.showZone = original.zone !== null || app.travelling || app.zoneControls;
  }

  get id(): string {
    return this.original.id;
  }

  applyRepeat(): void {
    this.time = this.repeat.time ?? this.time;
    this.repeat.apply();
  }

  async persist(): Promise<void> {
    if (!this.parsed || !this.changed) return;
    const saved = await app.apply({ type: 'put', id: this.id, fields: this.parsed });
    if (saved) this.original = $state.snapshot(saved);
  }

  async save(): Promise<void> {
    const changed = this.changed;
    await this.persist();
    if (changed) toasts.show('Saved');
  }
}
