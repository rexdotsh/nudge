import type { Notice } from './fire';
import { dueAt, local, type Reminder } from './reminder';
import { MINUTE_MS, wallMs } from './time';

export interface PushData {
  fire: string;
  reminder: { id: string; due: string } | null;
}

export interface NotificationContent {
  title: string;
  body: string;
  navigate: string;
  tag: string;
  silent: false;
  app_badge?: string;
  data: PushData;
}

function declarative(notification: Omit<NotificationContent, 'silent'>): PushMessage {
  return { web_push: 8030, mutable: true, notification: { ...notification, silent: false } };
}

export interface PushMessage {
  web_push: 8030;
  mutable: true;
  notification: NotificationContent;
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

export function fireId(reminderId: string, at: number): string {
  return `${reminderId}@${at}`;
}

function occurrenceTag(reminderId: string, due: string): string {
  return `${reminderId}:${due}`;
}

export function occurrenceTopic(reminderId: string, due: string): string {
  return `${reminderId}${(wallMs(local(due)) / MINUTE_MS).toString(36)}`;
}

export function reminderMessage(reminder: Reminder, notice: Notice, view: Presentation): PushMessage {
  const due = dueAt({ ...reminder, due: notice.due }, view.zone) ?? notice.at;
  return declarative({
    title: reminder.title,
    body: bodyFor(reminder, notice, due, view),
    navigate: `${view.origin}/?open=${reminder.id}`,
    tag: occurrenceTag(reminder.id, notice.due),
    app_badge: String(view.badge),
    data: { fire: fireId(reminder.id, notice.at), reminder: { id: reminder.id, due: notice.due } },
  });
}

export function testMessage(fire: string, view: Presentation): PushMessage {
  return declarative({
    title: 'Notifications work',
    body: 'This is a test from Nudge. Reminders will arrive just like this.',
    navigate: `${view.origin}/?settings`,
    tag: 'test',
    data: { fire, reminder: null },
  });
}
