import type { DeliveryInfo, DeviceInfo, DeviceInput, Platform, PushKeys } from '../shared/api';
import type { Reminder } from '../shared/reminder';

export type SqlValue = string | number | null;

export interface Sql {
  exec<T extends Record<string, SqlValue>>(query: string, ...bindings: SqlValue[]): { toArray(): T[] };
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    install_key TEXT NOT NULL UNIQUE,
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
  `CREATE TABLE IF NOT EXISTS applied_ops (id TEXT PRIMARY KEY, at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS deliveries (
    fire TEXT NOT NULL,
    device_id TEXT NOT NULL,
    title TEXT NOT NULL,
    topic TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    sends INTEGER NOT NULL DEFAULT 0,
    status INTEGER NOT NULL DEFAULT 0,
    sent_at INTEGER,
    receipt_at INTEGER,
    next_at INTEGER,
    PRIMARY KEY (fire, device_id)
  )`,
  `CREATE INDEX IF NOT EXISTS deliveries_by_next_at ON deliveries (next_at) WHERE next_at IS NOT NULL`,
];

const SCHEMA_VERSION = '1';

export type DeviceRow = {
  id: string;
  install_key: string;
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
  created_at: number;
  sends: number;
  status: number;
  sent_at: number | null;
  receipt_at: number | null;
  next_at: number | null;
};

export interface Target extends PushKeys {
  deviceId: string;
  label: string;
}

export interface Outgoing {
  fire: string;
  title: string;
  topic: string;
  payload: string;
}

const first = <T>(rows: T[]): T | undefined => rows[0];

function decode(data: string): Reminder {
  const reminder: Reminder = JSON.parse(data);
  return reminder;
}

function target(row: DeviceRow): Target | undefined {
  return row.endpoint && row.p256dh && row.auth
    ? { deviceId: row.id, label: row.label, endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth }
    : undefined;
}

export class Store {
  constructor(private readonly sql: Sql) {
    sql.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    if (this.meta('schema') === SCHEMA_VERSION) return;
    for (const statement of SCHEMA) sql.exec(statement);
    this.setMeta('schema', SCHEMA_VERSION);
  }

  private count(query: string, ...bindings: SqlValue[]): number {
    return first(this.sql.exec<{ count: number }>(query, ...bindings).toArray())?.count ?? 0;
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

  applied(opId: string): boolean {
    return this.count('SELECT COUNT(*) AS count FROM applied_ops WHERE id = ?', opId) > 0;
  }

  recordApplied(opId: string, now: number): void {
    this.sql.exec('INSERT INTO applied_ops (id, at) VALUES (?, ?)', opId, now);
  }

  purgeApplied(before: number): void {
    this.sql.exec('DELETE FROM applied_ops WHERE at < ?', before);
  }

  nextWake(): number | null {
    const row = first(
      this.sql
        .exec<{ at: number | null }>(
          `SELECT MIN(at) AS at FROM (
             SELECT MIN(fire_at) AS at FROM reminders
             UNION ALL SELECT MIN(next_at) FROM deliveries
           )`,
        )
        .toArray(),
    );
    return row?.at ?? null;
  }

  lateCount(before: number): number {
    return this.count(
      `SELECT (SELECT COUNT(*) FROM reminders WHERE fire_at < ?) + (SELECT COUNT(*) FROM deliveries WHERE next_at < ?) AS count`,
      before,
      before,
    );
  }

  deviceCount(): number {
    return this.count('SELECT COUNT(*) AS count FROM devices');
  }

  device(id: string): DeviceRow | undefined {
    return first(this.sql.exec<DeviceRow>('SELECT * FROM devices WHERE id = ? AND revoked = 0', id).toArray());
  }

  deviceByKey(installKey: string): DeviceRow | undefined {
    return first(
      this.sql.exec<DeviceRow>('SELECT * FROM devices WHERE install_key = ? AND revoked = 0', installKey).toArray(),
    );
  }

  devices(): DeviceRow[] {
    return this.sql.exec<DeviceRow>('SELECT * FROM devices WHERE revoked = 0 ORDER BY created_at').toArray();
  }

  addDevice(id: string, input: DeviceInput, now: number): void {
    this.sql.exec(
      `INSERT INTO devices (id, install_key, label, platform, zone, locale, created_at, seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.key,
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

  target(deviceId: string): Target | undefined {
    const row = this.device(deviceId);
    return row && target(row);
  }

  targets(): Target[] {
    return this.devices().flatMap((row) => target(row) ?? []);
  }

  recordPush(sent: Target, ok: boolean, gone: boolean, now: number): void {
    const where = 'WHERE id = ? AND endpoint = ?';
    if (gone) {
      this.sql.exec(
        `UPDATE devices SET endpoint = NULL, p256dh = NULL, auth = NULL ${where}`,
        sent.deviceId,
        sent.endpoint,
      );
    } else if (ok) {
      this.sql.exec(`UPDATE devices SET push_failures = 0, push_ok_at = ? ${where}`, now, sent.deviceId, sent.endpoint);
    } else {
      this.sql.exec(`UPDATE devices SET push_failures = push_failures + 1 ${where}`, sent.deviceId, sent.endpoint);
    }
  }

  queue(outgoing: Outgoing, deviceId: string, at: number, now: number): void {
    this.sql.exec(
      `INSERT INTO deliveries (fire, device_id, title, topic, payload, created_at, next_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (fire, device_id) DO NOTHING`,
      outgoing.fire,
      deviceId,
      outgoing.title,
      outgoing.topic,
      outgoing.payload,
      now,
      at,
    );
  }

  pendingCount(firePrefix: string): number {
    return this.count(
      "SELECT COUNT(DISTINCT fire) AS count FROM deliveries WHERE sends = 0 AND next_at IS NOT NULL AND fire LIKE ? || '%'",
      firePrefix,
    );
  }

  claim(now: number, lease: number): DeliveryRow[] {
    return this.sql
      .exec<DeliveryRow>(
        'UPDATE deliveries SET next_at = ? WHERE next_at <= ? AND receipt_at IS NULL RETURNING *',
        now + lease,
        now,
      )
      .toArray();
  }

  recordSend(row: DeliveryRow, status: number, nextAt: number | null, now: number): void {
    this.sql.exec(
      `UPDATE deliveries SET sends = ?, status = ?, sent_at = ?,
         next_at = CASE WHEN receipt_at IS NULL THEN ? ELSE NULL END
       WHERE fire = ? AND device_id = ?`,
      row.sends + 1,
      status,
      now,
      nextAt,
      row.fire,
      row.device_id,
    );
  }

  settle(row: DeliveryRow): void {
    this.sql.exec('UPDATE deliveries SET next_at = NULL WHERE fire = ? AND device_id = ?', row.fire, row.device_id);
  }

  receipt(fire: string, deviceId: string, now: number): void {
    this.sql.exec(
      'UPDATE deliveries SET receipt_at = ?, next_at = NULL WHERE fire = ? AND device_id = ? AND receipt_at IS NULL',
      now,
      fire,
      deviceId,
    );
    this.sql.exec('UPDATE devices SET receipt_at = ? WHERE id = ?', now, deviceId);
  }

  recentDeliveries(limit: number): DeliveryRow[] {
    return this.sql.exec<DeliveryRow>('SELECT * FROM deliveries ORDER BY created_at DESC LIMIT ?', limit).toArray();
  }

  purgeDeliveries(before: number): void {
    this.sql.exec('DELETE FROM deliveries WHERE created_at < ? AND next_at IS NULL', before);
  }
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
