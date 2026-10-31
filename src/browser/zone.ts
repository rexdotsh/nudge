import type { InstanceZone, SyncRequest, SyncResponse } from '../shared/api';
import { ulid } from '../shared/ulid';
import type { ZoneState } from './schema';

const unsynced = (here: string): ZoneState => ({
  zone: { name: here, fixed: false },
  reported: here,
  version: 0,
  pending: null,
});

/**
 * The zone this device plans and shows reminders in: a choice it has not sent yet, else the instance zone it last
 * heard of. While the zone follows the devices, a move this one has not reported yet is foreseen, because the server
 * adopts it on the next sync.
 */
export function instanceZone(state: ZoneState | undefined, here: string): InstanceZone {
  const { zone, reported, pending } = state ?? unsynced(here);
  if (pending) return { name: pending.zone ?? here, fixed: pending.zone !== null };
  return zone.fixed || reported === here ? zone : { name: here, fixed: false };
}

export function chosenZone(state: ZoneState | undefined, zone: string | null, here: string): ZoneState {
  return { ...(state ?? unsynced(here)), pending: { id: ulid(), zone, at: Date.now() } };
}

export function receivedZone(state: ZoneState | undefined, sent: SyncRequest, response: SyncResponse): ZoneState {
  return {
    ...(!state || response.reset || response.version >= state.version
      ? { zone: response.zone, version: response.version, reported: sent.zone }
      : state),
    pending: state?.pending && state.pending.id !== sent.zoneChoice?.id ? state.pending : null,
  };
}
