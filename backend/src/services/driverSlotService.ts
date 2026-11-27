import { isValidObjectId, Types, type ClientSession } from 'mongoose';
import { withTransaction } from '../config/database.js';
import { Corridor, type CorridorSlotSchedule, type ICorridor } from '../models/Corridor.js';
import { DriverContract } from '../models/DriverContract.js';
import { DriverProfile } from '../models/DriverProfile.js';
import {
  DriverSlotCommitment,
  type IDriverSlotCommitment,
} from '../models/DriverSlotCommitment.js';
import { Pool } from '../models/Pool.js';
import { Slot, type ISlot } from '../models/Slot.js';
import { Trip } from '../models/Trip.js';
import { Vehicle } from '../models/Vehicle.js';
import { HttpError } from '../utils/errors.js';
import { sendLifecycleNotification } from './notificationService.js';

export function resolveSlotNumber(slot: Pick<ISlot, 'slotNumber' | 'slotCode'>): 1 | 2 | null {
  if (slot.slotNumber === 1 || slot.slotNumber === 2) {
    return slot.slotNumber;
  }
  const upper = slot.slotCode.toUpperCase();
  if (upper.endsWith('-AM') || upper.includes('SLOT1')) return 1;
  if (upper.endsWith('-PM') || upper.includes('SLOT2')) return 2;
  return null;
}

export function resolveSlotTemplateForSlot(
  corridor: Pick<ICorridor, 'slotSchedules'>,
  slot: Pick<ISlot, 'slotNumber' | 'slotCode' | 'returnTimeOptions' | 'returnTimeLocked' | 'lockedReturnTime' | 'plannedDepartureAt' | 'estimatedArrivalStartAt'>
): CorridorSlotSchedule | null {
  const slotNum = resolveSlotNumber(slot);
  if (slotNum) {
    const matched = corridor.slotSchedules.find((s) => s.slotNumber === slotNum);
    if (matched) return matched;
  }
  return corridor.slotSchedules[0] ?? null;
}

export function combineDateAndTime(baseDate: Date, timeHhMm: string): Date {
  const [h, m] = timeHhMm.split(':').map((n) => Number(n));
  const out = new Date(baseDate);
  out.setHours(h, m, 0, 0);
  return out;
}

function isSameCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Notifies all active Tier 1 contract drivers eligible for a corridor when a pooling window is open.
 * Best-effort idempotent notification using IN_APP log entries.
 */
export async function notifyEligibleTier1DriversForSlot(params: {
  corridor: ICorridor;
  slot: ISlot;
}): Promise<number> {
  const { corridor, slot } = params;
  if (!corridor.isActive || slot.status !== 'OPEN') {
    return 0;
  }

  const slotDate = new Date(slot.departureDate);
  const contracts = await DriverContract.find({
    status: 'ACTIVE',
    eligibleCorridorIds: corridor._id,
    startDate: { $lte: slotDate },
    endDate: { $gte: slotDate },
  });

  let notified = 0;
  for (const contract of contracts) {
    const profile = await DriverProfile.findOne({
      _id: contract.driverProfileId,
      fleetTier: 'TIER_1',
      accountStatus: 'ACTIVE',
    });
    if (!profile || !profile.vehicleId) continue;

    const vehicle = await Vehicle.findById(profile.vehicleId);
    if (
      !vehicle ||
      vehicle.ownershipType !== 'DRIVER_OWNED' ||
      vehicle.operationalStatus !== 'ACTIVE' ||
      !vehicle.isAvailable
    ) {
      continue;
    }

    await sendLifecycleNotification({
      recipientUserId: profile.userId,
      eventType: 'POOLING_WINDOW_OPEN',
      dedupeKey: `POOLING_WINDOW_OPEN:${String(slot._id)}:${String(profile.userId)}`,
      vars: {
        corridorCode: corridor.code,
        corridorName: corridor.name,
        slotLabel: slot.label,
        departureDate: slotDate.toISOString().slice(0, 10),
        cutoffTime: new Date(slot.cutoffAt).toISOString(),
      },
      metadata: {
        corridorId: String(corridor._id),
        slotId: String(slot._id),
        slotCode: slot.slotCode,
      },
    });
    notified += 1;
  }

  return notified;
}

/**
 * Lists eligible open pooling windows for an authenticated Tier 1 contract driver,
 * together with existing slot participation commitments.
 */
export async function listOpenPoolingSlotsForDriver(params: {
  driverUserId: string;
  now?: Date;
}) {
  const { driverUserId, now = new Date() } = params;
  if (!isValidObjectId(driverUserId)) {
    throw new HttpError(400, 'Invalid driver identity', 'VALIDATION_ERROR');
  }

  const profile = await DriverProfile.findOne({ userId: driverUserId });
  if (!profile) {
    throw new HttpError(404, 'Driver profile not found', 'NOT_FOUND');
  }

  const recentCommitments = await DriverSlotCommitment.find({ driverUserId })
    .populate('corridorId', 'code name')
    .populate('slotId', 'slotCode label departureDate cutoffAt status')
    .sort({ departureDate: -1, createdAt: -1 })
    .limit(20);

  if (profile.fleetTier !== 'TIER_1') {
    return {
      eligible: false,
      ineligibleReason:
        'Scheduled corridor pooling slot commitments apply exclusively to Tier 1 contract drivers.',
      slots: [],
      commitments: recentCommitments,
    };
  }

  if (profile.accountStatus !== 'ACTIVE') {
    return {
      eligible: false,
      ineligibleReason: `Your driver account is currently ${profile.accountStatus}. Contact Platform Owner before committing to pooling windows.`,
      slots: [],
      commitments: recentCommitments,
    };
  }

  const vehicle = profile.vehicleId ? await Vehicle.findById(profile.vehicleId) : null;
  if (
    !vehicle ||
    vehicle.ownershipType !== 'DRIVER_OWNED' ||
    vehicle.operationalStatus !== 'ACTIVE' ||
    !vehicle.isAvailable
  ) {
    return {
      eligible: false,
      ineligibleReason:
        'Your registered DRIVER_OWNED vehicle must be ACTIVE and available to participate in pooling windows.',
      slots: [],
      commitments: recentCommitments,
    };
  }

  const activeContracts = await DriverContract.find({
    driverUserId,
    status: 'ACTIVE',
    endDate: { $gte: now },
  });

  if (activeContracts.length === 0) {
    return {
      eligible: false,
      ineligibleReason: 'No active Tier 1 contract covers upcoming pooling dates.',
      slots: [],
      commitments: recentCommitments,
    };
  }

  const eligibleCorridorIds = Array.from(
    new Set(
      activeContracts.flatMap((c) => c.eligibleCorridorIds.map((cid) => String(cid)))
    )
  ).map((id) => new Types.ObjectId(id));

  if (eligibleCorridorIds.length === 0) {
    return {
      eligible: true,
      slots: [],
      commitments: recentCommitments,
    };
  }

  const activeCorridors = await Corridor.find({
    _id: { $in: eligibleCorridorIds },
    isActive: true,
  });
  const corridorById = new Map(activeCorridors.map((c) => [String(c._id), c]));

  const openSlots = await Slot.find({
    corridorId: { $in: activeCorridors.map((c) => c._id) },
    status: 'OPEN',
    cutoffAt: { $gt: now },
  }).sort({ plannedDepartureAt: 1 });

  const openSlotIds = openSlots.map((s) => s._id);
  const pools = await Pool.find({ slotId: { $in: openSlotIds } });
  const poolBySlotId = new Map(pools.map((p) => [String(p.slotId), p]));

  const slotCommitments = await DriverSlotCommitment.find({
    slotId: { $in: openSlotIds },
    driverUserId,
  });
  const commitmentBySlotId = new Map(slotCommitments.map((c) => [String(c.slotId), c]));

  const items = openSlots
    .map((slot) => {
      const corridor = corridorById.get(String(slot.corridorId));
      if (!corridor) return null;

      // Verify at least one active contract covers this exact slot departureDate
      const slotMs = new Date(slot.departureDate).getTime();
      const hasValidContractForDate = activeContracts.some(
        (c) =>
          c.eligibleCorridorIds.some((cid) => cid.equals(corridor._id)) &&
          slotMs >= new Date(c.startDate).getTime() &&
          slotMs <= new Date(c.endDate).getTime()
      );
      if (!hasValidContractForDate) return null;

      const template = resolveSlotTemplateForSlot(corridor, slot);
      const pool = poolBySlotId.get(String(slot._id));
      const commitment = commitmentBySlotId.get(String(slot._id)) ?? null;

      return {
        slotId: String(slot._id),
        slotCode: slot.slotCode,
        slotNumber: resolveSlotNumber(slot) ?? template?.slotNumber ?? 1,
        label: slot.label,
        departureDate: slot.departureDate,
        cutoffAt: slot.cutoffAt,
        plannedDepartureAt: slot.plannedDepartureAt,
        corridor: {
          _id: String(corridor._id),
          code: corridor.code,
          name: corridor.name,
          stops: corridor.stops,
        },
        template: {
          outboundPickupTime: template?.outboundPickupTime ?? '09:00',
          returnTimeOptions:
            slot.returnTimeOptions && slot.returnTimeOptions.length > 0
              ? slot.returnTimeOptions
              : template?.returnTimeOptions ?? [],
          defaultReturnTime: template?.defaultReturnTime ?? '',
          returnTimeLocked: Boolean(slot.returnTimeLocked ?? template?.returnTimeLocked),
          lockedReturnTime: slot.lockedReturnTime ?? template?.lockedReturnTime,
        },
        poolSummary: pool
          ? {
              poolId: String(pool._id),
              poolCode: pool.poolCode,
              status: pool.status,
              shipmentCount: pool.shipmentIds.length,
              reservedWeightKg: pool.reservedWeightKg,
              reservedVolumeCbm: pool.reservedVolumeCbm,
            }
          : null,
        commitment,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  return {
    eligible: true,
    vehicle: {
      _id: String(vehicle._id),
      registrationNumber: vehicle.registrationNumber,
      vehicleClass: vehicle.vehicleClass,
      maxWeightKg: vehicle.maxWeightKg,
      maxVolumeCbm: vehicle.maxVolumeCbm,
    },
    slots: items,
    commitments: recentCommitments,
  };
}

/**
 * Allows an eligible active Tier 1 driver to submit or update slot availability commitment
 * before the pooling window cutoff deadline.
 */
export async function submitDriverSlotCommitment(params: {
  driverUserId: string;
  slotId: string;
  selectedReturnTime?: string;
  now?: Date;
}): Promise<{ commitment: IDriverSlotCommitment }> {
  const { driverUserId, slotId, selectedReturnTime, now = new Date() } = params;
  if (!isValidObjectId(driverUserId) || !isValidObjectId(slotId)) {
    throw new HttpError(400, 'Invalid driver or slot identifier', 'VALIDATION_ERROR');
  }

  return withTransaction(async (session) => {
    const slot = await Slot.findById(slotId).session(session);
    if (!slot) {
      throw new HttpError(404, 'Pooling slot not found', 'SLOT_NOT_FOUND');
    }

    const corridor = await Corridor.findById(slot.corridorId).session(session);
    if (!corridor) {
      throw new HttpError(404, 'Corridor not found', 'CORRIDOR_NOT_FOUND');
    }
    if (!corridor.isActive) {
      throw new HttpError(
        409,
        `Corridor ${corridor.code} is inactive and cannot accept slot selections.`,
        'CORRIDOR_INACTIVE'
      );
    }

    if (slot.status !== 'OPEN' || now >= slot.cutoffAt) {
      throw new HttpError(
        409,
        `Pooling window for ${slot.slotCode} is closed or past its deadline.`,
        'POOLING_WINDOW_CLOSED'
      );
    }

    const profile = await DriverProfile.findOne({ userId: driverUserId }).session(session);
    if (!profile || profile.fleetTier !== 'TIER_1') {
      throw new HttpError(
        403,
        'Only Tier 1 contract drivers may commit to corridor pooling slots.',
        'TIER1_REQUIRED'
      );
    }
    if (profile.accountStatus !== 'ACTIVE') {
      throw new HttpError(
        403,
        `Driver account is ${profile.accountStatus} and cannot commit to pooling slots.`,
        'DRIVER_INACTIVE'
      );
    }
    if (profile.availabilityStatus === 'OFFLINE') {
      throw new HttpError(
        409,
        'Set your driver availability status to AVAILABLE before committing to pooling windows.',
        'DRIVER_OFFLINE'
      );
    }

    const vehicle = profile.vehicleId
      ? await Vehicle.findById(profile.vehicleId).session(session)
      : null;
    if (
      !vehicle ||
      vehicle.ownershipType !== 'DRIVER_OWNED' ||
      vehicle.operationalStatus !== 'ACTIVE' ||
      !vehicle.isAvailable
    ) {
      throw new HttpError(
        409,
        'An ACTIVE, available DRIVER_OWNED vehicle is required to participate in pooling windows.',
        'VEHICLE_INACTIVE'
      );
    }

    const slotDate = new Date(slot.departureDate);
    const activeContract = await DriverContract.findOne({
      driverUserId,
      status: 'ACTIVE',
      eligibleCorridorIds: corridor._id,
      startDate: { $lte: slotDate },
      endDate: { $gte: slotDate },
    }).session(session);

    if (!activeContract) {
      throw new HttpError(
        403,
        `Your active contract does not include corridor ${corridor.code} on ${slotDate.toISOString().slice(0, 10)}.`,
        'CONTRACT_CORRIDOR_INELIGIBLE'
      );
    }

    const template = resolveSlotTemplateForSlot(corridor, slot);
    if (!template) {
      throw new HttpError(409, 'Corridor slot schedule template is missing.', 'TEMPLATE_MISSING');
    }

    const slotNum = template.slotNumber;
    const pickupTime = template.outboundPickupTime;
    const isLockedReturn = Boolean(slot.returnTimeLocked ?? template.returnTimeLocked);
    const lockedReturn = slot.lockedReturnTime ?? template.lockedReturnTime;
    const allowedReturns =
      slot.returnTimeOptions && slot.returnTimeOptions.length > 0
        ? slot.returnTimeOptions
        : template.returnTimeOptions;

    let finalReturnTime: string;
    if (slotNum === 2 || isLockedReturn) {
      if (!lockedReturn) {
        throw new HttpError(409, 'Slot 2 locked return timing is not configured.', 'TEMPLATE_INVALID');
      }
      if (selectedReturnTime && selectedReturnTime.trim() !== lockedReturn) {
        throw new HttpError(
          400,
          `Slot 2 mandatory return timing is locked to ${lockedReturn} and cannot be overridden.`,
          'RETURN_TIME_LOCKED'
        );
      }
      finalReturnTime = lockedReturn;
    } else {
      if (!selectedReturnTime || !selectedReturnTime.trim()) {
        throw new HttpError(
          400,
          'Please choose one of the permitted return timings for Slot 1.',
          'RETURN_TIME_REQUIRED'
        );
      }
      const trimmed = selectedReturnTime.trim();
      if (!allowedReturns.includes(trimmed)) {
        throw new HttpError(
          400,
          `Selected return time '${trimmed}' is not permitted for this corridor slot. Allowed: ${allowedReturns.join(', ')}`,
          'INVALID_RETURN_OPTION'
        );
      }
      finalReturnTime = trimmed;
    }

    const windowStart = combineDateAndTime(slot.departureDate, pickupTime);
    let windowEnd = combineDateAndTime(slot.departureDate, finalReturnTime);
    if (windowEnd <= windowStart) {
      windowEnd = new Date(windowEnd.getTime() + 24 * 60 * 60 * 1000);
    }

    // Prevent conflicting same-day commitments across overlapping slots
    const existingOtherCommitments = await DriverSlotCommitment.find({
      driverUserId,
      status: 'COMMITTED',
      slotId: { $ne: slot._id },
    }).session(session);

    for (const other of existingOtherCommitments) {
      if (!isSameCalendarDay(new Date(other.departureDate), slotDate)) {
        continue;
      }
      const otherStart = combineDateAndTime(other.departureDate, other.selectedPickupTime);
      let otherEnd = combineDateAndTime(other.departureDate, other.selectedReturnTime);
      if (otherEnd <= otherStart) {
        otherEnd = new Date(otherEnd.getTime() + 24 * 60 * 60 * 1000);
      }
      if (windowStart < otherEnd && windowEnd > otherStart) {
        throw new HttpError(
          409,
          `Conflicting slot commitment on ${slotDate.toISOString().slice(0, 10)}: overlaps existing commitment (${other.selectedPickupTime}–${other.selectedReturnTime}).`,
          'CONFLICTING_SLOT_COMMITMENT'
        );
      }
    }

    // Check overlapping already-assigned trips
    const overlappingTrip = await Trip.findOne({
      driverId: profile.userId,
      status: { $in: ['ASSIGNED', 'DRIVER_ACCEPTED', 'IN_PROGRESS', 'PAUSED'] },
      plannedDepartureAt: { $lt: windowEnd },
      estimatedEndAt: { $gt: windowStart },
    }).session(session);

    if (overlappingTrip) {
      throw new HttpError(
        409,
        `You already have an active trip (${overlappingTrip.tripCode}) overlapping this time window.`,
        'CONFLICTING_TRIP_COMMITMENT'
      );
    }

    const pool = await Pool.findOne({ slotId: slot._id }).session(session);

    const commitment = await DriverSlotCommitment.findOneAndUpdate(
      { slotId: slot._id, driverUserId: profile.userId },
      {
        $set: {
          corridorId: corridor._id,
          slotId: slot._id,
          ...(pool ? { poolId: pool._id } : {}),
          driverUserId: profile.userId,
          driverProfileId: profile._id,
          vehicleId: vehicle._id,
          slotNumber: slotNum,
          departureDate: slot.departureDate,
          selectedPickupTime: pickupTime,
          selectedReturnTime: finalReturnTime,
          status: 'COMMITTED',
          committedAt: now,
        },
        $unset: {
          withdrawnAt: '',
          invalidationReason: '',
        },
      },
      { upsert: true, returnDocument: 'after', session: session ?? undefined }
    );

    return { commitment };
  });
}

export async function withdrawDriverSlotCommitment(params: {
  driverUserId: string;
  slotId: string;
  now?: Date;
}) {
  const { driverUserId, slotId, now = new Date() } = params;
  if (!isValidObjectId(driverUserId) || !isValidObjectId(slotId)) {
    throw new HttpError(400, 'Invalid driver or slot identifier', 'VALIDATION_ERROR');
  }

  return withTransaction(async (session) => {
    const slot = await Slot.findById(slotId).session(session);
    if (!slot) {
      throw new HttpError(404, 'Pooling slot not found', 'SLOT_NOT_FOUND');
    }
    if (slot.status !== 'OPEN' || now >= slot.cutoffAt) {
      throw new HttpError(
        409,
        `Cannot withdraw after pooling window ${slot.slotCode} has closed or locked.`,
        'POOLING_WINDOW_CLOSED'
      );
    }

    const commitment = await DriverSlotCommitment.findOne({
      slotId: slot._id,
      driverUserId,
    }).session(session);
    if (!commitment || commitment.status === 'WITHDRAWN') {
      throw new HttpError(404, 'No active slot commitment found to withdraw.', 'NOT_FOUND');
    }

    commitment.status = 'WITHDRAWN';
    commitment.withdrawnAt = now;
    await commitment.save({ session: session ?? undefined });

    return { commitment };
  });
}

/**
 * Re-validates all COMMITTED Tier 1 driver commitments when a pooling window closes.
 * Invalidates commitments whose driver, vehicle, corridor, contract, or overlap status failed.
 */
export async function validateCommitmentsAtWindowClose(params: {
  slot: ISlot;
  corridor: ICorridor;
  session: ClientSession | null;
}): Promise<{
  validCommitments: IDriverSlotCommitment[];
  invalidatedCount: number;
}> {
  const { slot, corridor, session } = params;

  const commitments = await DriverSlotCommitment.find({
    slotId: slot._id,
    status: 'COMMITTED',
  }).session(session);

  const validCommitments: IDriverSlotCommitment[] = [];
  let invalidatedCount = 0;

  for (const commitment of commitments) {
    let reason: string | null = null;

    if (!corridor.isActive) {
      reason = 'CORRIDOR_INACTIVE';
    }

    const profile = !reason
      ? await DriverProfile.findOne({
          _id: commitment.driverProfileId,
          fleetTier: 'TIER_1',
        }).session(session)
      : null;

    if (!reason && (!profile || profile.accountStatus !== 'ACTIVE' || profile.availabilityStatus !== 'AVAILABLE')) {
      reason = 'DRIVER_UNAVAILABLE_OR_INACTIVE';
    }

    const vehicle = !reason
      ? await Vehicle.findById(commitment.vehicleId).session(session)
      : null;
    if (
      !reason &&
      (!vehicle ||
        vehicle.ownershipType !== 'DRIVER_OWNED' ||
        vehicle.operationalStatus !== 'ACTIVE' ||
        !vehicle.isAvailable)
    ) {
      reason = 'VEHICLE_INACTIVE_OR_UNAVAILABLE';
    }

    const slotDate = new Date(slot.departureDate);
    const activeContract = !reason
      ? await DriverContract.findOne({
          driverUserId: commitment.driverUserId,
          status: 'ACTIVE',
          eligibleCorridorIds: corridor._id,
          startDate: { $lte: slotDate },
          endDate: { $gte: slotDate },
        }).session(session)
      : null;

    if (!reason && !activeContract) {
      reason = 'CONTRACT_INELIGIBLE_FOR_CORRIDOR';
    }

    if (!reason) {
      const windowStart = combineDateAndTime(slot.departureDate, commitment.selectedPickupTime);
      let windowEnd = combineDateAndTime(slot.departureDate, commitment.selectedReturnTime);
      if (windowEnd <= windowStart) {
        windowEnd = new Date(windowEnd.getTime() + 24 * 60 * 60 * 1000);
      }

      const conflictingTrip = await Trip.findOne({
        driverId: commitment.driverUserId,
        status: { $in: ['ASSIGNED', 'DRIVER_ACCEPTED', 'IN_PROGRESS', 'PAUSED'] },
        plannedDepartureAt: { $lt: windowEnd },
        estimatedEndAt: { $gt: windowStart },
      }).session(session);

      if (conflictingTrip) {
        reason = `CONFLICTING_TRIP_${conflictingTrip.tripCode}`;
      }
    }

    if (reason) {
      commitment.status = 'INVALIDATED';
      commitment.invalidationReason = reason;
      await commitment.save({ session: session ?? undefined });
      invalidatedCount += 1;
    } else {
      validCommitments.push(commitment);
    }
  }

  return { validCommitments, invalidatedCount };
}
