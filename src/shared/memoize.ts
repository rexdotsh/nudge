export function memoize<T>(create: (key: string) => T): (key: string) => T {
  const cache = new Map<string, T>();
  return (key) => {
    let value = cache.get(key);
    if (value === undefined) {
      value = create(key);
      cache.set(key, value);
    }
    return value;
  };
}
