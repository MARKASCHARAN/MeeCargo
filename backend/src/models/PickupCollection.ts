import { Schema, model, type Document, type Types } from 'mongoose';

export type PickupPaymentMethod =
  | 'SIMULATED_UPI'
  | 'CASH_AT_PICKUP'
  | 'TEST_GATEWAY';

export type CollectionState = 'INITIATED' | 'COLLECTED_BY_DRIVER' | 'FAILED';
export type SettlementState = 'UNSETTLED' | 'PENDING_SETTLEMENT' | 'SETTLED';

export interface IPickupCollection extends Document {
  _id: Types.ObjectId;
  shipmentId: Types.ObjectId;
  tripId: Types.ObjectId;
  businessId: Types.ObjectId;
  collectedByDriverId: Types.ObjectId;
  lockedPricePaise: number;
  tokenPaidPaise: number;
  adjustmentsPaise: number;
  remainingBalancePaise: number;
  collectedAmountPaise: number;
  paymentMethod: PickupPaymentMethod;
  providerRef: string;
  collectionState: CollectionState;
  settlementState: SettlementState;
  isSimulated: boolean;
  idempotencyKey?: string;
  collectedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const pickupCollectionSchema = new Schema<IPickupCollection>(
  {
    shipmentId: { type: Schema.Types.ObjectId, ref: 'Shipment', required: true, index: true },
    tripId: { type: Schema.Types.ObjectId, ref: 'Trip', required: true, index: true },
    businessId: { type: Schema.Types.ObjectId, ref: 'BusinessProfile', required: true },
    collectedByDriverId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    lockedPricePaise: { type: Number, required: true, min: 0 },
    tokenPaidPaise: { type: Number, required: true, min: 0 },
    adjustmentsPaise: { type: Number, default: 0 },
    remainingBalancePaise: { type: Number, required: true, min: 0 },
    collectedAmountPaise: { type: Number, required: true, min: 0 },
    paymentMethod: {
      type: String,
      enum: ['SIMULATED_UPI', 'CASH_AT_PICKUP', 'TEST_GATEWAY'],
      required: true,
    },
    providerRef: { type: String, required: true, unique: true, trim: true },
    collectionState: {
      type: String,
      enum: ['INITIATED', 'COLLECTED_BY_DRIVER', 'FAILED'],
      default: 'COLLECTED_BY_DRIVER',
    },
    settlementState: {
      type: String,
      enum: ['UNSETTLED', 'PENDING_SETTLEMENT', 'SETTLED'],
      default: 'PENDING_SETTLEMENT',
    },
    isSimulated: { type: Boolean, default: true },
    idempotencyKey: { type: String, trim: true },
    collectedAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true }
);

pickupCollectionSchema.index(
  { shipmentId: 1, idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $type: 'string' } },
  }
);

export const PickupCollection = model<IPickupCollection>(
  'PickupCollection',
  pickupCollectionSchema
);
