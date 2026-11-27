import crypto from 'node:crypto';
import { isValidObjectId, type ClientSession, type Types } from 'mongoose';
import { withTransaction } from '../config/database.js';
import { Corridor } from '../models/Corridor.js';
import { DriverProfile } from '../models/DriverProfile.js';
import { NotificationLog } from '../models/NotificationLog.js';
import { Pool } from '../models/Pool.js';
import { Shipment } from '../models/Shipment.js';
import { Slot } from '../models/Slot.js';
import { Trip, type ITrip } from '../models/Trip.js';
import { emitDriverAssignment, emitPoolUpdated } from '../socket/poolGateway.js';
import { HttpError } from '../utils/errors.js';
import { allocateVehicleForPool } from './fleetAllocator.js';
import { evaluateBackhaulForTrip } from './backhaulService.js';
import { buildPoolLiveEvent } from './poolService.js';
import { getActivePricingRules } from './pricingEngine.js';
import { optimizeAndPlanTripRoute } from './routePlanningService.js';

export async function hasOverlappingDriverTrip(params: {
  driverId: Types.ObjectId | string;
  windowStart: Date;
  windowEnd: Date;
  excludeTripId?: Types.ObjectId;
  session?: ClientSession | null;
}): Promise<boolean> {
  const { driverId, windowStart, windowEnd, excludeTripId, session = null } = params;
  const query: Record<string, unknown> = {
    driverId,
    status: { $in: ['ASSIGNED', 'DRIVER_ACCEPTED', 'IN_PROGRESS', 'PAUSED'] },
    plannedDepartureAt: { $lt: windowEnd },
    estimatedEndAt: { $gt: windowStart },
  };
  if (excludeTripId) {
    query._id = { $ne: excludeTripId };
  }
  const conflict = await Trip.findOne(query).select('_id tripCode').session(session);
  return Boolean(conflict);
}

async function selectEligibleDriver(params: {
  preferredDriverId?: Types.ObjectId;
  tier: 'TIER_1' | 'TIER_2' | 'TIER_3';
  windowStart: Date;
  windowEnd: Date;
  excludeDriverIds?: string[];
  session: ClientSession | null;
}) {
  const {
    preferredDriverId,
    tier,
    windowStart,
    windowEnd,
    excludeDriverIds = [],
    session,
  } = params;

  const excluded = new Set(excludeDriverIds);

  if (preferredDriverId && !excluded.has(String(preferredDriverId))) {
    const preferred = await DriverProfile.findOne({
      userId: preferredDriverId,
      availabilityStatus: 'AVAILABLE',
    }).session(session);

    if (preferred) {
      const overlaps = await hasOverlappingDriverTrip({
        driverId: preferred.userId,
        windowStart,
        windowEnd,
        session,
      });
      if (!overlaps) {
        return preferred;
      }
    }
  }

  const candidates = await DriverProfile.find({
    availabilityStatus: 'AVAILABLE',
    userId: { $nin: Array.from(excluded) },
  })
    .sort({ fleetTier: 1 })
    .session(session);

  // Prefer matching fleetTier first, then fallback to other available drivers
  const ordered = [
    ...candidates.filter((c) => c.fleetTier === tier),
    ...candidates.filter((c) => c.fleetTier !== tier),
  ];

  for (const candidate of ordered) {
    const overlaps = await hasOverlappingDriverTrip({
      driverId: candidate.userId,
      windowStart,
      windowEnd,
      session,
    });
    if (!overlaps) {
      return candidate;
    }
  }

  return null;
}

async function notifyDriverAssignment(params: {
  driverId: Types.ObjectId;
  trip: ITrip;
  eventType: 'TRIP_ASSIGNED' | 'TRIP_REASSIGNED';
  message: string;
  session: ClientSession | null;
}) {
  const { driverId, trip, eventType, message, session } = params;
  const dedupeKey = `${eventType}:${String(trip._id)}:${String(driverId)}:${trip.assignmentHistory.length}`;

  await NotificationLog.findOneAndUpdate(
    { dedupeKey },
    {
      $setOnInsert: {
        recipientUserId: driverId,
        channel: 'IN_APP',
        eventType,
        title: `Trip ${trip.tripCode}`,
        message,
        dedupeKey,
        metadata: {
          tripId: String(trip._id),
          tripCode: trip.tripCode,
          vehicleId: String(trip.vehicleId),
          status: trip.status,
        },
      },
    },
    { upsert: true, returnDocument: 'after', session: session ?? undefined }
  );

  emitDriverAssignment(String(driverId), {
    tripId: String(trip._id),
    tripCode: trip.tripCode,
    status: trip.status,
    eventType,
    message,
    plannedDepartureAt: trip.plannedDepartureAt.toISOString(),
  });
}

export async function allocateAndAssignTripForPool(params: {
  poolId: string;
  actorUserId?: string;
  allowRightSizing?: boolean;
}) {
  const { poolId, actorUserId, allowRightSizing = true } = params;
  if (!isValidObjectId(poolId)) {
    throw new HttpError(400, 'Invalid poolId', 'VALIDATION_ERROR');
  }

  const outcome = await withTransaction(async (session) => {
    const existingTrip = await Trip.findOne({ poolId }).session(session);
    if (existingTrip) {
      return {
        allocated: true,
        driverAssigned: true,
        trip: existingTrip,
        idempotentHit: true,
        reason: 'Trip already allocated and assigned for this pool.',
      };
    }

    const pool = await Pool.findById(poolId).session(session);
    if (!pool) {
      throw new HttpError(404, 'Pool not found', 'POOL_NOT_FOUND');
    }
    if (pool.status !== 'LOCKED') {
      throw new HttpError(
        409,
        `Pool must be LOCKED before vehicle and driver allocation (current: ${pool.status}).`,
        'POOL_NOT_LOCKED'
      );
    }

    const corridor = await Corridor.findById(pool.corridorId).session(session);
    const slot = await Slot.findById(pool.slotId).session(session);
    const shipments = await Shipment.find({ _id: { $in: pool.shipmentIds } }).session(
      session
    );

    if (!corridor || !slot) {
      throw new HttpError(404, 'Corridor or slot missing', 'NOT_FOUND');
    }

    // Step 1: Vehicle allocation & tier hierarchy
    const allocation = await allocateVehicleForPool({
      pool,
      corridor,
      slot,
      shipments,
      allowRightSizing,
      session,
    });

    if (!allocation.allocated || !allocation.vehicle) {
      pool.status = 'AWAITING_VIABILITY_DECISION';
      pool.viabilityStatus = 'FAILED';
      pool.viabilityReason = allocation.reason;
      await pool.save({ session: session ?? undefined });

      for (const s of shipments) {
        s.viabilityDecision = 'PENDING_CHOICE';
        await s.save({ session: session ?? undefined });
      }

      const rules = await getActivePricingRules();
      emitPoolUpdated(buildPoolLiveEvent(pool, corridor, rules));

      return {
        allocated: false,
        driverAssigned: false,
        reason: allocation.reason,
      };
    }

    // Step 2: Driver assignment ONLY after vehicle allocation succeeds
    const eligibleDriver = await selectEligibleDriver({
      preferredDriverId: allocation.vehicle.driverId,
      tier: allocation.vehicle.tier,
      windowStart: slot.plannedDepartureAt,
      windowEnd: slot.estimatedArrivalEndAt,
      session,
    });

    if (!eligibleDriver) {
      // Do not silently proceed without a driver
      return {
        allocated: true,
        driverAssigned: false,
        vehicle: allocation.vehicle,
        reason:
          'Vehicle allocated, but no eligible non-overlapping driver is currently available. Trip cannot proceed silently.',
      };
    }

    const tripCode = `MC-TRIP-${new Date(slot.plannedDepartureAt)
      .toISOString()
      .slice(0, 10)
      .replace(/-/g, '')}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;

    const [trip] = await Trip.create(
      [
        {
          tripCode,
          poolId: pool._id,
          corridorId: corridor._id,
          slotId: slot._id,
          vehicleId: allocation.vehicle._id,
          driverId: eligibleDriver.userId,
          shipmentIds: shipments.map((s) => s._id),
          status: 'ASSIGNED',
          plannedDepartureAt: slot.plannedDepartureAt,
          estimatedEndAt: slot.estimatedArrivalEndAt,
          stopsSummary: corridor.stops.map((s) => ({
            stopCode: s.stopCode,
            name: s.name,
            sequenceOrder: s.sequenceOrder,
          })),
          allocationEconomics: allocation.economics,
          assignmentHistory: [
            {
              driverId: eligibleDriver.userId,
              vehicleId: allocation.vehicle._id,
              action: 'ASSIGNED',
              reason: allocation.reason,
              ...(actorUserId && isValidObjectId(actorUserId)
                ? { actorUserId }
                : {}),
              at: new Date(),
            },
          ],
          notes: allocation.reason,
        },
      ],
      { session: session ?? undefined }
    );

    await Shipment.updateMany(
      { _id: { $in: shipments.map((s) => s._id) } },
      { $set: { tripId: trip._id } },
      { session: session ?? undefined }
    );

    await notifyDriverAssignment({
      driverId: eligibleDriver.userId,
      trip,
      eventType: 'TRIP_ASSIGNED',
      message: `New ${allocation.vehicle.tier} trip ${trip.tripCode} assigned on ${corridor.name}.`,
      session,
    });

    return {
      allocated: true,
      driverAssigned: true,
      trip,
      vehicle: allocation.vehicle,
      economics: allocation.economics,
      reason: allocation.reason,
    };
  });

  if (outcome.trip && outcome.driverAssigned) {
    try {
      await optimizeAndPlanTripRoute({
        tripId: String(outcome.trip._id),
        actorUserId,
      });
      await evaluateBackhaulForTrip({
        tripId: String(outcome.trip._id),
        applyMatch: true,
      });
    } catch {
      // Best-effort post-assignment optimization; failures leave routePlan status honest
    }
  }

  return outcome;
}

export async function respondToTripAssignment(params: {
  tripId: string;
  driverUserId: string;
  decision: 'ACCEPT' | 'REJECT';
  reason?: string;
}) {
  const { tripId, driverUserId, decision, reason } = params;
  if (!isValidObjectId(tripId)) {
    throw new HttpError(400, 'Invalid trip ID', 'VALIDATION_ERROR');
  }

  return withTransaction(async (session) => {
    const trip = await Trip.findOne({
      _id: tripId,
      driverId: driverUserId,
    }).session(session);

    if (!trip) {
      throw new HttpError(403, 'Trip not found or not assigned to you', 'FORBIDDEN');
    }

    if (decision === 'ACCEPT') {
      if (trip.status === 'DRIVER_ACCEPTED') {
        return { trip, reassigned: false, message: 'Trip already accepted.' };
      }
      if (trip.status !== 'ASSIGNED') {
        throw new HttpError(
          409,
          `Cannot accept trip from status ${trip.status}`,
          'INVALID_TRANSITION'
        );
      }

      const overlaps = await hasOverlappingDriverTrip({
        driverId: trip.driverId,
        windowStart: trip.plannedDepartureAt,
        windowEnd: trip.estimatedEndAt,
        excludeTripId: trip._id,
        session,
      });

      if (overlaps) {
        throw new HttpError(
          409,
          'You already have an overlapping active trip in this schedule window.',
          'OVERLAPPING_TRIP'
        );
      }

      trip.status = 'DRIVER_ACCEPTED';
      trip.assignmentHistory.push({
        driverId: trip.driverId,
        vehicleId: trip.vehicleId,
        action: 'ACCEPTED',
        reason: 'Accepted by driver in PWA',
        actorUserId: trip.driverId,
        at: new Date(),
      });
      await trip.save({ session: session ?? undefined });

      return { trip, reassigned: false, message: 'Trip assignment accepted.' };
    }

    // Driver reports inability to execute -> auditable decline + try automatic reassignment
    if (!['ASSIGNED', 'DRIVER_ACCEPTED'].includes(trip.status)) {
      throw new HttpError(
        409,
        `Cannot report inability to execute from status ${trip.status}`,
        'INVALID_TRANSITION'
      );
    }

    const declineReason = reason?.trim() || 'Driver reported inability to execute';
    trip.assignmentHistory.push({
      driverId: trip.driverId,
      vehicleId: trip.vehicleId,
      action: 'DECLINED',
      reason: declineReason,
      actorUserId: trip.driverId,
      at: new Date(),
    });

    const fallbackDriver = await selectEligibleDriver({
      tier: trip.allocationEconomics?.allocatedTier ?? 'TIER_2',
      windowStart: trip.plannedDepartureAt,
      windowEnd: trip.estimatedEndAt,
      excludeDriverIds: [driverUserId],
      session,
    });

    if (!fallbackDriver) {
      trip.status = 'DRIVER_REJECTED';
      trip.assignmentHistory.push({
        vehicleId: trip.vehicleId,
        action: 'FAILED_NO_DRIVER',
        reason: 'No fallback non-overlapping driver available',
        at: new Date(),
      });
      await trip.save({ session: session ?? undefined });
      return {
        trip,
        reassigned: false,
        message: 'Decline recorded. No fallback driver available; trip halted safely.',
      };
    }

    trip.driverId = fallbackDriver.userId;
    trip.status = 'ASSIGNED';
    trip.assignmentHistory.push({
      driverId: fallbackDriver.userId,
      vehicleId: trip.vehicleId,
      action: 'REASSIGNED',
      reason: `Automated reassignment after previous driver declined: ${declineReason}`,
      at: new Date(),
    });
    await trip.save({ session: session ?? undefined });

    await notifyDriverAssignment({
      driverId: fallbackDriver.userId,
      trip,
      eventType: 'TRIP_REASSIGNED',
      message: `Reassigned trip ${trip.tripCode}: previous driver reported inability to execute.`,
      session,
    });

    return {
      trip,
      reassigned: true,
      message: 'Decline recorded and trip automatically reassigned to an available driver.',
    };
  });
}
