import crypto from 'node:crypto';
import { isValidObjectId, type ClientSession, type Types } from 'mongoose';
import { z } from 'zod';
import { withTransaction } from '../config/database.js';
import type { IBusinessProfile, StructuredAddress } from '../models/BusinessProfile.js';
import { isValidLngLat } from '../models/common.js';
import { Corridor } from '../models/Corridor.js';
import { DriverSlotCommitment } from '../models/DriverSlotCommitment.js';
import { Pool } from '../models/Pool.js';
import {
  isValidShipmentTransition,
  Shipment,
  type IShipment,
  type PaymentChoice,
} from '../models/Shipment.js';
import { Slot, type ISlot } from '../models/Slot.js';
import { HttpError } from '../utils/errors.js';
import {
  calculateCargoMetrics,
  type CargoCategory,
  type DimensionUnit,
  type WeightUnit,
} from './cargoCalculator.js';

export const addressSchema = z.object({
  addressLine: z.string().trim().min(3, 'Address line is required').max(250),
  villageOrTown: z.string().trim().min(2, 'Village/town is required').max(100),
  district: z.string().trim().min(2, 'District is required').max(100),
  state: z.string().trim().min(2).max(80).default('Gujarat'),
  pincode: z.string().trim().regex(/^\d{6}$/, 'PIN code must be 6 digits'),
  landmark: z.string().trim().max(150).optional(),
  location: z.object({
    type: z.literal('Point').default('Point'),
    coordinates: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]),
  }),
});

export const MAX_DROP_ZONE_RADIUS_KM = 30;

export function haversineDistanceKm(
  a: [number, number],
  b: [number, number]
): number {
  const [lng1, lat1] = a;
  const [lng2, lat2] = b;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * sinLng * sinLng;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export const createBookingSchema = z
  .object({
    corridorId: z.string().min(1),
    serviceType: z
      .literal('STANDARD_SCHEDULED_SHARED_POOL')
      .default('STANDARD_SCHEDULED_SHARED_POOL'),
    slotId: z.string().min(1).optional(),
    serviceDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'serviceDate must be in YYYY-MM-DD format')
      .optional(),
    pickupStopCode: z.string().trim().min(2).max(16),
    deliveryStopCode: z.string().trim().min(2).max(16),
    pickupAddress: addressSchema.optional(),
    deliveryAddress: addressSchema,
    recipientName: z.string().trim().min(2, 'Recipient name is required').max(120),
    recipientPhone: z.string().trim().min(8, 'Recipient phone is required').max(20),
    cargo: z.object({
      category: z.enum([
        'STANDARD_BOX',
        'SACK_BAG',
        'TEXTILE_ROLL',
        'PALLET_BUNDLE',
        'CUSTOM',
      ]),
      quantity: z.number().int().min(1).max(1000),
      length: z.number().positive(),
      width: z.number().positive(),
      height: z.number().positive(),
      dimensionUnit: z.enum(['CM', 'IN', 'M']).default('CM'),
      unitActualWeight: z.number().positive(),
      weightUnit: z.enum(['KG', 'G']).default('KG'),
      stackable: z.boolean().default(true),
      handlingRestrictions: z.array(z.string().trim().max(60)).default([]),
      declaredContents: z.string().trim().min(2, 'Declared contents required').max(200),
      handlingNotes: z.string().trim().max(300).optional(),
      irregularCargoNotes: z.string().trim().max(300).optional(),
    }),
    paymentChoice: z
      .literal('TOKEN_PLUS_PICKUP_BALANCE')
      .default('TOKEN_PLUS_PICKUP_BALANCE'),
    idempotencyKey: z.string().trim().min(4).max(120).optional(),
    externalOrderRef: z.string().trim().min(1).max(80).optional(),
  })
  .refine((data) => Boolean(data.slotId || data.serviceDate), {
    message: 'serviceDate is required for shipment booking',
    path: ['serviceDate'],
  });

export function toServiceDateKey(date?: Date | string | null): string {
  if (!date) return '';
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

/**
 * Backend-controlled matcher that associates a shipper booking (corridor + serviceDate + cargo)
 * with the most suitable operational pool/slot, prioritizing active Tier 1 driver commitments
 * and consolidatable open pools without exposing driver slot selection to shippers.
 */
export async function matchOperationalSlotForBooking(params: {
  corridorId: Types.ObjectId;
  serviceDate: string;
  chargeableWeightKg?: number;
  volumeCbm?: number;
  excludeSlotId?: Types.ObjectId;
  now?: Date;
  session?: ClientSession | null;
}): Promise<ISlot> {
  const now = params.now ?? new Date();
  const requiredWeight = params.chargeableWeightKg ?? 0;
  const requiredVolume = params.volumeCbm ?? 0;

  const candidateQuery = Slot.find({
    corridorId: params.corridorId,
    status: { $in: ['OPEN', 'LOCKING', 'LOCKED'] },
  }).sort({ plannedDepartureAt: 1 });

  const allSlots = params.session
    ? await candidateQuery.session(params.session)
    : await candidateQuery;

  const slotsOnDate = allSlots.filter(
    (s) =>
      toServiceDateKey(s.departureDate) === params.serviceDate &&
      (!params.excludeSlotId || !s._id.equals(params.excludeSlotId))
  );

  if (slotsOnDate.length === 0) {
    throw new HttpError(
      404,
      `No operational service is scheduled on ${params.serviceDate} for this corridor.`,
      'NO_SERVICE_ON_DATE'
    );
  }

  const openSlots = slotsOnDate.filter(
    (s) => s.status === 'OPEN' && now < new Date(s.cutoffAt)
  );
  if (openSlots.length === 0) {
    throw new HttpError(
      409,
      `Booking cutoff has passed or pooling window is closed for ${params.serviceDate}.`,
      'CUTOFF_PASSED'
    );
  }

  const fittingSlots = openSlots.filter(
    (s) =>
      s.capacityWeightKg - s.reservedWeightKg >= requiredWeight &&
      s.capacityVolumeCbm - s.reservedVolumeCbm >= requiredVolume
  );
  if (fittingSlots.length === 0) {
    const maxFreeW = Math.max(
      0,
      ...openSlots.map((s) => s.capacityWeightKg - s.reservedWeightKg)
    );
    const maxFreeV = Math.max(
      0,
      ...openSlots.map((s) => s.capacityVolumeCbm - s.reservedVolumeCbm)
    );
    throw new HttpError(
      409,
      `Insufficient remaining capacity on ${params.serviceDate} (max single-pool available: ${maxFreeW.toFixed(
        1
      )} kg / ${maxFreeV.toFixed(2)} m³).`,
      'SLOT_CAPACITY_EXCEEDED'
    );
  }

  if (fittingSlots.length === 1) {
    return fittingSlots[0];
  }

  const candidateIds = fittingSlots.map((s) => s._id);
  const commitmentQuery = DriverSlotCommitment.find({
    corridorId: params.corridorId,
    slotId: { $in: candidateIds },
    status: { $in: ['COMMITTED', 'LOCKED'] },
  }).select('slotId');
  const poolQuery = Pool.find({
    corridorId: params.corridorId,
    slotId: { $in: candidateIds },
    status: 'OPEN',
  }).select('slotId shipmentIds reservedWeightKg reservedVolumeCbm');

  const [commitments, openPools] = await Promise.all([
    (params.session ? commitmentQuery.session(params.session) : commitmentQuery).lean(),
    (params.session ? poolQuery.session(params.session) : poolQuery).lean(),
  ]);

  const committedSlotIds = new Set(commitments.map((c) => String(c.slotId)));
  const poolBySlotId = new Map(openPools.map((p) => [String(p.slotId), p]));

  const ranked = fittingSlots
    .map((slot) => {
      const id = String(slot._id);
      const hasCommittedDriver = committedSlotIds.has(id);
      const existingPool = poolBySlotId.get(id);
      const hasPooledShipments = Boolean(existingPool && existingPool.shipmentIds.length > 0);
      const projectedUtilPct = Math.min(
        100,
        ((slot.reservedWeightKg + requiredWeight) / slot.capacityWeightKg) * 100
      );
      const score =
        (hasCommittedDriver ? 1000 : 0) +
        (hasPooledShipments ? 500 : 0) +
        projectedUtilPct;

      return { slot, score };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (
        new Date(a.slot.plannedDepartureAt).getTime() -
        new Date(b.slot.plannedDepartureAt).getTime()
      );
    });

  return ranked[0].slot;
}

export type CreateBookingInput = Omit<
  z.infer<typeof createBookingSchema>,
  'serviceType' | 'paymentChoice'
> & {
  serviceType?: 'STANDARD_SCHEDULED_SHARED_POOL';
  paymentChoice?: 'TOKEN_PLUS_PICKUP_BALANCE';
};

export function generateShipmentReference(now: Date = new Date()): string {
  const datePart = now.toISOString().slice(0, 10).replace(/-/g, '');
  const randPart = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `MC-${datePart}-${randPart}`;
}

export function assertValidBookingCoordinates(
  address: StructuredAddress,
  label: string
): void {
  const coords = address?.location?.coordinates;
  if (!isValidLngLat(coords) || (coords[0] === 0 && coords[1] === 0)) {
    throw new HttpError(
      400,
      `${label} coordinates are missing or invalid. Please place the map pin before confirming.`,
      'INVALID_COORDINATES'
    );
  }
}

export async function createShipmentBooking(params: {
  business: IBusinessProfile;
  userId: string;
  input: CreateBookingInput;
  now?: Date;
}): Promise<{ shipment: IShipment; deduplicated: boolean }> {
  const { business, userId, input, now = new Date() } = params;

  if (input.idempotencyKey) {
    const existing = await Shipment.findOne({
      businessId: business._id,
      idempotencyKey: input.idempotencyKey,
    });
    if (existing) {
      return { shipment: existing, deduplicated: true };
    }
  }

  if (input.externalOrderRef) {
    const dupOrder = await Shipment.findOne({
      businessId: business._id,
      externalOrderRef: input.externalOrderRef,
    });
    if (dupOrder) {
      throw new HttpError(
        409,
        `Duplicate externalOrderRef '${input.externalOrderRef}' already exists for your business.`,
        'DUPLICATE_ORDER_REF'
      );
    }
  }

  if (!isValidObjectId(input.corridorId)) {
    throw new HttpError(400, 'Invalid corridorId', 'VALIDATION_ERROR');
  }
  if (input.slotId && !isValidObjectId(input.slotId)) {
    throw new HttpError(400, 'Invalid slotId', 'VALIDATION_ERROR');
  }

  const corridor = await Corridor.findById(input.corridorId);

  if (!corridor) {
    throw new HttpError(404, 'Corridor not found', 'CORRIDOR_NOT_FOUND');
  }
  if (corridor.isActive === false) {
    throw new HttpError(
      409,
      `Corridor ${corridor.code} is inactive and cannot open new bookings or pooling.`,
      'CORRIDOR_INACTIVE'
    );
  }

  const orderedStops = [...corridor.stops].sort(
    (a, b) => a.sequenceOrder - b.sequenceOrder
  );
  const originStop = orderedStops[0];
  if (!originStop) {
    throw new HttpError(
      400,
      'Corridor has no configured origin hub.',
      'INVALID_CORRIDOR_STOPS'
    );
  }

  const pickupStop = orderedStops.find(
    (s) => s.stopCode.toUpperCase() === input.pickupStopCode.toUpperCase()
  );
  const deliveryStop = orderedStops.find(
    (s) => s.stopCode.toUpperCase() === input.deliveryStopCode.toUpperCase()
  );

  if (!pickupStop || !deliveryStop) {
    throw new HttpError(
      400,
      'Pickup and delivery stops must match configured corridor stops',
      'INVALID_STOP'
    );
  }

  if (pickupStop.stopCode.toUpperCase() !== originStop.stopCode.toUpperCase()) {
    throw new HttpError(
      400,
      `Origin pickup must use the corridor origin hub (${originStop.stopCode} — ${originStop.name}).`,
      'INVALID_ORIGIN_STOP'
    );
  }

  if (
    deliveryStop.stopCode.toUpperCase() === originStop.stopCode.toUpperCase() ||
    pickupStop.sequenceOrder >= deliveryStop.sequenceOrder
  ) {
    throw new HttpError(
      400,
      'Destination must be a downstream drop zone on the selected corridor',
      'INVALID_STOP_ORDER'
    );
  }

  const pickupAddress: StructuredAddress = input.pickupAddress ?? business.pickupAddress;
  assertValidBookingCoordinates(pickupAddress, 'Pickup');
  assertValidBookingCoordinates(input.deliveryAddress, 'Delivery');

  const stopCoords = deliveryStop.location?.coordinates;
  if (
    Array.isArray(stopCoords) &&
    stopCoords.length === 2 &&
    !(stopCoords[0] === 0 && stopCoords[1] === 0)
  ) {
    const distKm = haversineDistanceKm(
      input.deliveryAddress.location.coordinates,
      stopCoords
    );
    if (distKm > MAX_DROP_ZONE_RADIUS_KM) {
      throw new HttpError(
        400,
        `Recipient delivery location is ${distKm.toFixed(
          1
        )} km from ${deliveryStop.name} (permitted drop zone service area: ${MAX_DROP_ZONE_RADIUS_KM} km). Please adjust the delivery pin or choose the matching drop zone.`,
        'DELIVERY_OUT_OF_DROP_ZONE'
      );
    }
  }

  const cargoMetrics = calculateCargoMetrics({
    category: input.cargo.category as CargoCategory,
    quantity: input.cargo.quantity,
    length: input.cargo.length,
    width: input.cargo.width,
    height: input.cargo.height,
    dimensionUnit: input.cargo.dimensionUnit as DimensionUnit,
    unitActualWeight: input.cargo.unitActualWeight,
    weightUnit: input.cargo.weightUnit as WeightUnit,
  });

  let slot: ISlot | null = null;
  if (input.slotId) {
    slot = await Slot.findById(input.slotId);
    if (!slot || !slot.corridorId.equals(corridor._id)) {
      throw new HttpError(404, 'Slot not found for the selected corridor', 'SLOT_NOT_FOUND');
    }
    if (slot.status !== 'OPEN') {
      throw new HttpError(
        409,
        `Pool is ${slot.status} and no longer accepting bookings.`,
        'SLOT_NOT_OPEN'
      );
    }
    if (now >= slot.cutoffAt) {
      const dateLabel = toServiceDateKey(slot.departureDate || slot.plannedDepartureAt);
      throw new HttpError(
        409,
        `Booking cutoff has passed for ${
          dateLabel ? `service date ${dateLabel}` : `slot ${slot.slotCode}`
        }. Please choose an upcoming service date.`,
        'CUTOFF_PASSED'
      );
    }

    const remainingWeight = slot.capacityWeightKg - slot.reservedWeightKg;
    const remainingVolume = slot.capacityVolumeCbm - slot.reservedVolumeCbm;
    if (
      cargoMetrics.chargeableWeightKg > remainingWeight ||
      cargoMetrics.totalVolumeCbm > remainingVolume
    ) {
      throw new HttpError(
        409,
        `Insufficient remaining capacity (available: ${remainingWeight.toFixed(
          1
        )} kg / ${remainingVolume.toFixed(2)} m³).`,
        'SLOT_CAPACITY_EXCEEDED'
      );
    }
  } else if (input.serviceDate) {
    slot = await matchOperationalSlotForBooking({
      corridorId: corridor._id,
      serviceDate: input.serviceDate,
      chargeableWeightKg: cargoMetrics.chargeableWeightKg,
      volumeCbm: cargoMetrics.totalVolumeCbm,
      now,
    });
  } else {
    throw new HttpError(400, 'serviceDate is required for booking', 'VALIDATION_ERROR');
  }

  const shipment = await Shipment.create({
    reference: generateShipmentReference(now),
    businessId: business._id,
    createdByUserId: userId,
    corridorId: corridor._id,
    slotId: slot._id,
    pickupStopCode: pickupStop.stopCode,
    pickupStopOrder: pickupStop.sequenceOrder,
    deliveryStopCode: deliveryStop.stopCode,
    deliveryStopOrder: deliveryStop.sequenceOrder,
    pickupAddress,
    deliveryAddress: input.deliveryAddress,
    recipientName: input.recipientName,
    recipientPhone: input.recipientPhone,
    cargo: {
      category: cargoMetrics.category,
      quantity: cargoMetrics.quantity,
      unitDimensionsCm: cargoMetrics.unitDimensionsCm,
      unitActualWeightKg: cargoMetrics.unitActualWeightKg,
      totalActualWeightKg: cargoMetrics.totalActualWeightKg,
      volumetricDivisor: cargoMetrics.volumetricDivisor,
      volumetricWeightKg: cargoMetrics.totalVolumetricWeightKg,
      chargeableWeightKg: cargoMetrics.chargeableWeightKg,
      billingBasis: cargoMetrics.billingBasis,
      volumeCbm: cargoMetrics.totalVolumeCbm,
      stackable: input.cargo.stackable,
      handlingRestrictions: input.cargo.handlingRestrictions,
      declaredContents: input.cargo.declaredContents,
      handlingNotes: input.cargo.handlingNotes,
      irregularCargoNotes: input.cargo.irregularCargoNotes,
    },
    serviceType: input.serviceType ?? 'STANDARD_SCHEDULED_SHARED_POOL',
    paymentChoice: (input.paymentChoice ?? 'TOKEN_PLUS_PICKUP_BALANCE') as PaymentChoice,
    tokenStatus: 'PENDING',
    status: 'PENDING_TOKEN',
    ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
    ...(input.externalOrderRef ? { externalOrderRef: input.externalOrderRef } : {}),
    trackingToken: crypto.randomBytes(24).toString('hex'),
    qrToken: crypto.randomBytes(16).toString('hex'),
    statusHistory: [
      {
        status: 'PENDING_TOKEN',
        at: now,
        actorUserId: userId,
        note: 'Booking created; awaiting refundable token confirmation',
      },
    ],
  });

  return { shipment, deduplicated: false };
}

export async function confirmShipmentToken(params: {
  businessId: Types.ObjectId;
  shipmentId: string;
  userId: string;
  now?: Date;
}) {
  const { businessId, shipmentId, userId, now = new Date() } = params;
  if (!isValidObjectId(shipmentId)) {
    throw new HttpError(400, 'Invalid shipmentId', 'VALIDATION_ERROR');
  }

  return withTransaction(async (session) => {
    const shipment = await Shipment.findOne({
      _id: shipmentId,
      businessId,
    }).session(session);

    if (!shipment) {
      throw new HttpError(403, 'Shipment not found for your business', 'FORBIDDEN');
    }

    if (shipment.status === 'CONFIRMED' && shipment.tokenStatus === 'PAID') {
      return { shipment, alreadyConfirmed: true };
    }

    if (!isValidShipmentTransition(shipment.status, 'CONFIRMED')) {
      throw new HttpError(
        409,
        `Cannot confirm booking from status ${shipment.status}`,
        'INVALID_TRANSITION'
      );
    }

    assertValidBookingCoordinates(shipment.deliveryAddress, 'Delivery');

    const updatedSlot = await Slot.findOneAndUpdate(
      {
        _id: shipment.slotId,
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

    if (!updatedSlot) {
      throw new HttpError(
        409,
        'Slot cutoff has passed or remaining capacity is insufficient to confirm this booking.',
        'SLOT_UNAVAILABLE'
      );
    }

    shipment.tokenStatus = 'PAID';
    shipment.status = 'CONFIRMED';
    shipment.statusHistory.push({
      status: 'CONFIRMED',
      at: now,
      actorUserId: shipment.createdByUserId,
      note: `Token satisfied by user ${userId}; slot capacity reserved`,
    });
    await shipment.save({ session: session ?? undefined });

    return { shipment, slot: updatedSlot, alreadyConfirmed: false };
  });
}
