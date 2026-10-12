import type { Op } from './ops';
import type { ReminderFields, Repeat } from './reminder';
import { RuleError, parseRule, type Rule } from './rrule';
import { isTimeZone, parseLocal } from './time';
import { isUlid } from './ulid';
import { isInteger, isRecord, isText } from './validate';

export const LIMITS = {
  title: 200,
  notes: 4000,
  alerts: 4,
  alertMinutes: 60 * 24 * 28,
} as const;

function countsFromCompletion(rule: Rule): boolean {
  const parts = [rule.byMonth, rule.byMonthDay, rule.byDay, rule.byHour, rule.byMinute, rule.bySetPos];
  return parts.every((part) => part.length === 0) && rule.count === null && rule.until === null;
}

export function isRepeat(value: unknown): value is Repeat {
  if (!isRecord(value) || !isText(value.rule, 500, 1)) return false;
  const { rule: text, anchor } = value;
  if (anchor !== 'schedule' && anchor !== 'completion') return false;
  try {
    const rule = parseRule(text);
    return anchor === 'schedule' || countsFromCompletion(rule);
  } catch (error) {
    if (error instanceof RuleError) return false;
    throw error;
  }
}

function isAlerts(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length <= LIMITS.alerts &&
    value.every((minutes) => isInteger(minutes, 1, LIMITS.alertMinutes)) &&
    new Set(value).size === value.length
  );
}

export function parseFields(value: unknown): ReminderFields | null {
  if (!isRecord(value)) return null;
  const { title, notes, start, zone, repeat, important, alerts } = value;
  if (
    !isText(title, LIMITS.title) ||
    title.trim() === '' ||
    !isText(notes, LIMITS.notes) ||
    !isText(start, 16) ||
    !parseLocal(start) ||
    !(zone === null || (isText(zone, 64) && isTimeZone(zone))) ||
    !(repeat === null || isRepeat(repeat)) ||
    typeof important !== 'boolean' ||
    !isAlerts(alerts)
  ) {
    return null;
  }
  return {
    title: title.trim(),
    notes,
    start,
    zone,
    repeat: repeat && { rule: repeat.rule, anchor: repeat.anchor },
    important,
    alerts: alerts.toSorted((a, b) => a - b),
  };
}

export function parseOp(value: unknown): Op | null {
  if (!isRecord(value) || !isUlid(value.id)) return null;
  const { id, type, due } = value;
  const occurrence = isText(due, 16) && parseLocal(due) ? due : null;
  switch (type) {
    case 'put': {
      const fields = parseFields(value.fields);
      return fields === null ? null : { type, id, fields };
    }
    case 'complete':
    case 'skip':
      return occurrence === null ? null : { type, id, due: occurrence };
    case 'reopen':
      return occurrence !== null && isInteger(value.revision, 1, Number.MAX_SAFE_INTEGER)
        ? { type, id, due: occurrence, revision: value.revision }
        : null;
    case 'snooze':
      return occurrence && isInteger(value.until, 0, 8.64e15)
        ? { type, id, due: occurrence, until: value.until }
        : null;
    case 'delete':
    case 'restore':
      return { type, id };
    default:
      return null;
  }
}
