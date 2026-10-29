import {
  REMINDER_STATUSES,
  type AgentAction,
  type AgentRoute,
  type AgentRoutes,
  type Moment,
  type ReminderStatus,
} from '../shared/api';
import { LIMITS, parseFields } from '../shared/input';
import { DURATION, durationMinutes } from '../shared/phrases';
import type { ReminderFields } from '../shared/reminder';
import { parseLocal } from '../shared/time';
import { isUlid } from '../shared/ulid';
import { isInteger, isText } from '../shared/validate';
import { ApiFailure, invalid, record } from './requests';

/** What the Worker hands over for an agent request: the parts of the URL, the Idempotency-Key header and the body. */
export interface AgentEnvelope {
  id: string | null;
  action: string | null;
  key: string | null;
  query: Record<string, string>;
  body: unknown;
}

const SAMPLE: ReminderFields = {
  title: 'Sample',
  notes: '',
  start: '2026-01-01T09:00',
  zone: null,
  repeat: null,
  important: false,
  alerts: [],
};

const EXPECTED: Record<keyof ReminderFields, string> = {
  title: `text, 1 to ${LIMITS.title} characters`,
  notes: `text, up to ${LIMITS.notes} characters`,
  start: 'a wall time like 2026-11-02T18:00',
  zone: 'null to follow the owner, or a time zone like Europe/London',
  repeat:
    'null, or { "rule": an RRULE like "FREQ=WEEKLY;BYDAY=MO", "anchor": "schedule" or "completion" (FREQ and INTERVAL only) }',
  important: 'true or false',
  alerts: `up to ${LIMITS.alerts} distinct whole minutes before it is due, each 1 to ${LIMITS.alertMinutes}`,
};

const FIELD_KEYS = Object.keys(SAMPLE).filter((name): name is keyof ReminderFields => Object.hasOwn(SAMPLE, name));

const MAX_TEXT = 500;
const MAX_SPAN_MINUTES = 366 * 24 * 60;

function assign<K extends keyof ReminderFields>(
  into: Partial<ReminderFields>,
  field: K,
  from: Pick<ReminderFields, K>,
): void {
  into[field] = from[field];
}

function only(body: Record<string, unknown>, allowed: readonly string[]): void {
  const unknown = Object.keys(body).find((name) => !allowed.includes(name));
  if (unknown !== undefined) invalid(`unknown field "${unknown}"; expected some of: ${allowed.join(', ')}`);
}

/** Each field is checked on its own by the same validator ops use, so the error can name it. */
function fieldChanges(body: Record<string, unknown>): Partial<ReminderFields> {
  const fields: Partial<ReminderFields> = {};
  for (const field of FIELD_KEYS) {
    if (!Object.hasOwn(body, field)) continue;
    const parsed = parseFields({ ...SAMPLE, [field]: body[field] }) ?? invalid(`${field}: expected ${EXPECTED[field]}`);
    assign(fields, field, parsed);
  }
  return fields;
}

function json(envelope: Record<string, unknown>, allowed: readonly string[]): Record<string, unknown> {
  const body = envelope.body ?? {};
  const fields = record(body, 'the body must be a JSON object');
  only(fields, allowed);
  return fields;
}

function idempotencyKey({ key }: Record<string, unknown>): string | null {
  if (key === null) return null;
  return isText(key, 200, 1) && /^[\x21-\x7e]+$/.test(key)
    ? key
    : invalid('Idempotency-Key: 1 to 200 visible characters');
}

function reminderId({ id }: Record<string, unknown>): string {
  if (!isUlid(id)) throw new ApiFailure('not_found', 'no reminder with that id');
  return id;
}

function wall(value: unknown, name: string): string | null {
  if (value === undefined || value === null) return null;
  return isText(value, 16) && parseLocal(value)
    ? value
    : invalid(`${name}: expected a wall time like 2026-11-02T18:00`);
}

function revision(value: unknown): number {
  return isInteger(value, 1, Number.MAX_SAFE_INTEGER) ? value : invalid('rev: the rev from your last read is required');
}

const WITH_OFFSET = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

function moment(value: unknown): Moment {
  const text = isText(value, 40, 1) ? value.trim() : '';
  const span = new RegExp(`^(?:in\\s+)?${DURATION}$`).exec(text.toLowerCase());
  const minutes = span ? durationMinutes(span[1] ?? '', span[2] ?? '') : 0;
  if (minutes > 0 && minutes <= MAX_SPAN_MINUTES) return { after: minutes };
  if (parseLocal(text)) return { wall: text };
  // Date.parse rolls impossible dates over (February 30 becomes March 2), so the wall part must be a real time first.
  const offset = WITH_OFFSET.exec(text);
  if (offset && parseLocal(offset[1] ?? '')) return { at: Date.parse(text) };
  return invalid(
    'until: expected a span like "1h" or "3 days", a wall time like 2026-11-02T18:00, or a time with an offset',
  );
}

function action(envelope: Record<string, unknown>): AgentAction {
  const type = envelope.action;
  switch (type) {
    case 'complete':
    case 'skip': {
      const { due } = json(envelope, ['due']);
      return { type, due: wall(due, 'due') };
    }
    case 'reopen': {
      const { rev } = json(envelope, ['rev']);
      return { type, rev: revision(rev) };
    }
    case 'snooze': {
      const { due, until } = json(envelope, ['until', 'due']);
      return { type, due: wall(due, 'due'), until: moment(until) };
    }
    case 'pause': {
      const { until } = json(envelope, ['until']);
      return { type, until: until === undefined || until === null ? null : moment(until) };
    }
    case 'resume':
    case 'delete':
    case 'restore':
      json(envelope, []);
      return { type };
    default:
      throw new ApiFailure('not_found', 'no such action');
  }
}

function status(value: unknown): ReminderStatus {
  if (value === undefined) return 'open';
  return (
    REMINDER_STATUSES.find((known) => known === value) ?? invalid(`status: one of ${REMINDER_STATUSES.join(', ')}`)
  );
}

function limit(value: unknown): number {
  if (value === undefined) return 100;
  const parsed = Number(value);
  return isInteger(parsed, 1, 500) ? parsed : invalid('limit: a whole number from 1 to 500');
}

export const AGENT_REQUESTS: { [R in AgentRoute]: (envelope: unknown) => AgentRoutes[R]['request'] } = {
  list: (value) => {
    const { status: given, q, limit: count } = record(record(value).query);
    return { status: status(given), q: isText(q, 200) ? q.trim() : '', limit: limit(count) };
  },
  today: () => null,
  get: (value) => ({ id: reminderId(record(value)) }),
  create: (value) => {
    const envelope = record(value);
    const body = json(envelope, ['text', ...FIELD_KEYS]);
    const fields = fieldChanges(body);
    if (body.text === undefined) {
      if (fields.title === undefined || fields.start === undefined) invalid('send "text", or "title" and "start"');
      return { key: idempotencyKey(envelope), text: null, fields };
    }
    if (!isText(body.text, MAX_TEXT) || body.text.trim() === '') invalid(`text: 1 to ${MAX_TEXT} characters`);
    return { key: idempotencyKey(envelope), text: body.text, fields };
  },
  update: (value) => {
    const envelope = record(value);
    const body = json(envelope, ['rev', ...FIELD_KEYS]);
    const rev = revision(body.rev);
    const fields = fieldChanges(body);
    if (Object.keys(fields).length === 0) invalid(`nothing to change; send some of: ${FIELD_KEYS.join(', ')}`);
    return { id: reminderId(envelope), key: idempotencyKey(envelope), rev, fields };
  },
  act: (value) => {
    const envelope = record(value);
    return { id: reminderId(envelope), key: idempotencyKey(envelope), action: action(envelope) };
  },
};
