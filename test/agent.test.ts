import { beforeEach, describe, expect, test } from 'bun:test';
import type { AgentRoute, DeviceRoute } from '../src/shared/api';
import { fieldsFromText } from '../src/shared/quick-add';
import { HOUR_MS } from '../src/shared/time';
import { ulid } from '../src/shared/ulid';
import type { AgentEnvelope } from '../src/worker/agent-requests';
import { verifyToken } from '../src/worker/tokens';
import { AUTH, SETUP_CODE, ZONE, device, harness, keys } from './harness';

let h: ReturnType<typeof harness>;
let phone: string;
let agent: string;

const envelope = (parts: Partial<AgentEnvelope> = {}): AgentEnvelope => ({
  id: null,
  action: null,
  key: null,
  query: {},
  body: null,
  ...parts,
});

async function connect(name = 'Claude', id = ulid(h.state.now)) {
  const { token } = await h.ok('agent', { id, name }, phone);
  const agentId = await verifyToken(AUTH, token);
  if (agentId === null) throw new Error('the agent token does not verify');
  return agentId;
}

const call = (route: AgentRoute, parts: Partial<AgentEnvelope> = {}, caller = agent) =>
  h.call(route, envelope(parts), caller);
const create = (body: unknown, key: string | null = null, caller = agent) =>
  h.ok('create', envelope({ body, key }), caller);
const act = (parts: Partial<AgentEnvelope>) => h.ok('act', envelope(parts), agent);
const TOMORROW = '2026-10-13T09:00';
const everything = () => h.ok('list', envelope({ query: { status: 'all' } }), agent);

beforeEach(async () => {
  h = harness();
  phone = (await h.ok('setup', { code: SETUP_CODE, device: device('iPhone') })).deviceId;
  agent = await connect();
});

describe('agent tokens', () => {
  test.each<[DeviceRoute, unknown]>([
    ['pair', null],
    ['subscribe', keys(1)],
    ['health', null],
    ['revoke', { id: ulid() }],
    ['test', { id: ulid(), delay: 0 }],
    ['receipt', { fire: 'x' }],
    ['sync', { since: 0, zone: 'UTC', changes: [] }],
    ['agent', { id: ulid(), name: 'Another' }],
  ])('an agent cannot use the device route %s', async (route, body) => {
    expect(await h.call(route, body, agent)).toMatchObject({ ok: false, error: 'forbidden' });
  });

  test('an agent cannot open a socket or fetch the Windows app', () => {
    expect(h.nudge.canConnect(agent)).toBe(false);
    expect(h.nudge.canConnect(phone)).toBe(true);
  });

  test('a removed agent is turned away, and its id cannot mint a token again', async () => {
    const id = ulid(h.state.now);
    const removed = await connect('opencode', id);
    expect((await call('list', {}, removed)).ok).toBe(true);
    await h.ok('revoke', { id: removed }, phone);
    expect(await call('list', {}, removed)).toMatchObject({ ok: false, error: 'unauthorized' });
    expect(await h.call('agent', { id, name: 'opencode' }, phone)).toMatchObject({ ok: false, error: 'bad_request' });
  });

  test('a retried connect returns a token for the same agent, but a device id never becomes an agent', async () => {
    const id = ulid(h.state.now);
    expect(await connect('opencode', id)).toBe(await connect('opencode', id));
    expect(await h.call('agent', { id: phone, name: 'Sneaky' }, phone)).toMatchObject({
      ok: false,
      error: 'bad_request',
    });
    expect(h.nudge.canConnect(phone)).toBe(true);
  });
});

describe('agent writes', () => {
  test('a create retried with the same key makes one reminder', async () => {
    const first = await create({ text: 'call mom sunday 6pm' }, 'create-1');
    const again = await create({ text: 'call mom sunday 6pm' }, 'create-1');
    expect(again.reminder.id).toBe(first.reminder.id);
    expect((await everything()).reminders).toHaveLength(1);
  });

  test('keys belong to one agent, so another agent using the same key makes its own reminder', async () => {
    const other = await connect('opencode');
    const mine = await create({ text: 'pay rent tomorrow' }, 'same');
    const theirs = await create({ text: 'pay rent tomorrow' }, 'same', other);
    expect(theirs.reminder.id).not.toBe(mine.reminder.id);
  });

  test.each<[string, Partial<AgentEnvelope>]>([
    ['complete', { action: 'complete' }],
    ['skip', { action: 'skip' }],
    ['snooze', { action: 'snooze', body: { until: '1h' } }],
    ['pause', { action: 'pause', body: { until: '3 days' } }],
    ['delete', { action: 'delete' }],
  ])('%s retried with the same key changes the reminder once', async (_, parts) => {
    const { reminder } = await create({ text: 'water plants every day 9am' });
    const first = await act({ ...parts, id: reminder.id, key: 'act-1' });
    h.state.now += HOUR_MS;
    const again = await act({ ...parts, id: reminder.id, key: 'act-1' });
    expect([again.rev, again.due]).toEqual([first.rev, first.due]);
  });

  test('an update retried with the same key applies once, even though its rev is now stale', async () => {
    const { reminder } = await create({ text: 'pay rent tomorrow 10am' });
    const update = envelope({ id: reminder.id, key: 'edit-1', body: { rev: reminder.rev, title: 'Pay the rent' } });
    const first = await h.ok('update', update, agent);
    expect(await h.ok('update', update, agent)).toEqual(first);
  });

  test('a key used for one reminder cannot be reused for another', async () => {
    const one = await create({ text: 'one tomorrow' });
    const two = await create({ text: 'two tomorrow' });
    await act({ id: one.reminder.id, action: 'delete', key: 'k' });
    const reused = await call('act', { id: two.reminder.id, action: 'delete', key: 'k' });
    expect(reused).toMatchObject({ ok: false, error: 'bad_request' });
    expect((await h.ok('get', envelope({ id: two.reminder.id }), agent)).deleted).toBe(false);
  });

  test('an edit from a stale rev is refused with the current reminder, and changes nothing', async () => {
    const { reminder } = await create({ text: 'pay rent tomorrow 10am' });
    await act({ id: reminder.id, action: 'snooze', body: { until: '1h' } });
    const stale = await call('update', { id: reminder.id, body: { rev: reminder.rev, title: 'Changed' } });
    expect(stale).toMatchObject({
      ok: false,
      error: 'conflict',
      current: { title: 'pay rent', rev: reminder.rev + 1 },
    });
    expect((await h.ok('get', envelope({ id: reminder.id }), agent)).title).toBe('pay rent');
  });

  test('completing an occurrence twice is refused rather than completing the next one', async () => {
    const { reminder } = await create({ text: 'standup every day 9am' });
    await act({ id: reminder.id, action: 'complete', body: { due: reminder.due } });
    const again = await call('act', { id: reminder.id, action: 'complete', body: { due: reminder.due } });
    expect(again).toMatchObject({ ok: false, error: 'conflict' });
  });
});

describe('agent input', () => {
  test.each<[string, AgentRoute, Partial<AgentEnvelope>, string]>([
    ['a body that is not an object', 'create', { body: ['call mom'] }, 'bad_request'],
    ['neither text nor title and start', 'create', { body: { notes: 'x' } }, 'bad_request'],
    ['text that leaves no title', 'create', { body: { text: 'tomorrow 9am' } }, 'bad_request'],
    ['an unknown field', 'create', { body: { text: 'call mom', when: 'later' } }, 'bad_request'],
    ['a start that is not a wall time', 'create', { body: { title: 'x', start: 'tomorrow' } }, 'bad_request'],
    [
      'a repeat that is not a rule',
      'create',
      { body: { title: 'x', start: TOMORROW, repeat: 'daily' } },
      'bad_request',
    ],
    ['too many alerts', 'create', { body: { text: 'call mom', alerts: [1, 2, 3, 4, 5, 6] } }, 'bad_request'],
    ['an Idempotency-Key with spaces', 'create', { body: { text: 'call mom' }, key: 'a b' }, 'bad_request'],
    ['an update without rev', 'update', { id: ulid(), body: { title: 'x' } }, 'bad_request'],
    ['an update that changes nothing', 'update', { id: ulid(), body: { rev: 1 } }, 'bad_request'],
    ['an id that is not one', 'get', { id: '../../etc' }, 'not_found'],
    ['an unknown action', 'act', { id: ulid(), action: 'explode' }, 'not_found'],
    ['an until that is not a time', 'act', { id: ulid(), action: 'snooze', body: { until: 'soonish' } }, 'bad_request'],
    ['a status that does not exist', 'list', { query: { status: 'urgent' } }, 'bad_request'],
    ['a limit out of range', 'list', { query: { limit: '0' } }, 'bad_request'],
  ])('rejects %s', async (_, route, parts, error) => {
    await create({ text: 'call mom sunday 6pm' });
    const before = await everything();
    expect(await call(route, parts)).toMatchObject({ ok: false, error });
    expect(await everything()).toEqual(before);
  });

  test.each([
    'call mom sunday 6pm',
    'water plants every 3 days after done',
    '! pay rent on the 1st every month',
    'standup weekdays 9:30am',
  ])('text becomes the reminder the app would make: %s', async (text) => {
    const { reminder } = await create({ text });
    const { title, notes, start, zone, repeat, important, alerts } = reminder;
    const made = {
      title,
      notes,
      start,
      zone,
      important,
      alerts,
      repeat: repeat && { rule: repeat.rule, anchor: repeat.anchor },
    };
    expect(fieldsFromText(text, h.state.now, ZONE)?.fields).toEqual(made);
  });
});
