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
    create: async ({ key, text, fields }, { caller, now }) => {
      const typed =
        text === null
          ? null
          : { text, ...(fieldsFromText(text, now, this.scheduler.zone()) ?? invalid('text: it has no title')) };
      const merged = parseFields({ ...(typed?.fields ?? BLANK), ...fields }) ?? invalid('invalid reminder');
      const { reminder, replayed } = await this.write(key, caller, now, null, () => ({
        type: 'put',
        id: ulid(now),
        fields: merged,
      }));
      return {
        reminder: this.view(reminder, now),
        understood: typed && !replayed ? understood(typed.text, merged, typed.parsed) : null,
      };
    },
    update: async ({ id, key, rev, fields }, { caller, now }) => {
      const plan = this.existing(id, (current) => {
        if (current.deleted) missing();
        if (current.revision !== rev) {
          throw new Conflict(`rev ${rev} is stale; it is now ${current.revision}`, this.view(current, now));
        }
        return { type: 'put', id, fields: parseFields({ ...fieldsOf(current), ...fields }) ?? invalid() };
      });
      return this.view((await this.write(key, caller, now, id, plan)).reminder, now);
    },
    act: async ({ id, key, action }, { caller, now }) => {
      const plan = this.existing(id, (current) => this.op(action, current, now));
      return this.view((await this.write(key, caller, now, id, plan)).reminder, now);
    },
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
      case 'reopen':
        return {
          type: 'reopen',
          id,
          due:
            action.due ??
            (current.due === null
              ? current.start
              : refuse('it is not done; to undo completing a repeat, send the due you completed')),
          revision: current.revision,
        };
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
   * Applies one change at most once per Idempotency-Key: a retry changes nothing and gets the reminder as it is now.
   * `id` is the reminder the change is for, or null when it makes a new one.
   */
  private async write(
    key: string | null,
    caller: DeviceRow,
    now: number,
    id: string | null,
    plan: () => Op,
  ): Promise<{ reminder: Reminder; replayed: boolean }> {
    const opId = key === null ? ulid(now) : `agent:${caller.id}:${key}`;
    const result = this.runtime.transaction(() => {
      const replay = this.store.appliedTo(opId);
      if (replay) {
        if (replay.reminder === null || (id !== null && replay.reminder !== id)) {
          invalid('Idempotency-Key: already used for another reminder');
        }
        return { reminder: this.store.reminder(replay.reminder) ?? missing(), replayed: true };
      }
      const op = plan();
      const next = this.scheduler.commit(opId, op, now, now);
      if (next) return { reminder: next, replayed: false };
      const current = this.store.reminder(op.id) ?? missing();
      throw new Conflict(refusal(op, current), this.view(current, now));
    });
    await this.scheduler.rearm();
    this.runtime.broadcast({ kind: 'changed', version: this.store.version() });
    return result;
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
