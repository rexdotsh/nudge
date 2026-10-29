import type {
  AgentAction,
  AgentReminder,
  AgentRoute,
  AgentRoutes,
  Moment,
  ReminderStatus,
  Understood,
} from '../shared/api';
import { parseFields } from '../shared/input';
import type { Op } from '../shared/ops';
import { fieldsFromText, type QuickAdd } from '../shared/quick-add';
import { fieldsOf, local, shownAt, snoozeFrom, type Reminder, type ReminderFields } from '../shared/reminder';
import type { SpanKind } from '../shared/scanner';
import { MINUTE_MS, formatInstant, toInstant } from '../shared/time';
import { sections } from '../shared/triage';
import { ulid } from '../shared/ulid';
import { AGENT_REQUESTS } from './agent-requests';
import { agentReminder } from './agent-view';
import type { DeviceRow } from './devices';
import { ApiFailure, Conflict, invalid, type Handlers } from './requests';
import type { Runtime } from './runtime';
import type { Scheduler } from './scheduler';
import type { Store } from './store';

const RATE_LIMIT = 120;

const BLANK: ReminderFields = {
  title: '',
  notes: '',
  start: '',
  zone: null,
  repeat: null,
  important: false,
  alerts: [],
};

const STATUS: Record<ReminderStatus, (reminder: Reminder) => boolean> = {
  open: (reminder) => !reminder.deleted && reminder.due !== null,
  done: (reminder) => !reminder.deleted && reminder.due === null,
  deleted: (reminder) => reminder.deleted,
  all: () => true,
};

interface Context {
  caller: DeviceRow;
  now: number;
}

function missing(): never {
  throw new ApiFailure('not_found', 'no reminder with that id');
}

function understood(text: string, { title, important }: ReminderFields, { spans, timed }: QuickAdd): Understood {
  const phrase = (kind: SpanKind) =>
    spans
      .filter((span) => span.kind === kind)
      .map((span) => text.slice(span.start, span.end))
      .join(' ') || null;
  return { title, when: phrase('when'), repeat: phrase('repeat'), important, timed };
}

/** Why an op that was refused changed nothing, for the ones that can be refused. */
function refusal(op: Op, current: Reminder): string {
  if (op.type === 'reopen') return `rev ${op.revision} is stale; it changed since it was completed`;
  if (op.type === 'resume') return 'it is not paused';
  if (op.type === 'pause') return current.repeat ? 'the series has ended' : 'only repeating reminders can be paused';
  if (current.paused) return 'it is paused; resume it first';
  if (op.type === 'skip' && !current.repeat) return 'only repeating reminders can be skipped; complete it instead';
  return current.due === null ? 'it is done; nothing is due' : `that is not the current occurrence, ${current.due} is`;
}

export class Agents {
  private readonly calls = new Map<string, number[]>();

  constructor(
    private readonly store: Store,
    private readonly scheduler: Scheduler,
    private readonly runtime: Runtime,
  ) {}

  async call<R extends AgentRoute>(
    route: R,
    caller: DeviceRow,
    envelope: unknown,
  ): Promise<AgentRoutes[R]['response']> {
    const now = this.runtime.now();
    const recent = (this.calls.get(caller.id) ?? []).filter((at) => now - at < MINUTE_MS);
    if (recent.length >= RATE_LIMIT) throw new ApiFailure('locked', 'too many requests; wait a minute');
    this.calls.set(caller.id, [...recent, now]);
    const request = AGENT_REQUESTS[route](envelope);
    this.store.devices.seen(caller.id, now);
    return this.handlers[route](request, { caller, now });
  }

  private readonly handlers: Handlers<AgentRoutes, Context> = {
    list: ({ status, q, limit }, { now }) => {
      const zone = this.scheduler.zone();
      const needle = q.toLowerCase();
      const matches = this.store
        .reminders()
        .filter((reminder) => STATUS[status](reminder))
        .filter((reminder) => `${reminder.title}\n${reminder.notes}`.toLowerCase().includes(needle))
        .toSorted(
          (a, b) =>
            (shownAt(a, now, zone) ?? Infinity) - (shownAt(b, now, zone) ?? Infinity) || b.updatedAt - a.updatedAt,
        );
      return { ...this.snapshot(now), reminders: matches.slice(0, limit).map((reminder) => this.view(reminder, now)) };
    },
    today: (_, { now }) => {
      const { late, today, later } = sections(this.store.reminders(), now, this.scheduler.zone());
      const view = ({ reminder }: { reminder: Reminder }) => this.view(reminder, now);
      return {
        ...this.snapshot(now),
        late: late.map(view),
        today: today.map(view),
        next: later[0] ? view(later[0]) : null,
      };
    },
    get: ({ id }, { now }) => this.view(this.store.reminder(id) ?? missing(), now),
    create: ({ key, text, fields }, { caller, now }) => {
      const typed =
        text === null
          ? null
          : { text, ...(fieldsFromText(text, now, this.scheduler.zone()) ?? invalid('text: it has no title')) };
      const merged = parseFields({ ...(typed?.fields ?? BLANK), ...fields }) ?? invalid('invalid reminder');
      return this.write(
        { caller, now, key, request: ['create', text, fields] },
        () => ({ type: 'put', id: ulid(now), fields: merged }),
        (reminder) => ({
          reminder: this.view(reminder, now),
          understood: typed && understood(typed.text, merged, typed.parsed),
        }),
      );
    },
    update: ({ id, key, rev, fields }, { caller, now }) =>
      this.write(
        { caller, now, key, request: ['update', id, rev, fields] },
        this.existing(id, (current) => {
          if (current.deleted) missing();
          if (current.revision !== rev) {
            throw new Conflict(`rev ${rev} is stale; it is now ${current.revision}`, this.view(current, now));
          }
          return { type: 'put', id, fields: parseFields({ ...fieldsOf(current), ...fields }) ?? invalid() };
        }),
        (reminder) => this.view(reminder, now),
      ),
    act: ({ id, key, action }, { caller, now }) =>
      this.write(
        { caller, now, key, request: ['act', id, action] },
        this.existing(id, (current) => this.op(action, current, now)),
        (reminder) => this.view(reminder, now),
      ),
  };

  private op(action: AgentAction, current: Reminder, now: number): Op {
    const { id } = current;
    if (current.deleted && action.type !== 'restore' && action.type !== 'delete') missing();
    const zone = this.scheduler.zone();
    const refuse = (message: string): never => {
      throw new Conflict(message, this.view(current, now));
    };
    const future = (moment: Moment, from: number) => {
      const at =
        'after' in moment
          ? from + moment.after * MINUTE_MS
          : 'wall' in moment
            ? toInstant(local(moment.wall), zone)
            : moment.at;
      return at > now ? at : invalid('until: must be in the future');
    };
    switch (action.type) {
      case 'complete':
      case 'skip':
        return { type: action.type, id, due: action.due ?? current.due ?? refuse('it is done; nothing is due') };
      case 'snooze':
        return {
          type: 'snooze',
          id,
          due: action.due ?? current.due ?? refuse('it is done; nothing is due'),
          until: future(action.until, snoozeFrom(current, now, zone)),
        };
      // Like the app's undo, only a finished one-off goes back, to its own time and only if nothing changed since: the
      // occurrence a completed repeat moved on from is not kept, so it cannot be told apart from an invented one.
      case 'reopen':
        if (current.due !== null || current.repeat !== null) refuse('only a completed one-off can be reopened');
        return { type: 'reopen', id, due: current.start, revision: action.rev };
      case 'pause':
        return { type: 'pause', id, until: action.until && future(action.until, now) };
      case 'resume':
      case 'delete':
      case 'restore':
        return { type: action.type, id };
      default: {
        const unhandled: never = action;
        return unhandled;
      }
    }
  }

  /**
   * Applies one change at most once per Idempotency-Key. A retry of the same request changes nothing and gets the
   * response the first one got; the key used for any other request is refused.
   */
  private async write<T>(
    { caller, now, key, request }: { caller: DeviceRow; now: number; key: string | null; request: unknown[] },
    plan: () => Op,
    respond: (reminder: Reminder) => T,
  ): Promise<T> {
    const opId = key === null ? ulid(now) : `agent:${caller.id}:${key}`;
    const fingerprint = JSON.stringify(request);
    const response = this.runtime.transaction((): T => {
      const used = key === null ? undefined : this.store.agentKey(opId);
      if (used) {
        if (used.request !== fingerprint) {
          throw new ApiFailure('unprocessable', 'Idempotency-Key: already used for a different request');
        }
        return JSON.parse(used.response);
      }
      const op = plan();
      const next = this.scheduler.commit(opId, op, now, now);
      if (!next) {
        const current = this.store.reminder(op.id) ?? missing();
        throw new Conflict(refusal(op, current), this.view(current, now));
      }
      const answer = respond(next);
      if (key !== null) this.store.recordAgentKey(opId, fingerprint, JSON.stringify(answer));
      return answer;
    });
    await this.scheduler.rearm();
    this.runtime.broadcast({ kind: 'changed', version: this.store.version() });
    return response;
  }

  private existing(id: string, build: (current: Reminder) => Op): () => Op {
    return () => build(this.store.reminder(id) ?? missing());
  }

  private view(reminder: Reminder, now: number): AgentReminder {
    return agentReminder(reminder, now, this.scheduler.zone(), this.store.meta('locale') ?? 'en');
  }

  private snapshot(now: number) {
    const zone = this.scheduler.zone();
    return { zone, now: formatInstant(now, zone) };
  }
}
