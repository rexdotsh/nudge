import type { PushData } from '../shared/notification';
import { isRecord } from '../shared/validate';

export interface Shown extends PushData {
  navigate: string;
}

export function isShown(value: unknown): value is Shown {
  if (!isRecord(value) || typeof value.fire !== 'string' || typeof value.navigate !== 'string') return false;
  const { reminder } = value;
  return (
    reminder === null || (isRecord(reminder) && typeof reminder.id === 'string' && typeof reminder.due === 'string')
  );
}
