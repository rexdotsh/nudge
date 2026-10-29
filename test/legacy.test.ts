import { expect, test } from 'bun:test';
import { withLegacy } from '../src/browser/legacy';
import type { Local } from '../src/browser/schema';
import type { Change } from '../src/shared/api';
import { applyOp, type Op } from '../src/shared/ops';
import { ulid } from '../src/shared/ulid';

const ZONE = 'Asia/Kolkata';
const NOW = Date.UTC(2026, 9, 11, 14, 0);
const ID = ulid(NOW);

const change = (op: Op): Change => ({ opId: ulid(), op, at: NOW });
const queue =
  (...ops: Op[]) =>
  (local: Local): Local => ({ ...local, pending: [...local.pending, ...ops.map(change)] });

test('a tab running a bundle from before pausing never finds the new ops under its key, and what it queues is taken over once', () => {
  const created = applyOp(
    undefined,
    {
      type: 'put',
      id: ID,
      fields: {
        title: 'Water the plants',
        notes: '',
        start: '2026-10-12T09:00',
        zone: null,
        repeat: { rule: 'FREQ=DAILY', anchor: 'schedule' },
        important: false,
        alerts: [],
      },
    },
    { now: NOW, zone: ZONE },
  );
  if (!created) throw new Error('create failed');
  const fromOlderTab = change({ type: 'snooze', id: ID, due: '2026-10-12T09:00', until: NOW + 60_000 });
  const legacy: Local = { replica: { version: 4, reminders: [created] }, pending: [fromOlderTab] };

  const [legacyAfter, state] = withLegacy(
    legacy,
    undefined,
    queue({ type: 'pause', id: ID, until: null }, { type: 'unpause', id: ID, revision: 3 }, { type: 'resume', id: ID }),
  );
  expect(legacyAfter).toEqual({ ...legacy, pending: [] });
  expect(state.replica).toEqual(legacy.replica);
  expect(state.pending.map(({ op }) => op.type)).toEqual(['snooze', 'pause', 'unpause', 'resume']);

  const laterFromOlderTab = change({ type: 'delete', id: ID });
  const [legacyAgain, stateAgain] = withLegacy({ ...legacy, pending: [laterFromOlderTab] }, state, (local) => local);
  expect(stateAgain.pending.map(({ opId }) => opId)).toEqual([
    ...state.pending.map(({ opId }) => opId),
    laterFromOlderTab.opId,
  ]);
  expect(legacyAgain?.pending).toEqual([]);
  expect(withLegacy(legacyAgain, stateAgain, (local) => local)).toEqual([undefined, stateAgain]);
});
