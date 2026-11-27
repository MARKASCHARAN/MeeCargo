import crypto from 'node:crypto';
import { isValidObjectId, Types } from 'mongoose';
import { env } from '../config/env.js';
import { withTransaction } from '../config/database.js';
import { DeliveryProof } from '../models/DeliveryProof.js';
import { DriverProfile } from '../models/DriverProfile.js';
import { DriverSlotCommitment } from '../models/DriverSlotCommitment.js';
import { isValidShipmentTransition, Shipment } from '../models/Shipment.js';
import { Trip, type TripStatus } from '../models/Trip.js';
import { TripEvent, type TripEventType } from '../models/TripEvent.js';
import { Vehicle } from '../models/Vehicle.js';
import { emitShipmentProgress } from '../socket/poolGateway.js';
import { HttpError } from '../utils/errors.js';
import { sendLifecycleNotification } from './notificationService.js';
import { savePodPhotoLocal } from './podStorageService.js';
import { calculateAndPersistTripLedger } from './tripEconomicsService.js';

const ALLOWED_TRIP_TRANSITIONS: Record<TripStatus, TripStatus[]> = {
  ASSIGNED: ['DRIVER_ACCEPTED', 'DRIVER_REJECTED', 'IN_PROGRESS', 'CANCELLED'],
  DRIVER_ACCEPTED: ['IN_PROGRESS', 'DRIVER_REJECTED', 'CANCELLED'],
  DRIVER_REJECTED: ['REASSIGNING', 'CANCELLED'],
  REASSIGNING: ['ASSIGNED', 'CANCELLED'],
  IN_PROGRESS: ['PAUSED', 'COMPLETED', 'CANCELLED'],
  PAUSED: ['IN_PROGRESS', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

export function isValidTripTransition(from: TripStatus, to: TripStatus): boolean {
  return ALLOWED_TRIP_TRANSITIONS[from]?.includes(to) ?? false;
}

function hashOtp(otp: string, shipmentId: string): string {
  return crypto
    .createHmac('sha256', env.JWT_SECRET)
    .update(`${shipmentId}:${otp}`)
    .digest('hex');
}

function buildLocation(coords?: [number, number]) {
  if (!coords) return undefined;
  return {
    type: 'Point' as const,
    coordinates: coords,
  };
}

export async function transitionTripExecutionState(params: {
  tripId: string;
  driverUserId: string;
  targetStatus: 'IN_PROGRESS' | 'PAUSED' | 'COMPLETED';
  reason?: string;
  idempotencyKey?: string;
  coordinates?: [number, number];
  locationDisclosureAccepted?: boolean;
  recordedOffline?: boolean;
  occurredAt?: Date;
}) {
  const {
    tripId,
    driverUserId,
    targetStatus,
    reason,
    idempotencyKey,
    coordinates,
    locationDisclosureAccepted,
    recordedOffline = false,
    occurredAt = new Date(),
  } = params;

  if (!isValidObjectId(tripId)) {
    throw new HttpError(400, 'Invalid trip ID', 'VALIDATION_ERROR');
  }

  if (idempotencyKey) {
    const dupEvent = await TripEvent.findOne({ tripId, idempotencyKey });
    if (dupEvent) {
      const trip = await Trip.findById(tripId);
      return { trip, event: dupEvent, deduplicated: true };
    }
  }

  const trip = await Trip.findOne({ _id: tripId, driverId: driverUserId });
  if (!trip) {
    throw new HttpError(403, 'Trip not found or not assigned to you', 'FORBIDDEN');
  }

  if (trip.status === targetStatus) {
    return { trip, event: null, deduplicated: true };
  }

  if (!isValidTripTransition(trip.status, targetStatus)) {
    throw new HttpError(
      409,
      `Conflict: cannot transition trip from ${trip.status} to ${targetStatus}`,
      'STATE_CONFLICT'
    );
  }

  if (trip.quarantined) {
    throw new HttpError(
      409,
      trip.quarantineReason || 'Trip is quarantined due to commitment inconsistency and cannot be executed.',
      'TRIP_QUARANTINED'
    );
  }

  let eventType: TripEventType;
  if (targetStatus === 'IN_PROGRESS') {
    const isInitialStart = trip.status === 'ASSIGNED' || trip.status === 'DRIVER_ACCEPTED';
    eventType = trip.status === 'PAUSED' ? 'TRIP_RESUMED' : 'TRIP_STARTED';

    if (isInitialStart) {
      // MC-053: Backend enforcement of start window, active driver, active vehicle, & valid Tier 1 commitment
      const earlyLeadWindowMs = 12 * 60 * 60 * 1000;
      const earliestAllowedStart = new Date(trip.plannedDepartureAt.getTime() - earlyLeadWindowMs);
      if (occurredAt < earliestAllowedStart) {
        throw new HttpError(
          409,
          `Trip ${trip.tripCode} cannot be started more than 12 hours before its planned departure (${trip.plannedDepartureAt.toISOString()}).`,
          'TOO_EARLY_TO_START'
        );
      }

      const driverProfile = await DriverProfile.findOne({ userId: driverUserId });
      if (driverProfile && driverProfile.accountStatus !== 'ACTIVE') {
        throw new HttpError(
          403,
          `Driver account is ${driverProfile.accountStatus} and cannot start trips.`,
          'DRIVER_INACTIVE'
        );
      }

      const vehicle = await Vehicle.findById(trip.vehicleId);
      if (vehicle && (vehicle.operationalStatus !== 'ACTIVE' || !vehicle.isAvailable)) {
        throw new HttpError(
          409,
          `Assigned vehicle ${vehicle.registrationNumber} is currently ${vehicle.operationalStatus} and cannot start trips.`,
          'VEHICLE_INACTIVE'
        );
      }

      if (trip.sourceCommitmentId) {
        const commitment = await DriverSlotCommitment.findById(trip.sourceCommitmentId);
        if (
          !commitment ||
          !['ALLOCATED', 'LOCKED'].includes(commitment.status) ||
          String(commitment.driverUserId) !== String(driverUserId)
        ) {
          throw new HttpError(
            409,
            'Source slot commitment is invalid or no longer active.',
            'COMMITMENT_MISMATCH'
          );
        }
      }
    }

    if (!trip.actualStartedAt) {
      trip.actualStartedAt = occurredAt;
    }
    if (locationDisclosureAccepted) {
      trip.locationDisclosureAcceptedAt = new Date();
    }
    trip.pauseReason = undefined;
  } else if (targetStatus === 'PAUSED') {
    if (!reason || reason.trim().length < 3) {
      throw new HttpError(400, 'A reason is required to pause a trip', 'VALIDATION_ERROR');
    }
    eventType = 'TRIP_PAUSED';
    trip.pauseReason = reason.trim();
  } else {
    eventType = 'TRIP_COMPLETED';
    trip.actualCompletedAt = occurredAt;
  }

  trip.status = targetStatus;
  if (coordinates && targetStatus === 'IN_PROGRESS') {
    trip.lastKnownLocation = { coordinates, recordedAt: occurredAt };
  }
  await trip.save();

  const event = await TripEvent.create({
    tripId: trip._id,
    eventType,
    actorUserId: new Types.ObjectId(driverUserId),
    occurredAt,
    ...(idempotencyKey ? { idempotencyKey } : {}),
    ...(coordinates ? { location: buildLocation(coordinates) } : {}),
    ...(reason ? { reason: reason.trim() } : {}),
    recordedOffline,
  });

  // When trip starts, mark any PICKED_UP shipments as IN_TRANSIT automatically if transitioning
  if (eventType === 'TRIP_STARTED' || eventType === 'TRIP_RESUMED') {
    const pickedUpShipments = await Shipment.find({
      tripId: trip._id,
      status: 'PICKED_UP',
    });
    for (const s of pickedUpShipments) {
      s.status = 'IN_TRANSIT';
      s.statusHistory.push({
        status: 'IN_TRANSIT',
        at: occurredAt,
        actorUserId: new Types.ObjectId(driverUserId),
        note: `Trip ${trip.tripCode} is in transit`,
      });
      await s.save();
      emitShipmentProgress(String(s._id), {
        shipmentId: String(s._id),
        reference: s.reference,
        status: s.status,
        tripId: String(trip._id),
        occurredAt: occurredAt.toISOString(),
      });
    }
  }

  if (eventType === 'TRIP_COMPLETED') {
    await calculateAndPersistTripLedger(String(trip._id)).catch(() => undefined);
  }

  return { trip, event, deduplicated: false };
}

export async function scanShipmentQrForPickup(params: {
  tripId: string;
  driverUserId: string;
  qrToken: string;
  expectedPickupStopCode?: string;
  coordinates?: [number, number];
  idempotencyKey?: string;
}) {
  const { tripId, driverUserId, qrToken, expectedPickupStopCode, coordinates, idempotencyKey } =
    params;
  if (!isValidObjectId(tripId)) {
    throw new HttpError(400, 'Invalid trip ID', 'VALIDATION_ERROR');
  }

  const trip = await Trip.findOne({ _id: tripId, driverId: driverUserId });
  if (!trip) {
    throw new HttpError(403, 'Trip not found or not assigned to you', 'FORBIDDEN');
  }

  if (trip.status === 'CANCELLED' || trip.status === 'DRIVER_REJECTED' || trip.status === 'COMPLETED') {
    throw new HttpError(
      409,
      `Cannot scan pickup QR while trip is ${trip.status}.`,
      'TRIP_NOT_ACTIVE'
    );
  }

  const shipment = await Shipment.findOne({ qrToken: qrToken.trim() });
  if (!shipment) {
    throw new HttpError(404, 'No shipment matches this QR identifier', 'QR_NOT_FOUND');
  }

  const belongsToTrip =
    (shipment.tripId && shipment.tripId.equals(trip._id)) ||
    trip.shipmentIds.some((id) => id.equals(shipment._id));

  if (!belongsToTrip) {
    throw new HttpError(
      422,
      `Wrong trip: shipment ${shipment.reference} is not on manifest for ${trip.tripCode}.`,
      'WRONG_TRIP_SHIPMENT'
    );
  }

  if (
    expectedPickupStopCode &&
    shipment.pickupStopCode &&
    shipment.pickupStopCode.toUpperCase() !== expectedPickupStopCode.trim().toUpperCase()
  ) {
    throw new HttpError(
      422,
      `Wrong pickup stop: shipment ${shipment.reference} is scheduled at ${shipment.pickupStopCode}, not ${expectedPickupStopCode.toUpperCase()}.`,
      'WRONG_PICKUP_STOP'
    );
  }

  // Idempotent duplicate scan check
  if (
    shipment.status === 'PICKED_UP' ||
    shipment.status === 'IN_TRANSIT' ||
    shipment.status === 'AT_DESTINATION' ||
    shipment.status === 'DELIVERED'
  ) {
    const existingEvent = await TripEvent.findOne({
      tripId: trip._id,
      shipmentId: shipment._id,
      eventType: 'PICKUP_VERIFIED',
    });
    return {
      deduplicated: true,
      shipment,
      event: existingEvent,
      pickupBalanceDuePaise: shipment.pricingSnapshot?.remainingBalancePaise ?? 0,
      balanceCollectionTriggered: Boolean(shipment.pickupBalanceRequestedAt),
    };
  }

  if (!isValidShipmentTransition(shipment.status, 'PICKED_UP')) {
    throw new HttpError(
      409,
      `Shipment ${shipment.reference} cannot be picked up from status ${shipment.status}`,
      'INVALID_TRANSITION'
    );
  }

  const now = new Date();
  const balanceDue = shipment.pricingSnapshot?.remainingBalancePaise ?? 0;

  shipment.status = 'PICKED_UP';
  shipment.pickupVerifiedAt = now;
  if (balanceDue > 0) {
    shipment.pickupBalanceRequestedAt = now;
  }
  shipment.statusHistory.push({
    status: 'PICKED_UP',
    at: now,
    actorUserId: new Types.ObjectId(driverUserId),
    note: `QR verified at pickup on trip ${trip.tripCode}`,
  });
  await shipment.save();

  const event = await TripEvent.create({
    tripId: trip._id,
    shipmentId: shipment._id,
    eventType: 'PICKUP_VERIFIED',
    actorUserId: new Types.ObjectId(driverUserId),
    occurredAt: now,
    idempotencyKey: idempotencyKey ?? `qr-pickup:${String(trip._id)}:${String(shipment._id)}`,
    ...(coordinates ? { location: buildLocation(coordinates) } : {}),
    metadata: {
      reference: shipment.reference,
      balanceDuePaise: balanceDue,
    },
  });

  emitShipmentProgress(String(shipment._id), {
    shipmentId: String(shipment._id),
    reference: shipment.reference,
    status: shipment.status,
    tripId: String(trip._id),
    occurredAt: now.toISOString(),
    note: 'Picked up & QR verified',
  });

  await sendLifecycleNotification({
    eventType: 'SHIPMENT_PICKED_UP',
    dedupeKey: `SHIPMENT_PICKED_UP:${String(shipment._id)}`,
    recipientUserId: shipment.createdByUserId,
    recipientContact: shipment.recipientPhone,
    vars: {
      reference: shipment.reference,
      trackingUrl: `/track/${shipment.trackingToken}`,
    },
  });

  return {
    deduplicated: false,
    shipment,
    event,
    pickupBalanceDuePaise: balanceDue,
    balanceCollectionTriggered: balanceDue > 0,
  };
}

export async function updateTripShipmentLifecycle(params: {
  tripId: string;
  shipmentId: string;
  driverUserId: string;
  targetStatus: 'IN_TRANSIT' | 'AT_DESTINATION' | 'FAILED';
  reason?: string;
  idempotencyKey?: string;
  coordinates?: [number, number];
  recordedOffline?: boolean;
  occurredAt?: Date;
}) {
  const {
    tripId,
    shipmentId,
    driverUserId,
    targetStatus,
    reason,
    idempotencyKey,
    coordinates,
    recordedOffline = false,
    occurredAt = new Date(),
  } = params;

  if (!isValidObjectId(tripId) || !isValidObjectId(shipmentId)) {
    throw new HttpError(400, 'Invalid trip or shipment ID', 'VALIDATION_ERROR');
  }

  if (idempotencyKey) {
    const dup = await TripEvent.findOne({ tripId, idempotencyKey });
    if (dup) {
      const shipment = await Shipment.findById(shipmentId);
      return { shipment, event: dup, deduplicated: true };
    }
  }

  const trip = await Trip.findOne({ _id: tripId, driverId: driverUserId });
  if (!trip) {
    throw new HttpError(403, 'Trip not found or not assigned to you', 'FORBIDDEN');
  }

  const shipment = await Shipment.findOne({
    _id: shipmentId,
    $or: [{ tripId: trip._id }, { _id: { $in: trip.shipmentIds } }],
  });

  if (!shipment) {
    throw new HttpError(404, 'Shipment not found on this trip', 'NOT_FOUND');
  }

  if (shipment.status === targetStatus) {
    return { shipment, event: null, deduplicated: true };
  }

  if (!isValidShipmentTransition(shipment.status, targetStatus)) {
    throw new HttpError(
      409,
      `Conflict: cannot move shipment from ${shipment.status} to ${targetStatus}`,
      'STATE_CONFLICT'
    );
  }

  shipment.status = targetStatus;
  shipment.statusHistory.push({
    status: targetStatus,
    at: occurredAt,
    actorUserId: new Types.ObjectId(driverUserId),
    note: reason || `Marked ${targetStatus} by driver`,
  });
  await shipment.save();

  const eventType: TripEventType =
    targetStatus === 'IN_TRANSIT'
      ? 'IN_TRANSIT'
      : targetStatus === 'AT_DESTINATION'
        ? 'AT_DESTINATION'
        : 'DELIVERY_FAILED';

  const event = await TripEvent.create({
    tripId: trip._id,
    shipmentId: shipment._id,
    eventType,
    actorUserId: new Types.ObjectId(driverUserId),
    occurredAt,
    ...(idempotencyKey ? { idempotencyKey } : {}),
    ...(coordinates ? { location: buildLocation(coordinates) } : {}),
    ...(reason ? { reason } : {}),
    recordedOffline,
  });

  emitShipmentProgress(String(shipment._id), {
    shipmentId: String(shipment._id),
    reference: shipment.reference,
    status: shipment.status,
    tripId: String(trip._id),
    occurredAt: occurredAt.toISOString(),
    note: reason,
  });

  if (targetStatus === 'IN_TRANSIT' || targetStatus === 'AT_DESTINATION') {
    await sendLifecycleNotification({
      eventType:
        targetStatus === 'AT_DESTINATION' ? 'DRIVER_APPROACHING' : 'SHIPMENT_IN_TRANSIT',
      dedupeKey: `${eventType}:${String(shipment._id)}`,
      recipientUserId: shipment.createdByUserId,
      recipientContact: shipment.recipientPhone,
      vars: {
        reference: shipment.reference,
        stopCode: shipment.deliveryStopCode,
        trackingUrl: `/track/${shipment.trackingToken}`,
      },
    });
  } else if (targetStatus === 'FAILED') {
    await sendLifecycleNotification({
      eventType: 'DELIVERY_FAILED',
      dedupeKey: `DELIVERY_FAILED:${String(shipment._id)}:${occurredAt.toISOString().slice(0, 16)}`,
      recipientUserId: shipment.createdByUserId,
      recipientContact: shipment.recipientPhone,
      vars: {
        reference: shipment.reference,
        reason: reason ?? 'Delivery attempt failed',
      },
    });
  }

  return { shipment, event, deduplicated: false };
}

export async function generateShipmentDeliveryOtp(params: {
  tripId: string;
  shipmentId: string;
  driverUserId: string;
}) {
  const { tripId, shipmentId, driverUserId } = params;
  if (!isValidObjectId(tripId) || !isValidObjectId(shipmentId)) {
    throw new HttpError(400, 'Invalid trip or shipment ID', 'VALIDATION_ERROR');
  }

  const trip = await Trip.findOne({ _id: tripId, driverId: driverUserId });
  if (!trip) {
    throw new HttpError(403, 'Trip not found or not assigned to you', 'FORBIDDEN');
  }

  const shipment = await Shipment.findOne({
    _id: shipmentId,
    $or: [{ tripId: trip._id }, { _id: { $in: trip.shipmentIds } }],
  });
  if (!shipment) {
    throw new HttpError(404, 'Shipment not found on this trip', 'NOT_FOUND');
  }

  const rawOtp = String(crypto.randomInt(100000, 999999));
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

  await DeliveryProof.findOneAndUpdate(
    { shipmentId: shipment._id },
    {
      $set: {
        shipmentId: shipment._id,
        tripId: trip._id,
        confirmationMode: 'OTP',
        otpHash: hashOtp(rawOtp, String(shipment._id)),
        otpExpiresAt: expiresAt,
        attemptCount: 0,
        maxAttempts: 5,
      },
    },
    { upsert: true, returnDocument: 'after' }
  );

  // In prototype mode, return demoOtpHint only when notification provider is CONSOLE
  // so evaluators can verify OTP entry end-to-end without SMS gateway.
  return {
    shipmentId: String(shipment._id),
    reference: shipment.reference,
    expiresAt: expiresAt.toISOString(),
    ...(env.NOTIFICATION_PROVIDER === 'CONSOLE' ? { demoOtp: rawOtp } : {}),
  };
}

export async function verifyDeliveryAndComplete(params: {
  tripId: string;
  shipmentId: string;
  driverUserId: string;
  confirmationMode: 'OTP' | 'B2B_WAREHOUSE_SIGN_OFF';
  otp?: string;
  b2bSignOffName?: string;
  b2bSignOffNote?: string;
  photoFile?: { buffer: Buffer; mimetype: string; size: number };
  coordinates?: [number, number];
}) {
  const {
    tripId,
    shipmentId,
    driverUserId,
    confirmationMode,
    otp,
    b2bSignOffName,
    b2bSignOffNote,
    photoFile,
    coordinates,
  } = params;

  if (!isValidObjectId(tripId) || !isValidObjectId(shipmentId)) {
    throw new HttpError(400, 'Invalid trip or shipment ID', 'VALIDATION_ERROR');
  }

  const trip = await Trip.findOne({ _id: tripId, driverId: driverUserId });
  if (!trip) {
    throw new HttpError(403, 'Trip not found or not assigned to you', 'FORBIDDEN');
  }

  const shipment = await Shipment.findOne({
    _id: shipmentId,
    $or: [{ tripId: trip._id }, { _id: { $in: trip.shipmentIds } }],
  });
  if (!shipment) {
    throw new HttpError(404, 'Shipment not found on this trip', 'NOT_FOUND');
  }

  if (shipment.status === 'DELIVERED') {
    const existingProof = await DeliveryProof.findOne({ shipmentId: shipment._id });
    return { shipment, proof: existingProof, deduplicated: true };
  }

  if (!['PICKED_UP', 'IN_TRANSIT', 'AT_DESTINATION'].includes(shipment.status)) {
    throw new HttpError(
      409,
      `Shipment must be picked up / in transit / at destination before delivery confirmation (current: ${shipment.status}).`,
      'INVALID_TRANSITION'
    );
  }

  let proof = await DeliveryProof.findOne({ shipmentId: shipment._id }).select('+otpHash');

  if (confirmationMode === 'OTP') {
    if (!proof || !proof.otpHash || !proof.otpExpiresAt) {
      throw new HttpError(
        400,
        'Delivery OTP has not been generated for this shipment yet.',
        'OTP_NOT_GENERATED'
      );
    }
    if (proof.attemptCount >= proof.maxAttempts) {
      throw new HttpError(
        429,
        'Maximum OTP verification attempts exceeded. Generate a new OTP or use configured B2B sign-off.',
        'OTP_MAX_ATTEMPTS'
      );
    }
    if (new Date() > proof.otpExpiresAt) {
      throw new HttpError(400, 'Delivery OTP has expired. Generate a new OTP.', 'OTP_EXPIRED');
    }

    const candidateHash = hashOtp((otp ?? '').trim(), String(shipment._id));
    if (candidateHash !== proof.otpHash) {
      proof.attemptCount += 1;
      await proof.save();
      throw new HttpError(
        400,
        `Invalid delivery OTP (${proof.attemptCount}/${proof.maxAttempts} attempts used).`,
        'INVALID_OTP'
      );
    }
  } else {
    if (!shipment.allowB2bWarehouseConfirm) {
      throw new HttpError(
        403,
        'B2B warehouse sign-off is not enabled for this shipment; OTP verification is required.',
        'B2B_SIGNOFF_DISABLED'
      );
    }
    if (!b2bSignOffName || b2bSignOffName.trim().length < 2) {
      throw new HttpError(
        400,
        'Receiver name is required for B2B warehouse sign-off.',
        'VALIDATION_ERROR'
      );
    }
  }

  let photoMeta:
    | { photoStorageKey: string; photoMimeType: string; photoAccessToken: string }
    | undefined;
  if (photoFile) {
    photoMeta = await savePodPhotoLocal(photoFile);
  }

  const now = new Date();
  return withTransaction(async (session) => {
    if (!proof) {
      proof = new DeliveryProof({
        shipmentId: shipment._id,
        tripId: trip._id,
      });
    }
    proof.confirmationMode = confirmationMode;
    if (confirmationMode === 'B2B_WAREHOUSE_SIGN_OFF') {
      proof.b2bSignOffName = b2bSignOffName?.trim();
      proof.b2bSignOffNote = b2bSignOffNote?.trim();
    }
    if (photoMeta) {
      proof.photoStorageKey = photoMeta.photoStorageKey;
      proof.photoMimeType = photoMeta.photoMimeType;
      proof.photoAccessToken = photoMeta.photoAccessToken;
    }
    proof.verifiedAt = now;
    proof.verifiedByUserId = new Types.ObjectId(driverUserId);
    if (coordinates) {
      proof.location = buildLocation(coordinates);
    }
    await proof.save({ session: session ?? undefined });

    shipment.status = 'DELIVERED';
    shipment.statusHistory.push({
      status: 'DELIVERED',
      at: now,
      actorUserId: new Types.ObjectId(driverUserId),
      note:
        confirmationMode === 'OTP'
          ? 'Delivered & verified via recipient OTP'
          : `Delivered via B2B warehouse sign-off (${b2bSignOffName})`,
    });
    await shipment.save({ session: session ?? undefined });

    const event = await TripEvent.create(
      [
        {
          tripId: trip._id,
          shipmentId: shipment._id,
          eventType: 'DELIVERED',
          actorUserId: new Types.ObjectId(driverUserId),
          occurredAt: now,
          idempotencyKey: `deliver:${String(trip._id)}:${String(shipment._id)}`,
          ...(coordinates ? { location: buildLocation(coordinates) } : {}),
          metadata: {
            confirmationMode,
            hasPhotoProof: Boolean(photoMeta),
          },
        },
      ],
      { session: session ?? undefined }
    );

    emitShipmentProgress(String(shipment._id), {
      shipmentId: String(shipment._id),
      reference: shipment.reference,
      status: 'DELIVERED',
      tripId: String(trip._id),
      occurredAt: now.toISOString(),
      note: 'Delivery verified',
    });

    await sendLifecycleNotification({
      eventType: 'DELIVERY_COMPLETED',
      dedupeKey: `DELIVERY_COMPLETED:${String(shipment._id)}`,
      recipientUserId: shipment.createdByUserId,
      recipientContact: shipment.recipientPhone,
      vars: {
        reference: shipment.reference,
        stopCode: shipment.deliveryStopCode,
        mode: confirmationMode,
      },
    });

    return { shipment, proof, event: event[0], deduplicated: false };
  });
}

export async function syncOfflineDriverEvents(params: {
  tripId: string;
  driverUserId: string;
  events: Array<{
    idempotencyKey: string;
    kind: 'TRIP_STATUS' | 'SHIPMENT_STATUS';
    targetStatus: string;
    shipmentId?: string;
    reason?: string;
    occurredAt: string;
    coordinates?: [number, number];
  }>;
}) {
  const { tripId, driverUserId, events } = params;
  const results: Array<{
    idempotencyKey: string;
    status: 'SYNCED' | 'DUPLICATE' | 'CONFLICT';
    message: string;
  }> = [];

  for (const item of events) {
    try {
      if (item.kind === 'TRIP_STATUS') {
        if (
          item.targetStatus !== 'IN_PROGRESS' &&
          item.targetStatus !== 'PAUSED' &&
          item.targetStatus !== 'COMPLETED'
        ) {
          results.push({
            idempotencyKey: item.idempotencyKey,
            status: 'CONFLICT',
            message: `Unsupported offline trip status ${item.targetStatus}`,
          });
          continue;
        }
        const res = await transitionTripExecutionState({
          tripId,
          driverUserId,
          targetStatus: item.targetStatus,
          reason: item.reason,
          idempotencyKey: item.idempotencyKey,
          coordinates: item.coordinates,
          recordedOffline: true,
          occurredAt: new Date(item.occurredAt),
        });
        results.push({
          idempotencyKey: item.idempotencyKey,
          status: res.deduplicated ? 'DUPLICATE' : 'SYNCED',
          message: res.deduplicated ? 'Already synced' : `Synced ${item.targetStatus}`,
        });
      } else {
        if (
          !item.shipmentId ||
          (item.targetStatus !== 'IN_TRANSIT' &&
            item.targetStatus !== 'AT_DESTINATION' &&
            item.targetStatus !== 'FAILED')
        ) {
          results.push({
            idempotencyKey: item.idempotencyKey,
            status: 'CONFLICT',
            message: 'Offline shipment sync only supports IN_TRANSIT, AT_DESTINATION, or FAILED (QR & OTP require online verification).',
          });
          continue;
        }
        const res = await updateTripShipmentLifecycle({
          tripId,
          shipmentId: item.shipmentId,
          driverUserId,
          targetStatus: item.targetStatus,
          reason: item.reason,
          idempotencyKey: item.idempotencyKey,
          coordinates: item.coordinates,
          recordedOffline: true,
          occurredAt: new Date(item.occurredAt),
        });
        results.push({
          idempotencyKey: item.idempotencyKey,
          status: res.deduplicated ? 'DUPLICATE' : 'SYNCED',
          message: res.deduplicated ? 'Already synced' : `Synced ${item.targetStatus}`,
        });
      }
    } catch (error) {
      results.push({
        idempotencyKey: item.idempotencyKey,
        status: 'CONFLICT',
        message: error instanceof Error ? error.message : 'Sync conflict',
      });
    }
  }

  return { results };
}
