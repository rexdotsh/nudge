import { nextOccurrence } from './occurrences';
import { DATE, dateInPhrase, type RepeatMatch } from './phrases';
import { ADVANCE_DATE } from './reminder';
import type { Scanner } from './scanner';
import {
  epochDay,
  formatLocal,
  fromEpochDay,
  isRealDate,
  parseLocal,
  toInstant,
  toLocal,
  type LocalDate,
} from './time';
import { isInteger } from './validate';

type Ending =
  | { kind: 'until'; at: number }
  | { kind: 'count'; amount: number }
  | { kind: 'duration'; freq: 'DAILY' | 'WEEKLY' | 'MONTHLY'; amount: number };

const UNTIL = `until\\s+(?:${DATE})`;
const COUNT = `(?:for\\s+)?(\\d+)\\s+times`;
const DURATION = `for\\s+(?:(\\d+|a|an|one)\\s+)?(day|week|month)s?`;
const endOfDay = (date: LocalDate, zone: string) => toInstant({ ...date, hour: 23, minute: 59 }, zone);

export function scanEnding(
  scanner: Scanner,
  repeat: RepeatMatch | null,
  today: LocalDate,
  zone: string,
): Ending | null {
  if (!repeat) return null;
  if (repeat.anchor === 'completion') {
    for (const pattern of [UNTIL, COUNT, DURATION]) scanner.shield(pattern);
    return null;
  }
  let ending: Ending | null = null;
  if (
    scanner.take(UNTIL, 'repeat', (match) => {
      const date = dateInPhrase(match, today);
      if (!isRealDate(date)) return false;
      ending = { kind: 'until', at: endOfDay(date, zone) };
      return true;
    })
  )
    return ending;
  if (
    scanner.take(COUNT, 'repeat', (match) => {
      const amount = Number(match[1]);
      if (!isInteger(amount, 1, 100_000)) return false;
      ending = { kind: 'count', amount };
      return true;
    })
  )
    return ending;
  scanner.take(DURATION, 'repeat', (match) => {
    const amount = /^\d+$/.test(match[1] ?? '') ? Number(match[1]) : 1;
    const freq = match[2] === 'week' ? 'WEEKLY' : match[2] === 'month' ? 'MONTHLY' : 'DAILY';
    if (!isInteger(amount, 1, 100_000)) return false;
    const end = ADVANCE_DATE[freq](today, amount);
    if (end.year > 9999) return false;
    ending = { kind: 'duration', freq, amount };
    return true;
  });
  return ending;
}

export function applyEnding(
  repeat: RepeatMatch | null,
  start: string | null,
  ending: Ending | null,
  now: number,
  zone: string,
): string | null {
  if (!repeat || !ending || start === null) return start;
  if (ending.kind === 'until') {
    repeat.rule.until = ending.at;
    return start;
  }
  const local = parseLocal(start);
  if (!local) throw new Error(`invalid quick-add start ${start}`);
  const first = nextOccurrence(repeat.rule, local, zone, now);
  if (ending.kind === 'count') {
    repeat.rule.count = ending.amount;
    return first === null ? start : formatLocal(toLocal(first, zone));
  }
  if (first === null) return start;
  const date = toLocal(first, zone);
  const end = ADVANCE_DATE[ending.freq](date, ending.amount);
  repeat.rule.until = endOfDay(fromEpochDay(epochDay(end) - 1), zone);
  return start;
}
