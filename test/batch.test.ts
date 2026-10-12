import { expect, test } from 'bun:test';
import { batch } from '../src/browser/batch';
import { MAX_CHANGES, MAX_REQUEST_BYTES, type Change } from '../src/shared/api';
import { utf8 } from '../src/shared/encoding';
import { ulid } from '../src/shared/ulid';

function change(notes: string): Change {
  const fields = {
    title: 'Pay rent',
    notes,
    start: '2026-10-12T09:00',
    zone: null,
    repeat: null,
    important: false,
    alerts: [],
  };
  return { opId: ulid(), op: { type: 'put', id: ulid(), fields }, at: 0 };
}

test.each([
  ['many small changes', Array.from({ length: 450 }, () => change('short'))],
  ['long multi-byte notes', Array.from({ length: 120 }, () => change('é'.repeat(4000)))],
])('%s go out in order, in requests the server accepts', (_, pending) => {
  const sent: Change[] = [];
  while (sent.length < pending.length) {
    const next = batch(pending.slice(sent.length), MAX_REQUEST_BYTES);
    const body = JSON.stringify({ since: 0, zone: 'Asia/Kolkata', changes: next });
    expect(next.length).toBeGreaterThan(0);
    expect(next.length).toBeLessThanOrEqual(MAX_CHANGES);
    expect(utf8(body).length).toBeLessThanOrEqual(MAX_REQUEST_BYTES);
    sent.push(...next);
  }
  expect(sent).toEqual(pending);
});
