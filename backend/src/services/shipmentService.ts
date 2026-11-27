import crypto from 'node:crypto';
import { isValidObjectId, type Types } from 'mongoose';
import { z } from 'zod';
import { withTransaction } from '../config/database.js';
import type { IBusinessProfile, StructuredAddress } from '../models/BusinessProfile.js';
import { isValidLngLat } from '../models/common.js';
import { Corridor } from '../models/Corridor.js';
import {
  isValidShipmentTransition,
  Shipment,
  type IShipment,
  type PaymentChoice,
} from '../models/Shipment.js';
import { Slot } from '../models/Slot.js';
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

export const createBookingSchema = z.object({
  corridorId: z.string().min(1),
  slotId: z.string().min(1),
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
    .enum(['TOKEN_PLUS_PICKUP_BALANCE', 'FULL_PREPAID'])
    .default('TOKEN_PLUS_PICKUP_BALANCE'),
  idempotencyKey: z.string().trim().min(4).max(120).optional(),
  externalOrderRef: z.string().trim().min(1).max(80).optional(),
});

export type CreateBookingInput = z.infer<typeof createBookingSchema>;

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

  if (!isValidObjectId(input.corridorId) || !isValidObjectId(input.slotId)) {
    throw new HttpError(400, 'Invalid corridorId or slotId', 'VALIDATION_ERROR');
  }

  const [corridor, slot] = await Promise.all([
    Corridor.findById(input.corridorId),
    Slot.findById(input.slotId),
  ]);

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
  if (!slot || !slot.corridorId.equals(corridor._id)) {
    throw new HttpError(404, 'Slot not found for the selected corridor', 'SLOT_NOT_FOUND');
  }

  if (slot.status !== 'OPEN') {
    throw new HttpError(
      409,
      `Slot ${slot.slotCode} is ${slot.status} and no longer accepting bookings.`,
      'SLOT_NOT_OPEN'
    );
  }

  if (now >= slot.cutoffAt) {
    throw new HttpError(
      409,
      `Booking cutoff has passed for slot ${slot.slotCode}. Please select a later departure slot.`,
      'CUTOFF_PASSED'
    );
  }

  const pickupStop = corridor.stops.find(
    (s) => s.stopCode.toUpperCase() === input.pickupStopCode.toUpperCase()
  );
  const deliveryStop = corridor.stops.find(
    (s) => s.stopCode.toUpperCase() === input.deliveryStopCode.toUpperCase()
  );

  if (!pickupStop || !deliveryStop) {
    throw new HttpError(
      400,
      'Pickup and delivery stops must match configured corridor stops',
      'INVALID_STOP'
    );
  }

  if (pickupStop.sequenceOrder >= deliveryStop.sequenceOrder) {
    throw new HttpError(
      400,
      'Delivery stop must come after pickup stop along the outbound corridor',
      'INVALID_STOP_ORDER'
    );
  }

  const pickupAddress: StructuredAddress = input.pickupAddress ?? business.pickupAddress;
  assertValidBookingCoordinates(pickupAddress, 'Pickup');
  assertValidBookingCoordinates(input.deliveryAddress, 'Delivery');

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

  const remainingWeight = slot.capacityWeightKg - slot.reservedWeightKg;
  const remainingVolume = slot.capacityVolumeCbm - slot.reservedVolumeCbm;

  if (
    cargoMetrics.chargeableWeightKg > remainingWeight ||
    cargoMetrics.totalVolumeCbm > remainingVolume
  ) {
    throw new HttpError(
      409,
      `Insufficient remaining capacity in slot ${slot.slotCode} (available: ${remainingWeight.toFixed(
        1
      )} kg / ${remainingVolume.toFixed(2)} m³).`,
      'SLOT_CAPACITY_EXCEEDED'
    );
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
    paymentChoice: input.paymentChoice as PaymentChoice,
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
