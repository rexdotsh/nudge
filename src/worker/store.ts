import type { DeliveryInfo, DeviceInfo, DeviceInput, Platform, PushKeys } from '../shared/api';
import type { Reminder } from '../shared/reminder';

export type SqlValue = string | number | null;

export interface Sql {
  exec<T extends Record<string, SqlValue>>(query: string, ...bindings: SqlValue[]): { toArray(): T[] };
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    platform TEXT NOT NULL,
    zone TEXT NOT NULL,
    locale TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    seen_at INTEGER NOT NULL,
    revoked INTEGER NOT NULL DEFAULT 0,
    endpoint TEXT,
    p256dh TEXT,
    auth TEXT,
    push_failures INTEGER NOT NULL DEFAULT 0,
    push_ok_at INTEGER,
    receipt_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS reminders (
    id TEXT PRIMARY KEY,
    version INTEGER NOT NULL,
    fire_at INTEGER,
    deleted_at INTEGER,
    data TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS reminders_by_version ON reminders (version)`,
  `CREATE INDEX IF NOT EXISTS reminders_by_fire_at ON reminders (fire_at) WHERE fire_at IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS probes (at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS deliveries (
    fire TEXT NOT NULL,
    device_id TEXT NOT NULL,
    title TEXT NOT NULL,
    topic TEXT NOT NULL,
    payload TEXT NOT NULL,
    sent_at INTEGER NOT NULL,
    status INTEGER NOT NULL,
    attempts INTEGER NOT NULL,
    receipt_at INTEGER,
    PRIMARY KEY (fire, device_id)
  )`,
  `CREATE INDEX IF NOT EXISTS deliveries_unconfirmed ON deliveries (sent_at) WHERE receipt_at IS NULL`,
];

const SCHEMA_VERSION = '1';

export type DeviceRow = {
  id: string;
  label: string;
  platform: Platform;
  zone: string;
  locale: string;
  created_at: number;
  seen_at: number;
  revoked: number;
  endpoint: string | null;
  p256dh: string | null;
  auth: string | null;
  push_failures: number;
  push_ok_at: number | null;
  receipt_at: number | null;
};

export type DeliveryRow = {
  fire: string;
  device_id: string;
  title: string;
  topic: string;
  payload: string;
  sent_at: number;
  status: number;
  attempts: number;
  receipt_at: number | null;
};

export interface Target extends PushKeys {
  deviceId: string;
  label: string;
}

const first = <T>(rows: T[]): T | undefined => rows[0];

export class Store {
  constructor(private readonly sql: Sql) {
    sql.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    if (this.meta('schema') === SCHEMA_VERSION) return;
    for (const statement of SCHEMA) sql.exec(statement);
    this.setMeta('schema', SCHEMA_VERSION);
  }

  meta(key: string): string | null {
    return (
      first(this.sql.exec<{ value: string }>('SELECT value FROM meta WHERE key = ?', key).toArray())?.value ?? null
    );
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

  reminder(id: string): Reminder | undefined {
    const row = first(this.sql.exec<{ data: string }>('SELECT data FROM reminders WHERE id = ?', id).toArray());
    return row && decode(row.data);
  }

  reminders(): Reminder[] {
    return this.sql
      .exec<{ data: string }>('SELECT data FROM reminders')
      .toArray()
      .map((row) => decode(row.data));
  }

  saveReminder(reminder: Reminder, fireAt: number | null, now: number): void {
    const version = this.version() + 1;
    this.setMeta('version', String(version));
    this.sql.exec(
      `INSERT INTO reminders (id, version, fire_at, deleted_at, data) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET version = excluded.version, fire_at = excluded.fire_at,
         deleted_at = CASE WHEN excluded.deleted_at IS NULL THEN NULL ELSE COALESCE(reminders.deleted_at, excluded.deleted_at) END,
         data = excluded.data`,
      reminder.id,
      version,
      fireAt,
      reminder.deleted ? now : null,
      JSON.stringify(reminder),
    );
  }

  setFireAt(id: string, fireAt: number | null): void {
    this.sql.exec('UPDATE reminders SET fire_at = ? WHERE id = ?', fireAt, id);
  }

  changedSince(version: number): Reminder[] {
    return this.sql
      .exec<{ data: string }>('SELECT data FROM reminders WHERE version > ? ORDER BY version', version)
      .toArray()
      .map((row) => decode(row.data));
  }

  dueReminders(now: number): Reminder[] {
    return this.sql
      .exec<{ data: string }>('SELECT data FROM reminders WHERE fire_at <= ? ORDER BY fire_at', now)
      .toArray()
      .map((row) => decode(row.data));
  }

  purgeTombstones(before: number): number {
    return this.sql.exec<{ id: string }>('DELETE FROM reminders WHERE deleted_at < ? RETURNING id', before).toArray()
      .length;
  }

  nextWake(resendAfter: number, escalateAfter: number): number | null {
    const row = first(
      this.sql
        .exec<{ at: number | null }>(
          `SELECT MIN(at) AS at FROM (
             SELECT MIN(fire_at) AS at FROM reminders
             UNION ALL SELECT MIN(at) FROM probes
             UNION ALL SELECT MIN(sent_at) + ? FROM deliveries WHERE receipt_at IS NULL AND (status = 0 OR status BETWEEN 200 AND 299) AND attempts = 1
             UNION ALL SELECT MIN(sent_at) + ? FROM deliveries WHERE receipt_at IS NULL AND (status = 0 OR status BETWEEN 200 AND 299) AND attempts = 2
           )`,
          resendAfter,
          escalateAfter,
        )
        .toArray(),
    );
    return row?.at ?? null;
  }

  lateCount(before: number): number {
    const row = first(
      this.sql
        .exec<{ late: number }>(
          `SELECT (SELECT COUNT(*) FROM reminders WHERE fire_at < ?) + (SELECT COUNT(*) FROM probes WHERE at < ?) AS late`,
          before,
          before,
        )
        .toArray(),
    );
    return row?.late ?? 0;
  }

  addProbe(at: number): number {
    this.sql.exec('INSERT INTO probes (at) VALUES (?)', at);
    return first(this.sql.exec<{ count: number }>('SELECT COUNT(*) AS count FROM probes').toArray())?.count ?? 0;
  }

  takeProbes(now: number): number[] {
    return this.sql
      .exec<{ at: number }>('DELETE FROM probes WHERE at <= ? RETURNING at', now)
      .toArray()
      .map((row) => row.at);
  }

  deviceCount(): number {
    return first(this.sql.exec<{ count: number }>('SELECT COUNT(*) AS count FROM devices').toArray())?.count ?? 0;
  }

  device(id: string): DeviceRow | undefined {
    return first(this.sql.exec<DeviceRow>('SELECT * FROM devices WHERE id = ? AND revoked = 0', id).toArray());
  }

  devices(): DeviceRow[] {
    return this.sql.exec<DeviceRow>('SELECT * FROM devices WHERE revoked = 0 ORDER BY created_at').toArray();
  }

  latestDevice(): DeviceRow | undefined {
    return first(
      this.sql.exec<DeviceRow>('SELECT * FROM devices WHERE revoked = 0 ORDER BY seen_at DESC LIMIT 1').toArray(),
    );
  }

  addDevice(id: string, input: DeviceInput, now: number): void {
    this.sql.exec(
      'INSERT INTO devices (id, label, platform, zone, locale, created_at, seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id,
      input.label,
      input.platform,
      input.zone,
      input.locale,
      now,
      now,
    );
  }

  touchDevice(id: string, zone: string, now: number): void {
    this.sql.exec('UPDATE devices SET zone = ?, seen_at = ? WHERE id = ?', zone, now, id);
  }

  revokeDevice(id: string): void {
    this.sql.exec('UPDATE devices SET revoked = 1, endpoint = NULL, p256dh = NULL, auth = NULL WHERE id = ?', id);
  }

  setSubscription(id: string, keys: PushKeys | null): void {
    this.sql.exec(
      'UPDATE devices SET endpoint = ?, p256dh = ?, auth = ?, push_failures = 0 WHERE id = ?',
      keys?.endpoint ?? null,
      keys?.p256dh ?? null,
      keys?.auth ?? null,
      id,
    );
  }

  targets(): Target[] {
    return this.devices().flatMap((row) =>
      row.endpoint && row.p256dh && row.auth
        ? [{ deviceId: row.id, label: row.label, endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth }]
        : [],
    );
  }

  recordPushOk(deviceId: string, now: number): void {
    this.sql.exec('UPDATE devices SET push_failures = 0, push_ok_at = ? WHERE id = ?', now, deviceId);
  }

  recordPushFailure(deviceId: string): void {
    this.sql.exec('UPDATE devices SET push_failures = push_failures + 1 WHERE id = ?', deviceId);
  }

  insertDelivery(row: DeliveryRow): void {
    this.sql.exec(
      `INSERT INTO deliveries (fire, device_id, title, topic, payload, sent_at, status, attempts, receipt_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
       ON CONFLICT (fire, device_id) DO UPDATE SET sent_at = excluded.sent_at, status = excluded.status, attempts = excluded.attempts`,
      row.fire,
      row.device_id,
      row.title,
      row.topic,
      row.payload,
      row.sent_at,
      row.status,
      row.attempts,
    );
  }

  setDeliveryStatus(fire: string, deviceId: string, status: number): void {
    this.sql.exec('UPDATE deliveries SET status = ? WHERE fire = ? AND device_id = ?', status, fire, deviceId);
  }

  unconfirmed(attempts: number, sentBefore: number): DeliveryRow[] {
    return this.sql
      .exec<DeliveryRow>(
        `SELECT * FROM deliveries
         WHERE receipt_at IS NULL AND (status = 0 OR status BETWEEN 200 AND 299) AND attempts = ? AND sent_at <= ?`,
        attempts,
        sentBefore,
      )
      .toArray();
  }

  markAttempts(fire: string, deviceId: string, attempts: number, now: number): void {
    this.sql.exec(
      'UPDATE deliveries SET attempts = ?, sent_at = ? WHERE fire = ? AND device_id = ?',
      attempts,
      now,
      fire,
      deviceId,
    );
  }

  receipt(fire: string, deviceId: string, now: number): void {
    this.sql.exec(
      'UPDATE deliveries SET receipt_at = ? WHERE fire = ? AND device_id = ? AND receipt_at IS NULL',
      now,
      fire,
      deviceId,
    );
    this.sql.exec('UPDATE devices SET receipt_at = ? WHERE id = ?', now, deviceId);
  }

  recentDeliveries(limit: number): DeliveryRow[] {
    return this.sql.exec<DeliveryRow>('SELECT * FROM deliveries ORDER BY sent_at DESC LIMIT ?', limit).toArray();
  }

  purgeDeliveries(before: number): void {
    this.sql.exec('DELETE FROM deliveries WHERE sent_at < ?', before);
  }
}

function decode(data: string): Reminder {
  const reminder: Reminder = JSON.parse(data);
  return reminder;
}

export function deviceInfo(row: DeviceRow): DeviceInfo {
  return {
    id: row.id,
    label: row.label,
    platform: row.platform,
    zone: row.zone,
    createdAt: row.created_at,
    seenAt: row.seen_at,
    push: {
      enabled: row.endpoint !== null,
      failures: row.push_failures,
      okAt: row.push_ok_at,
      receiptAt: row.receipt_at,
    },
  };
}

export function deliveryInfo(row: DeliveryRow): DeliveryInfo {
  return {
    fire: row.fire,
    title: row.title,
    deviceId: row.device_id,
    sentAt: row.sent_at,
    status: row.status,
    receiptAt: row.receipt_at,
  };
}
