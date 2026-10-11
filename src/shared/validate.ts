export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isText(value: unknown, max: number, min = 0): value is string {
  return typeof value === 'string' && value.length >= min && value.length <= max;
}

export function isInteger(value: unknown, min: number, max: number): value is number {
  return Number.isSafeInteger(value) && typeof value === 'number' && value >= min && value <= max;
}
