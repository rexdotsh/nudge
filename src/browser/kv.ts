import type { Schema } from './schema';

const DB_NAME = 'nudge';
const STORE = 'kv';

let opened: Promise<IDBDatabase> | undefined;

function database(): Promise<IDBDatabase> {
  opened ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.addEventListener('upgradeneeded', () => request.result.createObjectStore(STORE));
    request.addEventListener('success', () => {
      const db = request.result;
      db.addEventListener('close', () => (opened = undefined));
      db.addEventListener('versionchange', () => {
        db.close();
        opened = undefined;
      });
      resolve(db);
    });
    request.addEventListener('error', () => reject(request.error ?? new Error('could not open IndexedDB')));
  }).catch((error: unknown) => {
    opened = undefined;
    throw error;
  });
  return opened;
}

async function transact<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => () => T): Promise<T> {
  const transaction = (await database()).transaction(STORE, mode);
  const result = work(transaction.objectStore(STORE));
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve(result()));
    transaction.addEventListener('error', () => reject(transaction.error ?? new Error('IndexedDB transaction failed')));
    transaction.addEventListener('abort', () =>
      reject(transaction.error ?? new Error('IndexedDB transaction aborted')),
    );
  });
}

export function get<K extends keyof Schema>(key: K): Promise<Schema[K] | undefined> {
  return transact('readonly', (store) => {
    const request: IDBRequest<Schema[K] | undefined> = store.get(key);
    return () => request.result;
  });
}

export function set<K extends keyof Schema>(key: K, value: Schema[K]): Promise<void> {
  return transact('readwrite', (store) => {
    store.put(value, key);
    return () => undefined;
  });
}

export function update<K extends keyof Schema>(
  key: K,
  change: (current: Schema[K] | undefined) => Schema[K],
): Promise<Schema[K]> {
  return transact('readwrite', (store) => {
    let next: Schema[K] | undefined;
    const read: IDBRequest<Schema[K] | undefined> = store.get(key);
    read.addEventListener('success', () => {
      next = change(read.result);
      store.put(next, key);
    });
    return () => {
      if (next === undefined) throw new Error(`update of ${key} did not run`);
      return next;
    };
  });
}
