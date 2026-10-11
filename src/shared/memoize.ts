export function memoize<T>(create: (key: string) => T): (key: string) => T {
  const cache = new Map<string, { value: T }>();
  return (key) => {
    let entry = cache.get(key);
    if (!entry) {
      entry = { value: create(key) };
      cache.set(key, entry);
    }
    return entry.value;
  };
}
