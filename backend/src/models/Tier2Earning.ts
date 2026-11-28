import { Schema, model, type Document, type Types } from 'mongoose';
import type { MarketplaceOpportunityType } from './MarketplacePolicy.js';

export type Tier2EarningStatus =
  | 'OFFERED'
  | 'ACCEPTED'
  | 'TRIP_COMPLETED'
  | 'PENDING_SETTLEMENT'
  | 'PAID'
  | 'ON_HOLD'
  | 'DISPUTED'
  | 'REVERSED';

export interface ITier2Earning extends Document {
  _id: Types.ObjectId;
  earningCode: string;
  opportunityId: Types.ObjectId;
  tripId?: Types.ObjectId;
  driverUserId: Types.ObjectId;
  vehicleId: Types.ObjectId;
  opportunityType: MarketplaceOpportunityType;
  status: Tier2EarningStatus;
  currency: 'INR';
  grossPayoutPaise: number;
  adjustmentsPaise: number;
  netPayablePaise: number;
  policyVersion: string;
  isSimulated: boolean;
  settlementRef?: string;
  settlementIdempotencyKey?: string;
  settledAt?: Date;
  holdOrDisputeReason?: string;
  reversalReason?: string;
  completedAt?: Date;
  auditHistory: Array<{
    action: string;
    fromStatus?: Tier2EarningStatus;
    toStatus: Tier2EarningStatus;
    actorUserId?: Types.ObjectId;
    note?: string;
    at: Date;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

const tier2EarningSchema = new Schema<ITier2Earning>(
  {
    earningCode: { type: String, required: true, unique: true, uppercase: true, trim: true },
    opportunityId: {
      type: Schema.Types.ObjectId,
      ref: 'MarketplaceOpportunity',
      required: true,
    },
    tripId: { type: Schema.Types.ObjectId, ref: 'Trip', index: true },
    driverUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    vehicleId: { type: Schema.Types.ObjectId, ref: 'Vehicle', required: true },
    opportunityType: {
      type: String,
      enum: ['OVERFLOW', 'RIGHT_SIZING', 'EXPRESS', 'NEW_ROUTE'],
      required: true,
    },
    status: {
      type: String,
      enum: [
        'OFFERED',
        'ACCEPTED',
        'TRIP_COMPLETED',
        'PENDING_SETTLEMENT',
        'PAID',
        'ON_HOLD',
        'DISPUTED',
        'REVERSED',
      ],
      default: 'ACCEPTED',
      required: true,
      index: true,
    },
    currency: { type: String, enum: ['INR'], default: 'INR', required: true },
    grossPayoutPaise: {
      type: Number,
      required: true,
      min: 0,
      validate: { validator: Number.isInteger, message: 'Payout must be integer paise' },
    },
    adjustmentsPaise: {
      type: Number,
      default: 0,
      validate: { validator: Number.isInteger, message: 'Adjustments must be integer paise' },
    },
    netPayablePaise: {
      type: Number,
      required: true,
      min: 0,
      validate: { validator: Number.isInteger, message: 'Net payable must be integer paise' },
    },
    policyVersion: { type: String, required: true, trim: true },
    isSimulated: { type: Boolean, default: true },
    settlementRef: { type: String, trim: true },
    settlementIdempotencyKey: { type: String, trim: true },
    settledAt: { type: Date },
    holdOrDisputeReason: { type: String, trim: true, maxlength: 300 },
    reversalReason: { type: String, trim: true, maxlength: 300 },
    completedAt: { type: Date },
    auditHistory: {
      type: [
        new Schema(
          {
            action: { type: String, required: true },
            fromStatus: { type: String },
            toStatus: { type: String, required: true },
            actorUserId: { type: Schema.Types.ObjectId, ref: 'User' },
            note: { type: String, trim: true },
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

// Prevent duplicate payable earning records for same trip or driver+opportunity
tier2EarningSchema.index(
  { opportunityId: 1, driverUserId: 1 },
  {
    name: 'uniq_active_earning_per_opp_driver',
    unique: true,
    partialFilterExpression: {
      status: { $in: ['ACCEPTED', 'TRIP_COMPLETED', 'PENDING_SETTLEMENT', 'PAID', 'ON_HOLD', 'DISPUTED'] },
    },
  }
);
tier2EarningSchema.index(
  { tripId: 1 },
  {
    name: 'uniq_active_earning_per_trip',
    unique: true,
    partialFilterExpression: {
      tripId: { $exists: true },
      status: { $in: ['ACCEPTED', 'TRIP_COMPLETED', 'PENDING_SETTLEMENT', 'PAID', 'ON_HOLD', 'DISPUTED'] },
    },
  }
);
tier2EarningSchema.index(
  { settlementIdempotencyKey: 1 },
  {
    name: 'uniq_settlement_idempotency',
    unique: true,
    partialFilterExpression: { settlementIdempotencyKey: { $type: 'string' } },
  }
);

export const Tier2Earning = model<ITier2Earning>('Tier2Earning', tier2EarningSchema);
