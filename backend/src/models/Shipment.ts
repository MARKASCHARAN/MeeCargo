import { Schema, model, type Document, type Types } from 'mongoose';
import type { StructuredAddress } from './BusinessProfile.js';
import { geoPointSchema } from './common.js';
import type { CargoCategory } from '../services/cargoCalculator.js';

export type ShipmentStatus =
  | 'DRAFT'
  | 'PENDING_TOKEN'
  | 'CONFIRMED'
  | 'POOLED'
  | 'LOCKED'
  | 'PICKED_UP'
  | 'IN_TRANSIT'
  | 'AT_DESTINATION'
  | 'PARTIALLY_DELIVERED'
  | 'DELIVERED'
  | 'FAILED'
  | 'RETURNED'
  | 'CANCELLED'
  | 'ROLLED_OVER';

export type PaymentChoice = 'TOKEN_PLUS_PICKUP_BALANCE' | 'FULL_PREPAID';
export type TokenPaymentState =
  | 'UNPAID'
  | 'PENDING'
  | 'PAID'
  | 'REFUND_PENDING'
  | 'REFUNDED';

export interface ShipmentCargo {
  category: CargoCategory;
  quantity: number;
  unitDimensionsCm: {
    length: number;
    width: number;
    height: number;
  };
  unitActualWeightKg: number;
  totalActualWeightKg: number;
  volumetricDivisor: number;
  volumetricWeightKg: number;
  chargeableWeightKg: number;
  billingBasis: 'ACTUAL' | 'VOLUMETRIC';
  volumeCbm: number;
  stackable: boolean;
  handlingRestrictions: string[];
  declaredContents: string;
  handlingNotes?: string;
  irregularCargoNotes?: string;
}

export interface ShipmentStatusEvent {
  status: ShipmentStatus;
  at: Date;
  actorUserId?: Types.ObjectId;
  note?: string;
}

export interface ShipmentPricingSnapshot {
  pricingVersion: string;
  ceilingPricePaise: number;
  projectedPricePaise: number;
  finalLockedPricePaise?: number;
  tokenAmountPaise: number;
  tokenPaidPaise: number;
  remainingBalancePaise?: number;
  isAnchorEligible: boolean;
  poolDiscountPaise: number;
  anchorDiscountPaise: number;
  handlingFeePaise: number;
  subsidyPaise: number;
  marginFlagged: boolean;
}

export type ViabilityDecision =
  | 'NONE'
  | 'PENDING_CHOICE'
  | 'ROLLOVER_CONSENTED'
  | 'REFUND_REQUESTED';

export interface IShipment extends Document {
  _id: Types.ObjectId;
  reference: string;
  businessId: Types.ObjectId;
  createdByUserId: Types.ObjectId;
  corridorId: Types.ObjectId;
  slotId: Types.ObjectId;
  poolId?: Types.ObjectId;
  tripId?: Types.ObjectId;
  pickupStopCode: string;
  pickupStopOrder: number;
  deliveryStopCode: string;
  deliveryStopOrder: number;
  pickupAddress: StructuredAddress;
  deliveryAddress: StructuredAddress;
  recipientName: string;
  recipientPhone: string;
  cargo: ShipmentCargo;
  paymentChoice: PaymentChoice;
  tokenStatus: TokenPaymentState;
  pricingSnapshot?: ShipmentPricingSnapshot;
  viabilityDecision: ViabilityDecision;
  rolledOverFromSlotId?: Types.ObjectId;
  status: ShipmentStatus;
  idempotencyKey?: string;
  externalOrderRef?: string;
  trackingToken: string;
  trackingTokenExpiresAt?: Date;
  trackingTokenRevokedAt?: Date;
  qrToken: string;
  pickupVerifiedAt?: Date;
  pickupBalanceRequestedAt?: Date;
  allowB2bWarehouseConfirm: boolean;
  statusHistory: ShipmentStatusEvent[];
  createdAt: Date;
  updatedAt: Date;
}

const ALLOWED_SHIPMENT_TRANSITIONS: Record<ShipmentStatus, ShipmentStatus[]> = {
  DRAFT: ['PENDING_TOKEN', 'CANCELLED'],
  PENDING_TOKEN: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['POOLED', 'CANCELLED', 'ROLLED_OVER'],
  POOLED: ['LOCKED', 'CANCELLED', 'ROLLED_OVER'],
  LOCKED: ['PICKED_UP', 'FAILED', 'CANCELLED'],
  PICKED_UP: ['IN_TRANSIT', 'PARTIALLY_DELIVERED', 'FAILED'],
  IN_TRANSIT: ['AT_DESTINATION', 'PARTIALLY_DELIVERED', 'FAILED'],
  AT_DESTINATION: ['DELIVERED', 'PARTIALLY_DELIVERED', 'FAILED'],
  PARTIALLY_DELIVERED: ['DELIVERED', 'RETURNED', 'FAILED'],
  DELIVERED: [],
  FAILED: ['ROLLED_OVER', 'RETURNED', 'POOLED', 'CANCELLED'],
  RETURNED: [],
  CANCELLED: [],
  ROLLED_OVER: ['POOLED', 'CANCELLED'],
};

export function isValidShipmentTransition(
  from: ShipmentStatus,
  to: ShipmentStatus
): boolean {
  return ALLOWED_SHIPMENT_TRANSITIONS[from]?.includes(to) ?? false;
}

const shipmentAddressSchema = new Schema<StructuredAddress>(
  {
    addressLine: { type: String, required: true, trim: true, maxlength: 250 },
    villageOrTown: { type: String, required: true, trim: true, maxlength: 100 },
    district: { type: String, required: true, trim: true, maxlength: 100 },
    state: { type: String, required: true, trim: true, default: 'Gujarat', maxlength: 80 },
    pincode: {
      type: String,
      required: true,
      trim: true,
      match: [/^\d{6}$/, 'PIN code must be 6 digits'],
    },
    landmark: { type: String, trim: true, maxlength: 150 },
    location: { type: geoPointSchema, required: true },
  },
  { _id: false }
);

const shipmentSchema = new Schema<IShipment>(
  {
    reference: { type: String, required: true, unique: true, uppercase: true, trim: true },
    businessId: {
      type: Schema.Types.ObjectId,
      ref: 'BusinessProfile',
      required: true,
      index: true,
    },
    createdByUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    corridorId: { type: Schema.Types.ObjectId, ref: 'Corridor', required: true },
    slotId: { type: Schema.Types.ObjectId, ref: 'Slot', required: true, index: true },
    poolId: { type: Schema.Types.ObjectId, ref: 'Pool' },
    tripId: { type: Schema.Types.ObjectId, ref: 'Trip' },
    pickupStopCode: { type: String, required: true, uppercase: true, trim: true },
    pickupStopOrder: { type: Number, required: true, min: 0 },
    deliveryStopCode: { type: String, required: true, uppercase: true, trim: true },
    deliveryStopOrder: { type: Number, required: true, min: 1 },
    pickupAddress: { type: shipmentAddressSchema, required: true },
    deliveryAddress: { type: shipmentAddressSchema, required: true },
    recipientName: { type: String, required: true, trim: true, maxlength: 120 },
    recipientPhone: { type: String, required: true, trim: true, maxlength: 20 },
    cargo: {
      category: {
        type: String,
        enum: ['STANDARD_BOX', 'SACK_BAG', 'TEXTILE_ROLL', 'PALLET_BUNDLE', 'CUSTOM'],
        required: true,
      },
      quantity: { type: Number, required: true, min: 1 },
      unitDimensionsCm: {
        length: { type: Number, required: true, min: 1 },
        width: { type: Number, required: true, min: 1 },
        height: { type: Number, required: true, min: 1 },
      },
      unitActualWeightKg: { type: Number, required: true, min: 0.01 },
      totalActualWeightKg: { type: Number, required: true, min: 0.01 },
      volumetricDivisor: { type: Number, required: true, min: 1 },
      volumetricWeightKg: { type: Number, required: true, min: 0.01 },
      chargeableWeightKg: { type: Number, required: true, min: 0.01 },
      billingBasis: { type: String, enum: ['ACTUAL', 'VOLUMETRIC'], required: true },
      volumeCbm: { type: Number, required: true, min: 0.0001 },
      stackable: { type: Boolean, default: true },
      handlingRestrictions: { type: [String], default: [] },
      declaredContents: { type: String, required: true, trim: true, maxlength: 200 },
      handlingNotes: { type: String, trim: true, maxlength: 300 },
      irregularCargoNotes: { type: String, trim: true, maxlength: 300 },
    },
    paymentChoice: {
      type: String,
      enum: ['TOKEN_PLUS_PICKUP_BALANCE', 'FULL_PREPAID'],
      default: 'TOKEN_PLUS_PICKUP_BALANCE',
    },
    tokenStatus: {
      type: String,
      enum: ['UNPAID', 'PENDING', 'PAID', 'REFUND_PENDING', 'REFUNDED'],
      default: 'UNPAID',
    },
    pricingSnapshot: {
      pricingVersion: { type: String },
      ceilingPricePaise: { type: Number },
      projectedPricePaise: { type: Number },
      finalLockedPricePaise: { type: Number },
      tokenAmountPaise: { type: Number },
      tokenPaidPaise: { type: Number, default: 0 },
      remainingBalancePaise: { type: Number },
      isAnchorEligible: { type: Boolean, default: false },
      poolDiscountPaise: { type: Number, default: 0 },
      anchorDiscountPaise: { type: Number, default: 0 },
      handlingFeePaise: { type: Number, default: 0 },
      subsidyPaise: { type: Number, default: 0 },
      marginFlagged: { type: Boolean, default: false },
    },
    viabilityDecision: {
      type: String,
      enum: ['NONE', 'PENDING_CHOICE', 'ROLLOVER_CONSENTED', 'REFUND_REQUESTED'],
      default: 'NONE',
    },
    rolledOverFromSlotId: { type: Schema.Types.ObjectId, ref: 'Slot' },
    status: {
      type: String,
      enum: [
        'DRAFT',
        'PENDING_TOKEN',
        'CONFIRMED',
        'POOLED',
        'LOCKED',
        'PICKED_UP',
        'IN_TRANSIT',
        'AT_DESTINATION',
        'PARTIALLY_DELIVERED',
        'DELIVERED',
        'FAILED',
        'RETURNED',
        'CANCELLED',
        'ROLLED_OVER',
      ],
      default: 'PENDING_TOKEN',
      index: true,
    },
    idempotencyKey: { type: String, trim: true },
    externalOrderRef: { type: String, trim: true },
    trackingToken: { type: String, required: true, unique: true },
    trackingTokenExpiresAt: { type: Date },
    trackingTokenRevokedAt: { type: Date },
    qrToken: { type: String, required: true, unique: true },
    pickupVerifiedAt: { type: Date },
    pickupBalanceRequestedAt: { type: Date },
    allowB2bWarehouseConfirm: { type: Boolean, default: true },
    statusHistory: [
      {
        status: { type: String, required: true },
        at: { type: Date, required: true, default: Date.now },
        actorUserId: { type: Schema.Types.ObjectId, ref: 'User' },
        note: { type: String, trim: true },
      },
    ],
  },
  { timestamps: true }
);

shipmentSchema.index({ 'pickupAddress.location': '2dsphere' });
shipmentSchema.index({ 'deliveryAddress.location': '2dsphere' });
shipmentSchema.index(
  { businessId: 1, idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $type: 'string' } },
  }
);
shipmentSchema.index(
  { businessId: 1, externalOrderRef: 1 },
  {
    unique: true,
    partialFilterExpression: { externalOrderRef: { $type: 'string' } },
  }
);

export const Shipment = model<IShipment>('Shipment', shipmentSchema);
