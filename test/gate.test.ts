import { expect, test } from 'bun:test';
import { ForegroundGate } from '../src/app/lib/gate';

type Step = 'start' | 'settle' | 'hide' | 'show';

test.each<[string, Step[], boolean[]]>([
  ['a visible start opens on its first settled attempt, online or not', ['start', 'settle'], [true]],
  ['an attempt that settles while hidden does not open', ['start', 'hide', 'settle'], [false]],
  ['an attempt from before hiding cannot open the next foreground', ['start', 'hide', 'show', 'settle'], [false]],
  [
    'the next foreground opens on its own attempt',
    ['start', 'hide', 'show', 'start', 'settle', 'settle'],
    [true, false],
  ],
])('%s', (_, steps, expected) => {
  const gate = new ForegroundGate(true);
  const attempts: (() => boolean)[] = [];
  const results: boolean[] = [];
  for (const step of steps) {
    if (step === 'start') attempts.unshift(gate.attempt());
    else if (step === 'hide') gate.changed(false);
    else if (step === 'show') gate.changed(true);
    else results.push(attempts.shift()?.() ?? false);
  }
  expect(results).toEqual(expected);
});
