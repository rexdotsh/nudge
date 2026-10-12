import { count, type Sql } from './sql';

export const DELIVERY_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS deliveries (
    fire TEXT NOT NULL,
    device_id TEXT NOT NULL,
    title TEXT NOT NULL,
    topic TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    scheduled_at INTEGER NOT NULL,
    lease TEXT,
    sends INTEGER NOT NULL DEFAULT 0,
    status INTEGER NOT NULL DEFAULT 0,
    sent_at INTEGER,
    receipt_at INTEGER,
    next_at INTEGER,
    PRIMARY KEY (fire, device_id)
  )`,
  `CREATE INDEX IF NOT EXISTS deliveries_by_next_at ON deliveries (next_at) WHERE next_at IS NOT NULL`,
];

export type DeliveryRow = {
  fire: string;
  device_id: string;
  title: string;
  topic: string;
  payload: string;
  created_at: number;
  scheduled_at: number;
  lease: string | null;
  sends: number;
  status: number;
  sent_at: number | null;
  receipt_at: number | null;
  next_at: number | null;
};

export type Outgoing = Pick<DeliveryRow, 'fire' | 'title' | 'topic' | 'payload'>;

export class Deliveries {
  constructor(private readonly sql: Sql) {}

  queue(outgoing: Outgoing, deviceId: string, at: number, now: number): void {
    this.sql.exec(
      `INSERT INTO deliveries (fire, device_id, title, topic, payload, created_at, scheduled_at, next_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (fire, device_id) DO NOTHING`,
      outgoing.fire,
      deviceId,
      outgoing.title,
      outgoing.topic,
      outgoing.payload,
      now,
      at,
      at,
    );
  }

  pendingCount(firePrefix: string): number {
    return count(
      this.sql,
      "SELECT COUNT(DISTINCT fire) AS count FROM deliveries WHERE sends = 0 AND next_at IS NOT NULL AND fire LIKE ? || '%'",
      firePrefix,
    );
  }

  claim(now: number, leaseMs: number, lease: string): DeliveryRow[] {
    return this.sql
      .exec<DeliveryRow>(
        'UPDATE deliveries SET next_at = ?, lease = ? WHERE next_at <= ? AND receipt_at IS NULL RETURNING *',
        now + leaseMs,
        lease,
        now,
      )
      .toArray();
  }

  recordSend(row: DeliveryRow, status: number, nextAt: number | null, now: number): boolean {
    return (
      this.sql
        .exec<{ fire: string }>(
          `UPDATE deliveries SET sends = sends + 1, status = ?, sent_at = ?, lease = NULL,
             next_at = CASE WHEN receipt_at IS NULL THEN ? ELSE NULL END
           WHERE fire = ? AND device_id = ? AND lease = ? RETURNING fire`,
          status,
          now,
          nextAt,
          row.fire,
          row.device_id,
          row.lease,
        )
        .toArray().length > 0
    );
  }

  owns(row: DeliveryRow): boolean {
    return (
      count(
        this.sql,
        'SELECT COUNT(*) AS count FROM deliveries WHERE fire = ? AND device_id = ? AND lease = ? AND receipt_at IS NULL',
        row.fire,
        row.device_id,
        row.lease,
      ) > 0
    );
  }

  release(row: DeliveryRow, nextAt: number | null): void {
    this.sql.exec(
      `UPDATE deliveries SET next_at = CASE WHEN receipt_at IS NULL THEN ? ELSE NULL END, lease = NULL
       WHERE fire = ? AND device_id = ? AND lease = ?`,
      nextAt,
      row.fire,
      row.device_id,
      row.lease,
    );
  }

  // A later fire of an occurrence replaces the earlier ones on screen (same tag) and in the push service's queue (same
  // topic), so its receipt also answers for them.
  confirm(fire: string, deviceId: string, now: number): void {
    this.sql.exec(
      `UPDATE deliveries SET receipt_at = ?, next_at = NULL
       WHERE device_id = ? AND receipt_at IS NULL AND EXISTS (
         SELECT 1 FROM deliveries AS shown
         WHERE shown.fire = ? AND shown.device_id = deliveries.device_id
           AND shown.topic = deliveries.topic AND shown.scheduled_at >= deliveries.scheduled_at
       )`,
      now,
      deviceId,
      fire,
    );
  }

  cancelForReminder(reminderId: string): void {
    this.sql.exec(
      `UPDATE deliveries SET next_at = NULL, lease = NULL
       WHERE next_at IS NOT NULL AND substr(fire, 1, length(?) + 1) = ? || '@'`,
      reminderId,
      reminderId,
    );
  }

  cancelForDevice(deviceId: string): void {
    this.sql.exec('UPDATE deliveries SET next_at = NULL, lease = NULL WHERE device_id = ?', deviceId);
  }

  purge(before: number): void {
    this.sql.exec('DELETE FROM deliveries WHERE created_at < ? AND next_at IS NULL', before);
  }
}
