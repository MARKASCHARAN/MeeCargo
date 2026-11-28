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
  slot: Pick<
    ISlot,
    | 'slotNumber'
    | 'slotCode'
    | 'returnTimeOptions'
    | 'returnTimeLocked'
    | 'lockedReturnTime'
    | 'plannedDepartureAt'
    | 'estimatedArrivalStartAt'
  >
): CorridorSlotSchedule | null {
  const slotNum = resolveSlotNumber(slot);
  if (slotNum) {
    const matched = corridor.slotSchedules.find((s) => s.slotNumber === slotNum);
    if (matched) return matched;
  }
  return corridor.slotSchedules[0] ?? null;
}

export function toCorridorDateKey(
  date: Date | string,
  timeZone = 'Asia/Kolkata'
): string {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(d);
    const y = parts.find((p) => p.type === 'year')?.value;
    const m = parts.find((p) => p.type === 'month')?.value;
    const day = parts.find((p) => p.type === 'day')?.value;
    if (y && m && day) return `${y}-${m}-${day}`;
  } catch {
    // Fallback to ISO date key if invalid timezone string
  }
  return d.toISOString().slice(0, 10);
}

export function isContractActiveOnServiceDate(
  contract: { startDate: Date | string; endDate: Date | string },
  serviceDate: Date | string,
  timeZone = 'Asia/Kolkata'
): boolean {
  const targetKey = toCorridorDateKey(serviceDate, timeZone);
  const startKey = toCorridorDateKey(contract.startDate, timeZone);
  const endKey = toCorridorDateKey(contract.endDate, timeZone);
  if (!targetKey || !startKey || !endKey) return false;
  return targetKey >= startKey && targetKey <= endKey;
}

export function combineDateAndTime(baseDate: Date, timeHhMm: string): Date {
  const [h, m] = timeHhMm.split(':').map((n) => Number(n));
  const out = new Date(baseDate);
  out.setHours(h, m, 0, 0);
  return out;
}

export function isSameCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Computes conservative operational interval [startAt, endAt] + turnaround buffer bounds.
 * Handles cross-midnight schedules and minimum duration fallback when end <= start.
 */
export function computeOperationalInterval(params: {
  departureDate: Date;
  pickupTime: string;
  returnTime?: string;
  turnaroundBufferMin?: number;
  conservativeMinDurationMin?: number;
}) {
  const {
    departureDate,
    pickupTime,
    returnTime,
    turnaroundBufferMin = 30,
    conservativeMinDurationMin = 120,
  } = params;

  const startAt = combineDateAndTime(departureDate, pickupTime);
  let endAt: Date;

  if (returnTime && /^\d{2}:\d{2}$/.test(returnTime)) {
    endAt = combineDateAndTime(departureDate, returnTime);
    if (endAt <= startAt) {
      endAt = new Date(endAt.getTime() + 24 * 60 * 60 * 1000);
    }
  } else {
    // Missing duration/return info: conservative fallback rule
    endAt = new Date(startAt.getTime() + conservativeMinDurationMin * 60_000);
  }

  const bufferMs = Math.max(0, turnaroundBufferMin) * 60_000;
  return {
    startAt,
    endAt,
    bufferedStartAt: new Date(startAt.getTime() - bufferMs),
    bufferedEndAt: new Date(endAt.getTime() + bufferMs),
    bufferMin: turnaroundBufferMin,
  };
}

export function intervalsOverlap(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date
): boolean {
  return aStart.getTime() < bEnd.getTime() && aEnd.getTime() > bStart.getTime();
}

export interface WindowConflictDetail {
  sourceType: 'COMMITMENT' | 'TRIP';
  slotId?: string;
  slotNumber?: 1 | 2;
  corridorCode?: string;
  tripCode?: string;
  departureDate: Date;
  pickupTime: string;
  returnTime: string;
  turnaroundBufferMin: number;
}

export function findWindowConflictDetailFromRecords(params: {
  candidateDepartureDate: Date;
  candidatePickupTime: string;
  candidateReturnTime: string;
  turnaroundBufferMin: number;
  conservativeMinDurationMin: number;
  excludeSlotId?: string;
  otherCommitments: Array<{
    slotId: unknown;
    corridorCode?: string;
    slotNumber: 1 | 2;
    departureDate: Date;
    selectedPickupTime: string;
    selectedReturnTime: string;
    turnaroundBufferMin?: number;
  }>;
  activeTrips: Array<{
    _id: unknown;
    tripCode: string;
    plannedDepartureAt: Date;
    estimatedEndAt: Date;
  }>;
}): WindowConflictDetail | null {
  const {
    candidateDepartureDate,
    candidatePickupTime,
    candidateReturnTime,
    turnaroundBufferMin,
    conservativeMinDurationMin,
    excludeSlotId,
    otherCommitments,
    activeTrips,
  } = params;

  const candidate = computeOperationalInterval({
    departureDate: candidateDepartureDate,
    pickupTime: candidatePickupTime,
    returnTime: candidateReturnTime,
    turnaroundBufferMin,
    conservativeMinDurationMin,
  });

  for (const other of otherCommitments) {
    if (excludeSlotId && String(other.slotId) === String(excludeSlotId)) {
      continue;
    }
    const effectiveBuffer = Math.max(
      turnaroundBufferMin,
      other.turnaroundBufferMin ?? turnaroundBufferMin
    );
    const existing = computeOperationalInterval({
      departureDate: new Date(other.departureDate),
      pickupTime: other.selectedPickupTime,
      returnTime: other.selectedReturnTime,
      turnaroundBufferMin: other.turnaroundBufferMin ?? turnaroundBufferMin,
      conservativeMinDurationMin,
    });

    if (
      intervalsOverlap(
        candidate.bufferedStartAt,
        candidate.bufferedEndAt,
        existing.bufferedStartAt,
        existing.bufferedEndAt
      )
    ) {
      return {
        sourceType: 'COMMITMENT',
        slotId: String(other.slotId),
        slotNumber: other.slotNumber,
        corridorCode: other.corridorCode,
        departureDate: new Date(other.departureDate),
        pickupTime: other.selectedPickupTime,
        returnTime: other.selectedReturnTime,
        turnaroundBufferMin: effectiveBuffer,
      };
    }
  }

  for (const trip of activeTrips) {
    const tripStart = new Date(trip.plannedDepartureAt);
    const tripEnd = new Date(trip.estimatedEndAt);
    const bufferMs = Math.max(0, turnaroundBufferMin) * 60_000;
    const tripBufferedStart = new Date(tripStart.getTime() - bufferMs);
    const tripBufferedEnd = new Date(tripEnd.getTime() + bufferMs);

    if (
      intervalsOverlap(
        candidate.bufferedStartAt,
        candidate.bufferedEndAt,
        tripBufferedStart,
        tripBufferedEnd
      )
    ) {
      return {
        sourceType: 'TRIP',
        tripCode: trip.tripCode,
        departureDate: tripStart,
        pickupTime: tripStart.toLocaleTimeString('en-IN', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }),
        returnTime: tripEnd.toLocaleTimeString('en-IN', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }),
        turnaroundBufferMin: Math.max(0, turnaroundBufferMin),
      };
    }
  }

  return null;
}

/**
 * Checks if a candidate driver commitment window overlaps ANY active commitment across all
 * corridors or any active/assigned trip, factoring in configured turnaround buffers and cross-midnight spans.
 */
export function evaluateWindowConflictsFromRecords(params: {
  candidateDepartureDate: Date;
  candidatePickupTime: string;
  candidateReturnTime: string;
  turnaroundBufferMin: number;
  conservativeMinDurationMin: number;
  excludeSlotId?: string;
  otherCommitments: Array<{
    slotId: unknown;
    corridorCode?: string;
    slotNumber: 1 | 2;
    departureDate: Date;
    selectedPickupTime: string;
    selectedReturnTime: string;
    turnaroundBufferMin?: number;
  }>;
  activeTrips: Array<{
    _id: unknown;
    tripCode: string;
    plannedDepartureAt: Date;
    estimatedEndAt: Date;
  }>;
}): string | null {
  const detail = findWindowConflictDetailFromRecords(params);
  if (!detail) return null;

  if (detail.sourceType === 'COMMITMENT') {
    const dayLabel = detail.departureDate.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
    });
    const corridorPrefix = detail.corridorCode ? `${detail.corridorCode} ` : '';
    return `Conflicts with your committed ${corridorPrefix}Slot ${detail.slotNumber} (${detail.pickupTime}–${detail.returnTime}) on ${dayLabel} (including ${detail.turnaroundBufferMin} min turnaround buffer).`;
  }

  return `Conflicts with assigned trip ${detail.tripCode} (${detail.pickupTime}–${detail.returnTime}).`;
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
  const slotDayStart = new Date(
    Date.UTC(slotDate.getUTCFullYear(), slotDate.getUTCMonth(), slotDate.getUTCDate(), 0, 0, 0, 0)
  );
  const slotDayEnd = new Date(
    Date.UTC(slotDate.getUTCFullYear(), slotDate.getUTCMonth(), slotDate.getUTCDate(), 23, 59, 59, 999)
  );
  const contracts = await DriverContract.find({
    status: 'ACTIVE',
    eligibleCorridorIds: corridor._id,
    startDate: { $lte: slotDayEnd },
    endDate: { $gte: slotDayStart },
  });

  let notified = 0;
  for (const contract of contracts) {
    if (
      !isContractActiveOnServiceDate(
        contract,
        slotDate,
        corridor.timezone ?? 'Asia/Kolkata'
      )
    ) {
      continue;
    }
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
 * Scheduled job: opens SCHEDULED pooling windows once poolingOpensAt <= now
 * and notifies all eligible active Tier 1 contract drivers idempotently,
 * independent of whether any shipper booking has occurred yet.
 */
export async function processScheduledPoolingWindowOpenings(
  now: Date = new Date()
): Promise<{ openedCount: number; notificationsSent: number }> {
  const candidates = await Slot.find({
    cutoffAt: { $gt: now },
    $or: [
      { status: 'SCHEDULED', poolingOpensAt: { $lte: now } },
      {
        status: 'OPEN',
        poolingOpenedAt: { $exists: false },
        $or: [{ poolingOpensAt: { $exists: false } }, { poolingOpensAt: { $lte: now } }],
      },
    ],
  }).sort({ plannedDepartureAt: 1 });

  let openedCount = 0;
  let notificationsSent = 0;
  const corridorCache = new Map<string, ICorridor | null>();

  for (const candidate of candidates) {
    let slot = null;
    if (candidate.status === 'SCHEDULED') {
      slot = await Slot.findOneAndUpdate(
        { _id: candidate._id, status: 'SCHEDULED', cutoffAt: { $gt: now } },
        { $set: { status: 'OPEN', poolingOpenedAt: now } },
        { returnDocument: 'after' }
      );
      if (slot) openedCount += 1;
    } else {
      slot = await Slot.findOneAndUpdate(
        {
          _id: candidate._id,
          status: 'OPEN',
          poolingOpenedAt: { $exists: false },
          cutoffAt: { $gt: now },
        },
        { $set: { poolingOpenedAt: now } },
        { returnDocument: 'after' }
      );
    }

    if (!slot) continue;

    const cKey = String(slot.corridorId);
    if (!corridorCache.has(cKey)) {
      corridorCache.set(cKey, await Corridor.findById(slot.corridorId));
    }
    const corridor = corridorCache.get(cKey);
    if (!corridor || !corridor.isActive) continue;

    notificationsSent += await notifyEligibleTier1DriversForSlot({ corridor, slot });
  }

  return { openedCount, notificationsSent };
}

/**
 * Lists eligible open pooling windows for an authenticated Tier 1 contract driver,
 * computing per-slot and per-return-option schedule conflict status across all corridors & trips.
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
    new Set(activeContracts.flatMap((c) => c.eligibleCorridorIds.map((cid) => String(cid))))
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
    $or: [
      { poolingOpensAt: { $exists: false } },
      { poolingOpensAt: { $lte: now } },
    ],
  }).sort({ plannedDepartureAt: 1 });

  const openSlotIds = openSlots.map((s) => s._id);
  const pools = await Pool.find({ slotId: { $in: openSlotIds } });
  const poolBySlotId = new Map(pools.map((p) => [String(p.slotId), p]));

  // Fetch ALL active commitments (across ALL corridors) + active trips for accurate overlap calculation
  const allActiveCommitments = await DriverSlotCommitment.find({
    driverUserId,
    status: { $in: ['COMMITTED', 'LOCKED', 'ALLOCATED'] },
  });
  const commitmentCorridorIds = Array.from(
    new Set(allActiveCommitments.map((c) => String(c.corridorId)))
  );
  const commitmentCorridors =
    commitmentCorridorIds.length > 0
      ? await Corridor.find({ _id: { $in: commitmentCorridorIds } })
      : [];
  const allCorridorMap = new Map([
    ...Array.from(corridorById.entries()),
    ...commitmentCorridors.map((c) => [String(c._id), c] as const),
  ]);

  const activeTrips = await Trip.find({
    driverId: profile.userId,
    status: { $in: ['ASSIGNED', 'DRIVER_ACCEPTED', 'IN_PROGRESS', 'PAUSED'] },
  }).select('_id tripCode plannedDepartureAt estimatedEndAt');

  const commitmentBySlotId = new Map(
    allActiveCommitments
      .filter((c) => openSlotIds.some((id) => String(id) === String(c.slotId)))
      .map((c) => [String(c.slotId), c])
  );
  // Also include withdrawn/invalidated commitments for current open slots to show latest state
  const openSlotAllCommitments = await DriverSlotCommitment.find({
    slotId: { $in: openSlotIds },
    driverUserId,
  });
  for (const c of openSlotAllCommitments) {
    if (!commitmentBySlotId.has(String(c.slotId))) {
      commitmentBySlotId.set(String(c.slotId), c);
    }
  }

  const otherCommitmentInputs = allActiveCommitments.map((c) => {
    const cor = allCorridorMap.get(String(c.corridorId));
    return {
      slotId: c.slotId,
      corridorCode: cor?.code,
      slotNumber: c.slotNumber,
      departureDate: c.departureDate,
      selectedPickupTime: c.selectedPickupTime,
      selectedReturnTime: c.selectedReturnTime,
      turnaroundBufferMin: cor?.turnaroundBufferMin ?? 30,
    };
  });

  const items = openSlots
    .map((slot) => {
      const corridor = corridorById.get(String(slot.corridorId));
      if (!corridor) return null;

      const slotMs = new Date(slot.departureDate).getTime();
      const hasValidContractForDate = activeContracts.some(
        (c) =>
          c.eligibleCorridorIds.some((cid) => cid.equals(corridor._id)) &&
          slotMs >= new Date(c.startDate).getTime() &&
          slotMs <= new Date(c.endDate).getTime()
      );
      if (!hasValidContractForDate) return null;

      const template = resolveSlotTemplateForSlot(corridor, slot);
      if (!template) return null;

      const pool = poolBySlotId.get(String(slot._id));
      const commitment = commitmentBySlotId.get(String(slot._id)) ?? null;
      const isCurrentlyCommitted =
        commitment?.status === 'COMMITTED' || commitment?.status === 'LOCKED';

      const returnOptions =
        slot.returnTimeOptions && slot.returnTimeOptions.length > 0
          ? slot.returnTimeOptions
          : template.returnTimeOptions;
      const isLockedReturn = Boolean(slot.returnTimeLocked ?? template.returnTimeLocked);
      const lockedReturn = slot.lockedReturnTime ?? template.lockedReturnTime;

      const turnaroundBufferMin = corridor.turnaroundBufferMin ?? 30;
      const conservativeMinDurationMin = corridor.estimatedOutboundDurationMin ?? 120;

      // Evaluate conflict status for each return option individually
      const optionConflicts: Record<string, string | null> = {};
      const optionDetails: Record<string, WindowConflictDetail | null> = {};
      const optionsToCheck = isLockedReturn && lockedReturn ? [lockedReturn] : returnOptions;
      for (const opt of optionsToCheck) {
        const sharedParams = {
          candidateDepartureDate: new Date(slot.departureDate),
          candidatePickupTime: template.outboundPickupTime,
          candidateReturnTime: opt,
          turnaroundBufferMin,
          conservativeMinDurationMin,
          excludeSlotId: String(slot._id),
          otherCommitments: otherCommitmentInputs,
          activeTrips,
        };
        optionConflicts[opt] = evaluateWindowConflictsFromRecords(sharedParams);
        optionDetails[opt] = findWindowConflictDetailFromRecords(sharedParams);
      }

      const conflictMessages = Object.values(optionConflicts).filter(
        (v): v is string => Boolean(v)
      );
      const hasAnyAvailableOption = optionsToCheck.some((opt) => !optionConflicts[opt]);
      const conflictReason = hasAnyAvailableOption ? null : conflictMessages[0] ?? 'Schedule conflict';
      const firstConflictDetail =
        Object.values(optionDetails).find((d): d is WindowConflictDetail => Boolean(d)) ?? null;
      const conflictDetail = hasAnyAvailableOption ? null : firstConflictDetail;

      const availabilityState = isCurrentlyCommitted
        ? 'COMMITTED'
        : conflictReason
          ? 'UNAVAILABLE_SCHEDULE_CONFLICT'
          : 'OPEN_FOR_SELECTION';

      return {
        slotId: String(slot._id),
        slotCode: slot.slotCode,
        slotNumber: resolveSlotNumber(slot) ?? template.slotNumber,
        slotStatus: slot.status,
        label: slot.label,
        departureDate: slot.departureDate,
        cutoffAt: slot.cutoffAt,
        plannedDepartureAt: slot.plannedDepartureAt,
        availabilityState,
        conflictReason,
        conflictDetail,
        optionConflicts,
        turnaroundBufferMin,
        corridor: {
          _id: String(corridor._id),
          code: corridor.code,
          name: corridor.name,
          stops: corridor.stops,
        },
        template: {
          outboundPickupTime: template.outboundPickupTime,
          returnTimeOptions: returnOptions,
          defaultReturnTime: template.defaultReturnTime,
          returnTimeLocked: isLockedReturn,
          lockedReturnTime: lockedReturn,
        },
        capacity: {
          capacityWeightKg: slot.capacityWeightKg,
          capacityVolumeCbm: slot.capacityVolumeCbm,
          reservedWeightKg: pool?.reservedWeightKg ?? slot.reservedWeightKg ?? 0,
          reservedVolumeCbm: pool?.reservedVolumeCbm ?? slot.reservedVolumeCbm ?? 0,
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
 * before the pooling window cutoff deadline, enforcing cross-corridor interval overlap & trip checks.
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

    if (slot.poolingOpensAt && now < new Date(slot.poolingOpensAt)) {
      throw new HttpError(
        409,
        `Pooling window for ${slot.slotCode} has not opened yet.`,
        'POOLING_WINDOW_NOT_OPEN'
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
    const slotDayStart = new Date(Date.UTC(slotDate.getUTCFullYear(), slotDate.getUTCMonth(), slotDate.getUTCDate(), 0, 0, 0, 0));
    const slotDayEnd = new Date(Date.UTC(slotDate.getUTCFullYear(), slotDate.getUTCMonth(), slotDate.getUTCDate(), 23, 59, 59, 999));
    const activeContract = await DriverContract.findOne({
      driverUserId,
      status: 'ACTIVE',
      eligibleCorridorIds: corridor._id,
      startDate: { $lte: slotDayEnd },
      endDate: { $gte: slotDayStart },
    }).session(session);

    if (
      !activeContract ||
      !isContractActiveOnServiceDate(
        activeContract,
        slotDate,
        corridor.timezone ?? 'Asia/Kolkata'
      )
    ) {
      throw new HttpError(
        403,
        `Your active contract does not include corridor ${corridor.code} on ${toCorridorDateKey(
          slotDate,
          corridor.timezone ?? 'Asia/Kolkata'
        )}.`,
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

    const checkConflicts = async () => {
      const existingOtherCommitments = await DriverSlotCommitment.find({
        $or: [{ driverUserId }, { vehicleId: vehicle._id }],
        status: { $in: ['COMMITTED', 'LOCKED', 'ALLOCATED'] },
        slotId: { $ne: slot._id },
      }).session(session);

      const otherCorridorIds = Array.from(
        new Set(existingOtherCommitments.map((c) => String(c.corridorId)))
      );
      const otherCorridors =
        otherCorridorIds.length > 0
          ? await Corridor.find({ _id: { $in: otherCorridorIds } }).session(session)
          : [];
      const otherCorridorMap = new Map(otherCorridors.map((c) => [String(c._id), c]));

      const activeTrips = await Trip.find({
        $or: [{ driverId: profile.userId }, { vehicleId: vehicle._id }],
        status: { $in: ['ASSIGNED', 'DRIVER_ACCEPTED', 'IN_PROGRESS', 'PAUSED'] },
      })
        .select('_id tripCode plannedDepartureAt estimatedEndAt')
        .session(session);

      const conflictMessage = evaluateWindowConflictsFromRecords({
        candidateDepartureDate: slotDate,
        candidatePickupTime: pickupTime,
        candidateReturnTime: finalReturnTime,
        turnaroundBufferMin: corridor.turnaroundBufferMin ?? 30,
        conservativeMinDurationMin: corridor.estimatedOutboundDurationMin ?? 120,
        excludeSlotId: String(slot._id),
        otherCommitments: existingOtherCommitments.map((other) => {
          const cor = otherCorridorMap.get(String(other.corridorId));
          return {
            slotId: other.slotId,
            corridorCode: cor?.code,
            slotNumber: other.slotNumber,
            departureDate: other.departureDate,
            selectedPickupTime: other.selectedPickupTime,
            selectedReturnTime: other.selectedReturnTime,
            turnaroundBufferMin: cor?.turnaroundBufferMin ?? corridor.turnaroundBufferMin ?? 30,
          };
        }),
        activeTrips,
      });

      if (conflictMessage) {
        throw new HttpError(409, conflictMessage, 'CONFLICTING_SLOT_COMMITMENT');
      }
    };

    await checkConflicts();

    const priorCommitment = await DriverSlotCommitment.findOne({
      slotId: slot._id,
      driverUserId: profile.userId,
    }).session(session);
    if (priorCommitment && ['LOCKED', 'ALLOCATED'].includes(priorCommitment.status)) {
      throw new HttpError(
        409,
        `Commitment is already ${priorCommitment.status} and cannot be modified.`,
        'COMMITMENT_LOCKED'
      );
    }

    const pool = await Pool.findOne({ slotId: slot._id }).session(session);
    const isUpdate = Boolean(priorCommitment && priorCommitment.status === 'COMMITTED');
    const auditEntry = {
      action: (isUpdate ? 'UPDATED' : 'SUBMITTED') as 'SUBMITTED' | 'UPDATED',
      status: 'COMMITTED' as const,
      actorUserId: profile.userId,
      at: now,
      note: isUpdate
        ? `Updated commitment to pickup ${pickupTime}, return ${finalReturnTime}`
        : `Submitted availability for Slot ${slotNum} (pickup ${pickupTime}, return ${finalReturnTime})`,
    };

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
        $push: { auditHistory: auditEntry },
        $unset: {
          withdrawnAt: '',
          invalidationReason: '',
        },
      },
      { upsert: true, returnDocument: 'after', session: session ?? undefined }
    );

    // Second conflict check inside transaction guards simultaneous concurrent submits
    await checkConflicts();

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
    if (slot.poolingOpensAt && now < new Date(slot.poolingOpensAt)) {
      throw new HttpError(
        409,
        `Pooling window for ${slot.slotCode} has not opened yet.`,
        'POOLING_WINDOW_NOT_OPEN'
      );
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
    if (commitment.status === 'LOCKED' || commitment.status === 'ALLOCATED') {
      throw new HttpError(
        409,
        `Commitment is already ${commitment.status} and cannot be withdrawn.`,
        'COMMITMENT_LOCKED'
      );
    }

    commitment.status = 'WITHDRAWN';
    commitment.withdrawnAt = now;
    if (!Array.isArray(commitment.auditHistory)) {
      commitment.auditHistory = [];
    }
    commitment.auditHistory.push({
      action: 'WITHDRAWN',
      status: 'WITHDRAWN',
      actorUserId: commitment.driverUserId,
      at: now,
      note: `Driver withdrew availability prior to cutoff for ${slot.slotCode}`,
    });
    await commitment.save({ session: session ?? undefined });

    return { commitment };
  });
}

/**
 * Re-validates all COMMITTED Tier 1 driver commitments when a pooling window closes,
 * locking valid commitments (COMMITTED -> LOCKED) and invalidating stale ones.
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
    status: { $in: ['COMMITTED', 'LOCKED'] },
  }).session(session);

  const validCommitments: IDriverSlotCommitment[] = [];
  let invalidatedCount = 0;

  for (const commitment of commitments) {
    let reason: string | null = null;

    if (!corridor.isActive) {
      reason = 'CORRIDOR_INACTIVE';
    }

    if (!reason && !isSameCalendarDay(new Date(commitment.departureDate), new Date(slot.departureDate))) {
      reason = 'SERVICE_DATE_MISMATCH';
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
    const slotDayStart = new Date(
      Date.UTC(slotDate.getUTCFullYear(), slotDate.getUTCMonth(), slotDate.getUTCDate(), 0, 0, 0, 0)
    );
    const slotDayEnd = new Date(
      Date.UTC(slotDate.getUTCFullYear(), slotDate.getUTCMonth(), slotDate.getUTCDate(), 23, 59, 59, 999)
    );
    const activeContract = !reason
      ? await DriverContract.findOne({
          driverUserId: commitment.driverUserId,
          status: 'ACTIVE',
          eligibleCorridorIds: corridor._id,
          startDate: { $lte: slotDayEnd },
          endDate: { $gte: slotDayStart },
        }).session(session)
      : null;

    if (
      !reason &&
      (!activeContract ||
        !isContractActiveOnServiceDate(
          activeContract,
          slotDate,
          corridor.timezone ?? 'Asia/Kolkata'
        ))
    ) {
      reason = 'CONTRACT_INELIGIBLE_FOR_CORRIDOR';
    }

    if (!reason) {
      const interval = computeOperationalInterval({
        departureDate: slot.departureDate,
        pickupTime: commitment.selectedPickupTime,
        returnTime: commitment.selectedReturnTime,
        turnaroundBufferMin: corridor.turnaroundBufferMin ?? 30,
        conservativeMinDurationMin: corridor.estimatedOutboundDurationMin ?? 120,
      });

      const conflictingTrip = await Trip.findOne({
        driverId: commitment.driverUserId,
        status: { $in: ['ASSIGNED', 'DRIVER_ACCEPTED', 'IN_PROGRESS', 'PAUSED'] },
        plannedDepartureAt: { $lt: interval.bufferedEndAt },
        estimatedEndAt: { $gt: interval.bufferedStartAt },
      }).session(session);

      if (conflictingTrip) {
        reason = `CONFLICTING_TRIP_${conflictingTrip.tripCode}`;
      }
    }

    if (reason) {
      commitment.status = 'INVALIDATED';
      commitment.invalidationReason = reason;
      if (!Array.isArray(commitment.auditHistory)) commitment.auditHistory = [];
      commitment.auditHistory.push({
        action: 'INVALIDATED',
        status: 'INVALIDATED',
        at: new Date(),
        note: reason,
      });
      await commitment.save({ session: session ?? undefined });
      invalidatedCount += 1;
    } else {
      commitment.status = 'LOCKED';
      commitment.lockedAt = commitment.lockedAt ?? new Date();
      commitment.invalidationReason = undefined;
      if (!Array.isArray(commitment.auditHistory)) commitment.auditHistory = [];
      commitment.auditHistory.push({
        action: 'LOCKED',
        status: 'LOCKED',
        at: new Date(),
        note: `Locked at pooling window cutoff for ${slot.slotCode}`,
      });
      await commitment.save({ session: session ?? undefined });
      validCommitments.push(commitment);
    }
  }

  return { validCommitments, invalidatedCount };
}
