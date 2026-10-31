import { declarativeMessage, type DeclarativeMessage, type DeclarativeNotification } from 'declarative-web-push';
import type { Notice } from './fire';
import { dueAt, isSnoozed, local, type Reminder } from './reminder';
import { MINUTE_MS, wallMs } from './time';

export interface PushData {
  fire: string;
  /** The notice by its occurrence, from `noticeKey`; test pushes and pushes queued before it existed have none. */
  notice?: string;
  reminder: { id: string; due: string } | null;
}

export type NotificationContent = DeclarativeNotification<PushData> & { data: PushData };

export type PushMessage = DeclarativeMessage<NotificationContent>;

function declarative(notification: NotificationContent, appBadge?: number): PushMessage {
  return declarativeMessage({ ...notification, silent: false, renotify: true }, { mutable: true, appBadge });
}

export interface Presentation {
  origin: string;
  zone: string;
  locale: string;
  badge: number;
}

function relative(minutes: number, locale: string): string {
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (minutes < 60) return format.format(minutes, 'minute');
  if (minutes < 60 * 24) return format.format(Math.round(minutes / 60), 'hour');
  return format.format(Math.round(minutes / (60 * 24)), 'day');
}

function bodyFor(reminder: Reminder, notice: Notice, due: number, view: Presentation): string {
  const time = new Intl.DateTimeFormat(view.locale, { timeStyle: 'short', timeZone: view.zone }).format(due);
  const note = reminder.notes.split('\n', 1)[0]?.slice(0, 140) ?? '';
  switch (notice.alert) {
    case 'early':
      return `${relative(Math.round((due - notice.at) / MINUTE_MS), view.locale)} · ${time}`;
    case 'due':
      if (notice.missed > 0) return `Missed ${notice.missed}× · due ${time}`;
      return note || `Due ${time}`;
    case 'snoozed':
      return `Snoozed · was due ${time}`;
    case 'nag':
      return `Still waiting · was due ${time}`;
    default: {
      const unhandled: never = notice.alert;
      return unhandled;
    }
  }
}

// Notices for different occurrences can share an instant, but one occurrence never has two at the same instant.
export function fireId(reminderId: string, { at, due }: Pick<Notice, 'at' | 'due'>): string {
  return `${reminderId}@${at}/${due}`;
}

/**
 * A notice by its occurrence rather than its instant, which moves with the zone: a device that got a notice keeps it
 * as shown when the zone changes, and does not show it again.
 */
export function noticeKey(reminderId: string, { due, slot }: Pick<Notice, 'due' | 'slot'>): string {
  return `${reminderId}:${due}/${slot}`;
}

/** Everything a device records a reminder notice as shown under. */
export function noticeKeys(data: Pick<PushData, 'fire' | 'notice'>): string[] {
  return data.notice === undefined ? [data.fire] : [data.fire, data.notice];
}

type Occurrence = NonNullable<PushData['reminder']>;

function occurrenceTag({ id, due }: Occurrence): string {
  return `${id}:${due}`;
}

/** The occurrence a notification is for, read from its tag: iOS keeps a notification's tag but drops its data. */
export function taggedOccurrence(tag: string): Occurrence | null {
  const at = tag.indexOf(':');
  return at > 0 ? { id: tag.slice(0, at), due: tag.slice(at + 1) } : null;
}

// Unknown reminders and upcoming occurrences keep their notifications.
export function isSettled(shown: Occurrence, reminder: Reminder | undefined, now: number): boolean {
  if (!reminder) return false;
  if (reminder.deleted || reminder.due === null || reminder.paused !== null) return true;
  return shown.due === reminder.due ? isSnoozed(reminder, now) : shown.due < reminder.due;
}

export function isSettledTag(tag: string, reminders: readonly Reminder[], now: number): boolean {
  const shown = taggedOccurrence(tag);
  if (!shown) return false;
  return isSettled(
    shown,
    reminders.find((reminder) => reminder.id === shown.id),
    now,
  );
}

export function occurrenceTopic(reminderId: string, due: string): string {
  return `${reminderId}${(wallMs(local(due)) / MINUTE_MS).toString(36)}`;
}

export function reminderMessage(reminder: Reminder, notice: Notice, view: Presentation): PushMessage {
  const due = dueAt({ ...reminder, due: notice.due }, view.zone) ?? notice.at;
  return declarative(
    {
      title: reminder.title,
      body: bodyFor(reminder, notice, due, view),
      navigate: `${view.origin}/?open=${reminder.id}`,
      tag: occurrenceTag({ id: reminder.id, due: notice.due }),
      requireInteraction: reminder.important && notice.alert !== 'early',
      data: {
        fire: fireId(reminder.id, notice),
        notice: noticeKey(reminder.id, notice),
        reminder: { id: reminder.id, due: notice.due },
      },
    },
    view.badge,
  );
}

export function testMessage(fire: string, view: Presentation): PushMessage {
  return declarative({
    title: 'Notifications work',
    body: 'This is a test from Nudge. Reminders will arrive just like this.',
    navigate: `${view.origin}/?settings`,
    tag: 'test',
    requireInteraction: false,
    data: { fire, reminder: null },
  });
}
