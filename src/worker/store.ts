import type { Reminder } from '../shared/reminder';
import { DELIVERY_SCHEMA, Deliveries } from './deliveries';
import { DEVICE_SCHEMA, Devices } from './devices';
import { count, type Sql, type SqlValue } from './sql';

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS reminders (
    id TEXT PRIMARY KEY,
    version INTEGER NOT NULL,
    fire_at INTEGER,
    data TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS reminders_by_version ON reminders (version)`,
  `CREATE INDEX IF NOT EXISTS reminders_by_fire_at ON reminders (fire_at) WHERE fire_at IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS applied_ops (id TEXT PRIMARY KEY, at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS test_requests (id TEXT PRIMARY KEY, at INTEGER NOT NULL)`,
  ...DEVICE_SCHEMA,
  ...DELIVERY_SCHEMA,
];

const SCHEMA_VERSION = '1';

export class Store {
  readonly devices: Devices;
  readonly deliveries: Deliveries;

  constructor(private readonly sql: Sql) {
    this.devices = new Devices(sql);
    this.deliveries = new Deliveries(sql);
    sql.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    if (this.meta('schema') === SCHEMA_VERSION) return;
    for (const statement of SCHEMA) sql.exec(statement);
    this.setMeta('schema', SCHEMA_VERSION);
  }

  meta(key: string): string | null {
    return this.sql.exec<{ value: string }>('SELECT value FROM meta WHERE key = ?', key).toArray()[0]?.value ?? null;
  }

  setMeta(key: string, value: string): void {
    this.sql.exec(
      'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
      key,
      value,
    );
  }

  version(): number {
    return Number(this.meta('version') ?? 0);
  }

  private decoded(query: string, ...bindings: SqlValue[]): Reminder[] {
    return this.sql
      .exec<{ data: string }>(query, ...bindings)
      .toArray()
      .map((row): Reminder => JSON.parse(row.data));
  }

  reminder(id: string): Reminder | undefined {
    return this.decoded('SELECT data FROM reminders WHERE id = ?', id)[0];
  }

  reminders(): Reminder[] {
    return this.decoded('SELECT data FROM reminders');
  }

  changedSince(version: number): Reminder[] {
    return this.decoded('SELECT data FROM reminders WHERE version > ? ORDER BY version', version);
  }

  dueReminders(now: number): Reminder[] {
    return this.decoded('SELECT data FROM reminders WHERE fire_at <= ? ORDER BY fire_at', now);
  }

  saveReminder(reminder: Reminder, fireAt: number | null): void {
    const version = this.version() + 1;
    this.setMeta('version', String(version));
    this.sql.exec(
      `INSERT INTO reminders (id, version, fire_at, data) VALUES (?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET version = excluded.version, fire_at = excluded.fire_at, data = excluded.data`,
      reminder.id,
      version,
      fireAt,
      JSON.stringify(reminder),
    );
  }

  purgeAlertMarks(before: number): void {
    this.sql.exec("DELETE FROM meta WHERE key LIKE 'alert:%' AND CAST(value AS INTEGER) < ?", before);
  }

  applied(opId: string): boolean {
    return count(this.sql, 'SELECT COUNT(*) AS count FROM applied_ops WHERE id = ?', opId) > 0;
  }

  recordApplied(opId: string, now: number): void {
    this.sql.exec('INSERT INTO applied_ops (id, at) VALUES (?, ?)', opId, now);
  }

  testRequest(id: string): number | null {
    return this.sql.exec<{ at: number }>('SELECT at FROM test_requests WHERE id = ?', id).toArray()[0]?.at ?? null;
  }

  recordTestRequest(id: string, at: number): void {
    this.sql.exec('INSERT INTO test_requests (id, at) VALUES (?, ?)', id, at);
  }

  nextWake(): number | null {
    return (
      this.sql
        .exec<{ at: number | null }>(`SELECT MIN(at) AS at FROM (
           SELECT MIN(fire_at) AS at FROM reminders
           UNION ALL SELECT MIN(next_at) FROM deliveries
         )`)
        .toArray()[0]?.at ?? null
    );
  }

  lateCount(before: number): number {
    return count(
      this.sql,
      `SELECT (SELECT COUNT(*) FROM reminders WHERE fire_at < ?) + (SELECT COUNT(*) FROM deliveries WHERE next_at < ?) AS count`,
      before,
      before,
    );
  }
}
