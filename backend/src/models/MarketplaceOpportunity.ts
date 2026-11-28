import { Schema, model, type Document, type Types } from 'mongoose';
import { geoPointSchema, type GeoPoint } from './common.js';
import type { MarketplaceOpportunityType } from './MarketplacePolicy.js';

export type MarketplaceOpportunityStatus =
  | 'CREATED'
  | 'OPEN'
  | 'OFFERED'
  | 'ACCEPTED'
  | 'ASSIGNED'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'REASSIGNING'
  | 'COMPLETED'
  | 'FAILED';

export type MarketplaceDriverOfferStatus =
  | 'OFFERED'
  | 'VIEWED'
  | 'ACCEPTED'
  | 'DECLINED'
  | 'EXPIRED'
  | 'REVOKED';

export interface MarketplaceDriverOffer {
  driverUserId: Types.ObjectId;
  vehicleId: Types.ObjectId;
  offerVersion: number;
  status: MarketplaceDriverOfferStatus;
  spotPayoutPaise: number;
  approachDistanceKm: number;
  offeredAt: Date;
  viewedAt?: Date;
  respondedAt?: Date;
  expiresAt: Date;
  declineReason?: string;
}

export interface MarketplaceOpportunityAuditEntry {
  action: string;
  fromStatus?: MarketplaceOpportunityStatus;
  toStatus: MarketplaceOpportunityStatus;
  actorUserId?: Types.ObjectId;
  reason?: string;
  at: Date;
}

export interface IMarketplaceOpportunity extends Document {
  _id: Types.ObjectId;
  opportunityCode: string;
  opportunityType: MarketplaceOpportunityType;
  status: MarketplaceOpportunityStatus;
  offerVersion: number;
  sourceDemandKey?: string;
  corridorId?: Types.ObjectId;
  sourcePoolId?: Types.ObjectId;
  sourceSlotId?: Types.ObjectId;
  shipmentIds: Types.ObjectId[];
  originLabel: string;
  destinationLabel: string;
  originStopCode: string;
  deliveryStopCode: string;
  originLocation: GeoPoint;
  destinationLocation: GeoPoint;
  stopsSummary: Array<{ stopCode: string; name: string; sequenceOrder: number }>;
  serviceWindowStartAt: Date;
  pickupDeadlineAt: Date;
  deliveryDeadlineAt: Date;
  earlyFillFirstRefusalUntil?: Date;
  offerExpiresAt: Date;
  cargoSummary: {
    shipmentCount: number;
    totalWeightKg: number;
    totalVolumeCbm: number;
    maxUnitLengthCm: number;
    maxUnitWidthCm: number;
    maxUnitHeightCm: number;
    allStackable: boolean;
    handlingRestrictions: string[];
    requiredBodyTypes?: string[];
    summaryLabel: string;
  };
  estimatedDistanceKm: number;
  estimatedDurationMin: number;
  payoutQuote: {
    currency: 'INR';
    spotPayoutPaise: number;
    baseFeePaise: number;
    distancePayPaise: number;
    cargoAllowancePaise: number;
    urgencyPremiumPaise: number;
    approachAllowancePaise: number;
    tollAllowancePaise: number;
    tier1MinGuaranteeIncludedPaise: number;
    policyVersion: string;
  };
  offers: MarketplaceDriverOffer[];
  declinedOrExhaustedDriverIds: Types.ObjectId[];
  acceptedByDriverId?: Types.ObjectId;
  acceptedVehicleId?: Types.ObjectId;
  acceptedAt?: Date;
  tripId?: Types.ObjectId;
  orchestrationReason: string;
  auditHistory: MarketplaceOpportunityAuditEntry[];
  createdAt: Date;
  updatedAt: Date;
}

const driverOfferSchema = new Schema<MarketplaceDriverOffer>(
  {
    driverUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    vehicleId: { type: Schema.Types.ObjectId, ref: 'Vehicle', required: true },
    offerVersion: { type: Number, required: true, min: 1 },
    status: {
      type: String,
      enum: ['OFFERED', 'VIEWED', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'REVOKED'],
      default: 'OFFERED',
      required: true,
    },
    spotPayoutPaise: { type: Number, required: true, min: 0 },
    approachDistanceKm: { type: Number, default: 0, min: 0 },
    offeredAt: { type: Date, required: true, default: Date.now },
    viewedAt: { type: Date },
    respondedAt: { type: Date },
    expiresAt: { type: Date, required: true },
    declineReason: { type: String, trim: true, maxlength: 300 },
  },
  { _id: false }
);

const marketplaceOpportunitySchema = new Schema<IMarketplaceOpportunity>(
  {
    opportunityCode: { type: String, required: true, unique: true, uppercase: true, trim: true },
    opportunityType: {
      type: String,
      enum: ['OVERFLOW', 'RIGHT_SIZING', 'EXPRESS', 'NEW_ROUTE'],
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: [
        'CREATED',
        'OPEN',
        'OFFERED',
        'ACCEPTED',
        'ASSIGNED',
        'EXPIRED',
        'CANCELLED',
        'REASSIGNING',
        'COMPLETED',
        'FAILED',
      ],
      default: 'OPEN',
      required: true,
      index: true,
    },
    offerVersion: { type: Number, default: 1, min: 1 },
    sourceDemandKey: { type: String, trim: true },
    corridorId: { type: Schema.Types.ObjectId, ref: 'Corridor', index: true },
    sourcePoolId: { type: Schema.Types.ObjectId, ref: 'Pool', index: true },
    sourceSlotId: { type: Schema.Types.ObjectId, ref: 'Slot' },
    shipmentIds: [{ type: Schema.Types.ObjectId, ref: 'Shipment', required: true }],
    originLabel: { type: String, required: true, trim: true },
    destinationLabel: { type: String, required: true, trim: true },
    originStopCode: { type: String, required: true, uppercase: true, trim: true },
    deliveryStopCode: { type: String, required: true, uppercase: true, trim: true },
    originLocation: { type: geoPointSchema, required: true },
    destinationLocation: { type: geoPointSchema, required: true },
    stopsSummary: {
      type: [
        new Schema(
          {
            stopCode: { type: String, required: true },
            name: { type: String, required: true },
            sequenceOrder: { type: Number, required: true },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
    serviceWindowStartAt: { type: Date, required: true },
    pickupDeadlineAt: { type: Date, required: true },
    deliveryDeadlineAt: { type: Date, required: true },
    earlyFillFirstRefusalUntil: { type: Date },
    offerExpiresAt: { type: Date, required: true, index: true },
    cargoSummary: {
      shipmentCount: { type: Number, required: true, min: 1 },
      totalWeightKg: { type: Number, required: true, min: 0.01 },
      totalVolumeCbm: { type: Number, required: true, min: 0.0001 },
      maxUnitLengthCm: { type: Number, required: true, min: 1 },
      maxUnitWidthCm: { type: Number, required: true, min: 1 },
      maxUnitHeightCm: { type: Number, required: true, min: 1 },
      allStackable: { type: Boolean, default: true },
      handlingRestrictions: { type: [String], default: [] },
      requiredBodyTypes: { type: [String], default: undefined },
      summaryLabel: { type: String, required: true, trim: true },
    },
    estimatedDistanceKm: { type: Number, required: true, min: 1 },
    estimatedDurationMin: { type: Number, required: true, min: 15 },
    payoutQuote: {
      currency: { type: String, enum: ['INR'], default: 'INR', required: true },
      spotPayoutPaise: { type: Number, required: true, min: 0 },
      baseFeePaise: { type: Number, required: true, min: 0 },
      distancePayPaise: { type: Number, required: true, min: 0 },
      cargoAllowancePaise: { type: Number, required: true, min: 0 },
      urgencyPremiumPaise: { type: Number, default: 0, min: 0 },
      approachAllowancePaise: { type: Number, default: 0, min: 0 },
      tollAllowancePaise: { type: Number, default: 0, min: 0 },
      tier1MinGuaranteeIncludedPaise: { type: Number, default: 0, min: 0 },
      policyVersion: { type: String, required: true },
    },
    offers: { type: [driverOfferSchema], default: [] },
    declinedOrExhaustedDriverIds: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    acceptedByDriverId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    acceptedVehicleId: { type: Schema.Types.ObjectId, ref: 'Vehicle' },
    acceptedAt: { type: Date },
    tripId: { type: Schema.Types.ObjectId, ref: 'Trip', index: true },
    orchestrationReason: { type: String, required: true, trim: true },
    auditHistory: {
      type: [
        new Schema(
          {
            action: { type: String, required: true },
            fromStatus: { type: String },
            toStatus: { type: String, required: true },
            actorUserId: { type: Schema.Types.ObjectId, ref: 'User' },
            reason: { type: String, trim: true },
            at: { type: Date, required: true, default: Date.now },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
  },
  { timestamps: true }
);

marketplaceOpportunitySchema.index(
  { sourceDemandKey: 1 },
  {
    name: 'uniq_active_demand_opportunity',
    unique: true,
    partialFilterExpression: {
      sourceDemandKey: { $type: 'string' },
      status: { $in: ['CREATED', 'OPEN', 'OFFERED', 'ACCEPTED', 'ASSIGNED', 'REASSIGNING'] },
    },
  }
);
marketplaceOpportunitySchema.index({ 'offers.driverUserId': 1, status: 1 });

export const MarketplaceOpportunity = model<IMarketplaceOpportunity>(
  'MarketplaceOpportunity',
  marketplaceOpportunitySchema
);
