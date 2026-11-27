import crypto from 'node:crypto';
import { isValidObjectId, Types } from 'mongoose';
import { withTransaction } from '../config/database.js';
import { Corridor } from '../models/Corridor.js';
import { DriverProfile } from '../models/DriverProfile.js';
import {
  ExceptionEvent,
  type ExceptionType,
} from '../models/ExceptionEvent.js';
import { NotificationLog } from '../models/NotificationLog.js';
import { isValidShipmentTransition, Shipment } from '../models/Shipment.js';
import { Slot } from '../models/Slot.js';
import { Trip } from '../models/Trip.js';
import { TripEvent } from '../models/TripEvent.js';
import { Vehicle } from '../models/Vehicle.js';
import { emitShipmentProgress } from '../socket/poolGateway.js';
import { HttpError } from '../utils/errors.js';
import { hasOverlappingDriverTrip } from './driverAssignment.js';
import { doesCargoFitVehicle, isVehicleAvailableForSlot } from './fleetAllocator.js';
import { sendLifecycleNotification } from './notificationService.js';
import { savePodPhotoLocal } from './podStorageService.js';
import { addShipmentToPool } from './poolService.js';
import { optimizeAndPlanTripRoute } from './routePlanningService.js';

const SHIPMENT_FAIL_EXCEPTIONS = new Set<ExceptionType>([
  'CUSTOMER_UNAVAILABLE',
  'INCORRECT_ADDRESS',
  'SHIPMENT_DAMAGED',
  'RECIPIENT_REFUSES',
  'PICKUP_FAILURE',
]);

async function notifyShipperException(params: {
  businessId?: Types.ObjectId;
  shipmentReference?: string;
  recipientUserId?: Types.ObjectId;
  exceptionType: ExceptionType;
  reason: string;
  exceptionId: Types.ObjectId;
}) {
  if (!params.recipientUserId) return;
  await sendLifecycleNotification({
    eventType: 'DELIVERY_FAILED',
    dedupeKey: `EXC:${String(params.exceptionId)}:${String(params.recipientUserId)}`,
    recipientUserId: params.recipientUserId,
    vars: {
      reference: params.shipmentReference ?? 'Trip Shipment',
      reason: `${params.exceptionType}: ${params.reason}`,
    },
  });
}

async function reassignRemainingShipmentsOnBreakdown(params: {
  brokenTripId: Types.ObjectId;
  actorUserId: string;
}) {
  const brokenTrip = await Trip.findById(params.brokenTripId);
  if (!brokenTrip) return { reassigned: false, reason: 'Trip not found' };

  const remainingShipments = await Shipment.find({
    _id: { $in: brokenTrip.shipmentIds },
    status: { $in: ['LOCKED', 'PICKED_UP', 'IN_TRANSIT', 'AT_DESTINATION'] },
  });

  if (remainingShipments.length === 0) {
    return { reassigned: false, reason: 'No remaining active shipments to reassign.' };
  }

  const [corridor, slot, candidateVehicles] = await Promise.all([
    Corridor.findById(brokenTrip.corridorId),
    Slot.findById(brokenTrip.slotId),
    Vehicle.find({
      _id: { $ne: brokenTrip.vehicleId },
      isAvailable: true,
    }).sort({ tier: 1, maxWeightKg: 1 }),
  ]);

  if (!corridor || !slot) {
    return { reassigned: false, reason: 'Corridor or slot unavailable.' };
  }

  const feasibleVehicle = candidateVehicles.find(
    (v) =>
      isVehicleAvailableForSlot(v, slot) &&
      doesCargoFitVehicle(remainingShipments, v).feasible
  );

  if (!feasibleVehicle) {
    return {
      reassigned: false,
      reason: 'No replacement vehicle fits remaining shipments.',
    };
  }

  const drivers = await DriverProfile.find({
    availabilityStatus: 'AVAILABLE',
    userId: { $ne: brokenTrip.driverId },
  });

  let rescueDriver = null;
  for (const d of drivers) {
    const busy = await hasOverlappingDriverTrip({
      driverId: d.userId,
      windowStart: new Date(),
      windowEnd: brokenTrip.estimatedEndAt,
    });
    if (!busy) {
      rescueDriver = d;
      break;
    }
  }

  if (!rescueDriver) {
    return {
      reassigned: false,
      reason: 'Replacement vehicle found, but no non-overlapping rescue driver is available.',
    };
  }

  const rescueTripCode = `MC-RESCUE-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const rescueTrip = await Trip.create({
    tripCode: rescueTripCode,
    corridorId: brokenTrip.corridorId,
    slotId: brokenTrip.slotId,
    vehicleId: feasibleVehicle._id,
    driverId: rescueDriver.userId,
    shipmentIds: remainingShipments.map((s) => s._id),
    status: 'ASSIGNED',
    plannedDepartureAt: new Date(),
    estimatedEndAt: brokenTrip.estimatedEndAt,
    stopsSummary: brokenTrip.stopsSummary,
    assignmentHistory: [
      {
        driverId: rescueDriver.userId,
        vehicleId: feasibleVehicle._id,
        action: 'REASSIGNED',
        reason: `Breakdown reassignment from ${brokenTrip.tripCode}`,
        actorUserId: new Types.ObjectId(params.actorUserId),
        at: new Date(),
      },
    ],
    notes: `Rescue trip created after breakdown of ${brokenTrip.tripCode}`,
  });

  await Shipment.updateMany(
    { _id: { $in: remainingShipments.map((s) => s._id) } },
    { $set: { tripId: rescueTrip._id } }
  );

  let routeRecalculated = false;
  try {
    const opt = await optimizeAndPlanTripRoute({
      tripId: String(rescueTrip._id),
      actorUserId: params.actorUserId,
    });
    routeRecalculated = opt.optimized || Boolean(opt.routePlan);
  } catch {
    routeRecalculated = false;
  }

  await NotificationLog.create({
    recipientUserId: rescueDriver.userId,
    channel: 'IN_APP',
    eventType: 'BREAKDOWN_RESCUE_ASSIGNED',
    title: `Rescue Trip ${rescueTrip.tripCode}`,
    message: `Assigned ${remainingShipments.length} remaining shipment(s) from ${brokenTrip.tripCode}.`,
    dedupeKey: `RESCUE:${String(rescueTrip._id)}`,
  });

  return {
    reassigned: true,
    rescueTrip,
    routeRecalculated,
    reason: `Reassigned ${remainingShipments.length} shipment(s) to ${feasibleVehicle.registrationNumber} (${rescueTrip.tripCode}).`,
  };
}

export async function reportTripException(params: {
  tripId: string;
  driverUserId: string;
  exceptionType: ExceptionType;
  reason: string;
  shipmentId?: string;
  evidenceFile?: { buffer: Buffer; mimetype: string; size: number };
}) {
  const { tripId, driverUserId, exceptionType, reason, shipmentId, evidenceFile } = params;

  if (!isValidObjectId(tripId)) {
    throw new HttpError(400, 'Invalid trip ID', 'VALIDATION_ERROR');
  }

  const trip = await Trip.findOne({ _id: tripId, driverId: driverUserId });
  if (!trip) {
    throw new HttpError(403, 'Trip not found or not assigned to you', 'FORBIDDEN');
  }

  let targetShipment = null;
  if (shipmentId) {
    if (!isValidObjectId(shipmentId)) {
      throw new HttpError(400, 'Invalid shipment ID', 'VALIDATION_ERROR');
    }
    targetShipment = await Shipment.findOne({
      _id: shipmentId,
      $or: [{ tripId: trip._id }, { _id: { $in: trip.shipmentIds } }],
    });
    if (!targetShipment) {
      throw new HttpError(404, 'Shipment not found on this trip', 'NOT_FOUND');
    }
  }

  let evidenceMeta:
    | { photoStorageKey: string; photoMimeType: string; photoAccessToken: string }
    | undefined;
  if (evidenceFile) {
    evidenceMeta = await savePodPhotoLocal(evidenceFile);
  }

  const now = new Date();
  const exceptionDoc = await ExceptionEvent.create({
    tripId: trip._id,
    ...(targetShipment
      ? { shipmentId: targetShipment._id, businessId: targetShipment.businessId }
      : {}),
    exceptionType,
    reason: reason.trim(),
    reportedByUserId: new Types.ObjectId(driverUserId),
    occurredAt: now,
    ...(evidenceMeta
      ? {
          evidenceStorageKey: evidenceMeta.photoStorageKey,
          evidenceMimeType: evidenceMeta.photoMimeType,
          evidenceAccessToken: evidenceMeta.photoAccessToken,
        }
      : {}),
    resolutionStatus: 'OPEN',
    resolutionHistory: [
      {
        action: 'REPORTED',
        actorUserId: new Types.ObjectId(driverUserId),
        at: now,
        note: `${exceptionType}: ${reason.trim()}`,
      },
    ],
  });

  await TripEvent.create({
    tripId: trip._id,
    ...(targetShipment ? { shipmentId: targetShipment._id } : {}),
    eventType: 'EXCEPTION_REPORTED',
    actorUserId: new Types.ObjectId(driverUserId),
    occurredAt: now,
    reason: `${exceptionType}: ${reason.trim()}`,
    metadata: { exceptionId: String(exceptionDoc._id), exceptionType },
  });

  // Update affected shipment state explicitly (never silently mark delivered or discard)
  if (targetShipment) {
    const nextStatus =
      exceptionType === 'PARTIAL_DELIVERY'
        ? 'PARTIALLY_DELIVERED'
        : SHIPMENT_FAIL_EXCEPTIONS.has(exceptionType)
          ? 'FAILED'
          : null;

    if (nextStatus && isValidShipmentTransition(targetShipment.status, nextStatus)) {
      targetShipment.status = nextStatus;
      targetShipment.statusHistory.push({
        status: nextStatus,
        at: now,
        actorUserId: new Types.ObjectId(driverUserId),
        note: `Exception ${exceptionType}: ${reason.trim()}`,
      });
      await targetShipment.save();

      emitShipmentProgress(String(targetShipment._id), {
        shipmentId: String(targetShipment._id),
        reference: targetShipment.reference,
        status: nextStatus,
        tripId: String(trip._id),
        occurredAt: now.toISOString(),
        note: reason.trim(),
      });
    }

    await notifyShipperException({
      businessId: targetShipment.businessId,
      shipmentReference: targetShipment.reference,
      recipientUserId: targetShipment.createdByUserId,
      exceptionType,
      reason: reason.trim(),
      exceptionId: exceptionDoc._id,
    });
  } else {
    // Trip-level disruption (breakdown, road blocked, route infeasibility, driver unavailable)
    if (trip.status === 'IN_PROGRESS') {
      trip.status = 'PAUSED';
      trip.pauseReason = `${exceptionType}: ${reason.trim()}`;
      await trip.save();
    }

    const tripShipments = await Shipment.find({ _id: { $in: trip.shipmentIds } });
    for (const s of tripShipments) {
      await notifyShipperException({
        businessId: s.businessId,
        shipmentReference: s.reference,
        recipientUserId: s.createdByUserId,
        exceptionType,
        reason: reason.trim(),
        exceptionId: exceptionDoc._id,
      });
    }
  }

  let reassignment: Awaited<ReturnType<typeof reassignRemainingShipmentsOnBreakdown>> | null =
    null;
  if (exceptionType === 'VEHICLE_BREAKDOWN') {
    reassignment = await reassignRemainingShipmentsOnBreakdown({
      brokenTripId: trip._id,
      actorUserId: driverUserId,
    });
    if (reassignment.reassigned && reassignment.rescueTrip) {
      exceptionDoc.resolutionStatus = 'REASSIGNED';
      exceptionDoc.reassignedTripId = reassignment.rescueTrip._id;
      exceptionDoc.routeRecalculated = Boolean(reassignment.routeRecalculated);
      exceptionDoc.resolutionHistory.push({
        action: 'REASSIGNED',
        actorUserId: new Types.ObjectId(driverUserId),
        at: new Date(),
        note: reassignment.reason,
      });
      await exceptionDoc.save();
    }
  } else if (exceptionType === 'ROAD_BLOCKED' || exceptionType === 'ROUTE_INFEASIBILITY') {
    const opt = await optimizeAndPlanTripRoute({
      tripId: String(trip._id),
      actorUserId: driverUserId,
    }).catch(() => null);
    if (opt) {
      exceptionDoc.routeRecalculated = true;
      await exceptionDoc.save();
    }
  }

  return {
    exception: exceptionDoc,
    reassignment,
  };
}

export async function resolveShipmentException(params: {
  exceptionId: string;
  businessId: Types.ObjectId;
  userId: string;
  action: 'RESCHEDULE' | 'RETURN' | 'REALLOCATE';
  targetSlotId?: string;
  note?: string;
}) {
  const { exceptionId, businessId, userId, action, targetSlotId, note } = params;
  if (!isValidObjectId(exceptionId)) {
    throw new HttpError(400, 'Invalid exception ID', 'VALIDATION_ERROR');
  }

  return withTransaction(async (session) => {
    const exception = await ExceptionEvent.findOne({
      _id: exceptionId,
      businessId,
    }).session(session);
    if (!exception || !exception.shipmentId) {
      throw new HttpError(403, 'Exception not found for your business', 'FORBIDDEN');
    }

    const shipment = await Shipment.findOne({
      _id: exception.shipmentId,
      businessId,
    }).session(session);
    if (!shipment) {
      throw new HttpError(404, 'Shipment not found', 'NOT_FOUND');
    }

    const now = new Date();
    if (action === 'RETURN') {
      if (!isValidShipmentTransition(shipment.status, 'RETURNED')) {
        throw new HttpError(
          409,
          `Cannot mark RETURNED from status ${shipment.status}`,
          'INVALID_TRANSITION'
        );
      }
      shipment.status = 'RETURNED';
      shipment.statusHistory.push({
        status: 'RETURNED',
        at: now,
        actorUserId: new Types.ObjectId(userId),
        note: note || 'Shipper selected return after exception',
      });
      await shipment.save({ session: session ?? undefined });
      exception.resolutionStatus = 'RETURNED';
    } else if (action === 'RESCHEDULE') {
      if (!targetSlotId || !isValidObjectId(targetSlotId)) {
        throw new HttpError(400, 'targetSlotId is required for reschedule', 'VALIDATION_ERROR');
      }
      if (!isValidShipmentTransition(shipment.status, 'ROLLED_OVER')) {
        throw new HttpError(
          409,
          `Cannot reschedule from status ${shipment.status}`,
          'INVALID_TRANSITION'
        );
      }
      const corridor = await Corridor.findById(shipment.corridorId).session(session);
      const targetSlot = await Slot.findOneAndUpdate(
        {
          _id: targetSlotId,
          corridorId: shipment.corridorId,
          status: 'OPEN',
          cutoffAt: { $gt: now },
          $expr: {
            $and: [
              {
                $lte: [
                  { $add: ['$reservedWeightKg', shipment.cargo.chargeableWeightKg] },
                  '$capacityWeightKg',
                ],
              },
              {
                $lte: [
                  { $add: ['$reservedVolumeCbm', shipment.cargo.volumeCbm] },
                  '$capacityVolumeCbm',
                ],
              },
            ],
          },
        },
        {
          $inc: {
            reservedWeightKg: shipment.cargo.chargeableWeightKg,
            reservedVolumeCbm: shipment.cargo.volumeCbm,
          },
        },
        { returnDocument: 'after', session: session ?? undefined }
      );

      if (!corridor || !targetSlot) {
        throw new HttpError(409, 'Target slot unavailable for rescheduling', 'SLOT_UNAVAILABLE');
      }

      shipment.rolledOverFromSlotId = shipment.slotId;
      shipment.slotId = targetSlot._id;
      shipment.poolId = undefined;
      shipment.status = 'ROLLED_OVER';
      shipment.statusHistory.push({
        status: 'ROLLED_OVER',
        at: now,
        actorUserId: new Types.ObjectId(userId),
        note: `Rescheduled to slot ${targetSlot.slotCode}`,
      });
      await shipment.save({ session: session ?? undefined });

      if (shipment.tokenStatus === 'PAID') {
        await addShipmentToPool({
          shipment,
          slot: targetSlot,
          corridor,
          actorUserId: userId,
          session,
        });
      }
      exception.resolutionStatus = 'RESCHEDULED';
    } else {
      exception.resolutionStatus = 'REASSIGNED';
    }

    exception.resolutionHistory.push({
      action,
      actorUserId: new Types.ObjectId(userId),
      at: now,
      note: note ?? `Resolved via ${action}`,
    });
    await exception.save({ session: session ?? undefined });

    return { exception, shipment };
  });
}
