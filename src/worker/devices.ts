import type { DeviceInfo, DeviceInput, Platform, PushKeys } from '../shared/api';
import { count, type Sql } from './sql';

export const DEVICE_SCHEMA = [
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
    receipt_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS enrollments (
    credential TEXT NOT NULL,
    install_key TEXT NOT NULL,
    device_id TEXT NOT NULL,
    PRIMARY KEY (credential, install_key)
  )`,
];

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
  receipt_at: number | null;
};

export interface Target extends PushKeys {
  deviceId: string;
  label: string;
  /** Only a device that has confirmed before is resent to, since its silence is the only silence that means a loss. */
  confirms: boolean;
}

function target(row: DeviceRow): Target | undefined {
  return row.endpoint && row.p256dh && row.auth
    ? {
        deviceId: row.id,
        label: row.label,
        endpoint: row.endpoint,
        p256dh: row.p256dh,
        auth: row.auth,
        confirms: row.receipt_at !== null,
      }
    : undefined;
}

export function deviceInfo(row: DeviceRow): DeviceInfo {
  return {
    id: row.id,
    label: row.label,
    push: { enabled: row.endpoint !== null, receiptAt: row.receipt_at },
  };
}

export class Devices {
  constructor(private readonly sql: Sql) {}

  /** Revoked devices count too, so the setup code works only once. */
  everEnrolled(): boolean {
    return count(this.sql, 'SELECT COUNT(*) AS count FROM devices') > 0;
  }

  get(id: string): DeviceRow | undefined {
    return this.sql.exec<DeviceRow>('SELECT * FROM devices WHERE id = ? AND revoked = 0', id).toArray()[0];
  }

  byKey(installKey: string): DeviceRow | undefined {
    return this.sql
      .exec<DeviceRow>('SELECT * FROM devices WHERE install_key = ? AND revoked = 0', installKey)
      .toArray()[0];
  }

  all(): DeviceRow[] {
    return this.sql.exec<DeviceRow>('SELECT * FROM devices WHERE revoked = 0 ORDER BY created_at').toArray();
  }

  enrolled(credential: string, installKey: string): DeviceRow | undefined {
    return this.sql
      .exec<DeviceRow>(
        `SELECT devices.* FROM enrollments JOIN devices ON devices.id = enrollments.device_id
       WHERE enrollments.credential = ? AND enrollments.install_key = ? AND devices.revoked = 0`,
        credential,
        installKey,
      )
      .toArray()[0];
  }

  recordEnrollment(credential: string, installKey: string, deviceId: string): void {
    this.sql.exec(
      'INSERT INTO enrollments (credential, install_key, device_id) VALUES (?, ?, ?) ON CONFLICT DO NOTHING',
      credential,
      installKey,
      deviceId,
    );
  }

  add(id: string, input: DeviceInput, now: number): void {
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

  touch(id: string, zone: string, now: number): void {
    this.sql.exec('UPDATE devices SET zone = ?, seen_at = ? WHERE id = ?', zone, now, id);
  }

  revoke(id: string): void {
    this.sql.exec(
      `UPDATE devices SET revoked = 1, install_key = install_key || ':revoked:' || id,
         endpoint = NULL, p256dh = NULL, auth = NULL WHERE id = ?`,
      id,
    );
  }

  /** A push endpoint belongs to one device: a reinstalled app that inherits it takes it from its old enrollment, which
   * would otherwise be sent every notification a second time. */
  subscribe(id: string, keys: PushKeys | null): void {
    if (keys) {
      this.sql.exec(
        'UPDATE devices SET endpoint = NULL, p256dh = NULL, auth = NULL WHERE endpoint = ? AND id != ?',
        keys.endpoint,
        id,
      );
    }
    this.sql.exec(
      'UPDATE devices SET endpoint = ?, p256dh = ?, auth = ? WHERE id = ?',
      keys?.endpoint ?? null,
      keys?.p256dh ?? null,
      keys?.auth ?? null,
      id,
    );
  }

  confirmed(id: string, now: number): void {
    this.sql.exec('UPDATE devices SET receipt_at = ? WHERE id = ?', now, id);
  }

  target(deviceId: string): Target | undefined {
    const row = this.get(deviceId);
    return row && target(row);
  }

  targets(): Target[] {
    return this.all().flatMap((row) => target(row) ?? []);
  }

  dropSubscription(sent: Target): void {
    this.sql.exec(
      'UPDATE devices SET endpoint = NULL, p256dh = NULL, auth = NULL WHERE id = ? AND endpoint = ?',
      sent.deviceId,
      sent.endpoint,
    );
  }
}
