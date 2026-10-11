import type { Schema } from './schema';

const DB_NAME = 'nudge';
const STORE = 'kv';

let opened: Promise<IDBDatabase> | undefined;

function database(): Promise<IDBDatabase> {
  opened ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.addEventListener('upgradeneeded', () => request.result.createObjectStore(STORE));
    request.addEventListener('success', () => resolve(request.result));
    request.addEventListener('error', () => reject(request.error ?? new Error('could not open IndexedDB')));
  });
  return opened;
}

function settle<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result));
    request.addEventListener('error', () => reject(request.error ?? new Error('IndexedDB request failed')));
  });
}

export async function get<K extends keyof Schema>(key: K): Promise<Schema[K] | undefined> {
  const db = await database();
  const value: Schema[K] | undefined = await settle(db.transaction(STORE).objectStore(STORE).get(key));
  return value;
}

export async function set<K extends keyof Schema>(key: K, value: Schema[K]): Promise<void> {
  const db = await database();
  await settle(db.transaction(STORE, 'readwrite').objectStore(STORE).put(value, key));
}

export async function update<K extends keyof Schema>(
  key: K,
  change: (current: Schema[K] | undefined) => Schema[K],
): Promise<Schema[K]> {
  const db = await database();
  const store = db.transaction(STORE, 'readwrite').objectStore(STORE);
  const current: Schema[K] | undefined = await settle(store.get(key));
  const next = change(current);
  await settle(store.put(next, key));
  return next;
}
