import { parseFields } from '../../shared/input';
import { fieldsOf, type Reminder, type ReminderFields } from '../../shared/reminder';
import { app } from './app.svelte';
import { RepeatChoice } from './repeat-choice.svelte';
import { toasts } from './toasts.svelte';

/** The editor's unsaved changes to one reminder, kept apart from the view so a layout change never resets them. */
export class Draft {
  /** What the draft started from, or what it last saved. */
  original: Reminder;
  readonly repeat: RepeatChoice;
  title = $state('');
  notes = $state('');
  date = $state('');
  time = $state('');
  important = $state(false);
  alerts = $state<number[]>([]);
  pinned = $state(false);
  showZone = $state(false);

  readonly fields = $derived.by<ReminderFields>(() => ({
    title: this.title.trim(),
    notes: this.notes,
    start: `${this.date}T${this.time}`,
    zone: this.pinned ? (this.original.zone ?? app.zone) : null,
    repeat: this.repeat.repeat,
    important: this.important,
    alerts: this.alerts.toSorted((a, b) => a - b),
  }));
  readonly parsed = $derived.by(() => (this.repeat.understood ? parseFields(this.fields) : null));
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
    this.alerts = [...original.alerts];
    this.pinned = original.zone !== null;
    this.showZone = original.zone !== null || app.travelling;
  }

  get id(): string {
    return this.original.id;
  }

  toggleAlert(minutes: number): void {
    this.alerts = this.alerts.includes(minutes)
      ? this.alerts.filter((value) => value !== minutes)
      : [...this.alerts, minutes];
  }

  async persist(): Promise<void> {
    if (!this.parsed || !this.changed) return;
    const saved = await app.apply({ type: 'put', id: this.id, fields: this.parsed });
    if (saved) this.original = $state.snapshot(saved);
  }

  /** Persists any change and says so; the editor stays or goes as its caller decides. */
  async save(): Promise<void> {
    const changed = this.changed;
    await this.persist();
    if (changed) toasts.show('Saved');
  }
}
