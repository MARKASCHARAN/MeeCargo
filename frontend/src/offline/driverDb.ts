import Dexie, { type Table } from 'dexie';
import type { TripSummary } from '../types/api';

export interface CachedTripRecord {
  tripId: string;
  trip: TripSummary;
  cachedAt: string;
}

export interface OfflineSyncEventRecord {
  id?: number;
  idempotencyKey: string;
  tripId: string;
  kind: 'TRIP_STATUS' | 'SHIPMENT_STATUS';
  targetStatus: string;
  shipmentId?: string;
  reason?: string;
  occurredAt: string;
  syncStatus: 'PENDING' | 'SYNCED' | 'CONFLICT';
  syncMessage?: string;
}

class MeeCargoDriverDexie extends Dexie {
  cachedTrips!: Table<CachedTripRecord, string>;
  offlineEvents!: Table<OfflineSyncEventRecord, number>;

  constructor() {
    super('MeeCargoDriverDB');
    this.version(1).stores({
      cachedTrips: 'tripId, cachedAt',
      offlineEvents: '++id, idempotencyKey, tripId, syncStatus',
    });
  }
}

export const driverDb = new MeeCargoDriverDexie();

export async function cacheTripsOffline(trips: TripSummary[]): Promise<void> {
  const now = new Date().toISOString();
  await driverDb.cachedTrips.bulkPut(
    trips.map((t) => ({ tripId: t._id, trip: t, cachedAt: now }))
  );
}

export async function getCachedTripsOffline(): Promise<TripSummary[]> {
  const rows = await driverDb.cachedTrips.toArray();
  return rows.map((r) => r.trip);
}

export async function queueOfflineEvent(
  event: Omit<OfflineSyncEventRecord, 'id' | 'syncStatus'>
): Promise<number> {
  return driverDb.offlineEvents.add({
    ...event,
    syncStatus: 'PENDING',
  });
}
