import { Schema, model, type Document, type Types } from 'mongoose';

export type PoolStatus =
  | 'OPEN'
  | 'LOCKING'
  | 'LOCKED'
  | 'AWAITING_VIABILITY_DECISION'
  | 'CANCELLED'
  | 'ROLLED_OVER';

export interface ShipmentLockedSnapshot {
  shipmentId: Types.ObjectId;
  chargeableWeightKg: number;
  baseFreightPaise: number;
  poolDiscountPaise: number;
  anchorDiscountPaise: number;
  handlingFeePaise: number;
  subsidyPaise: number;
  finalChargePaise: number;
  tokenPaidPaise: number;
  remainingBalancePaise: number;
}

export interface PoolLockedSnapshot {
  pricingVersion: string;
  lockedAt: Date;
  weightUtilizationPct: number;
  volumeUtilizationPct: number;
  appliedDiscountBps: number;
  anchorShipmentId?: Types.ObjectId;
  anchorRewardBps: number;
  effectiveRatePaisePerKg: number;
  ceilingRatePaisePerKg: number;
  totalPoolRevenuePaise: number;
  estimatedTripCostPaise: number;
  contributionPaise: number;
  shipmentSnapshots: ShipmentLockedSnapshot[];
}

export interface PoolAllocationCandidateAudit {
  vehicleId: Types.ObjectId;
  driverUserId?: Types.ObjectId;
  registrationNumber: string;
  tier: 'TIER_1' | 'TIER_2' | 'TIER_3';
  decision: 'ACCEPTED' | 'REJECTED';
  reason: string;
  at: Date;
}

export interface IPool extends Document {
  _id: Types.ObjectId;
  poolCode: string;
  corridorId: Types.ObjectId;
  slotId: Types.ObjectId;
  status: PoolStatus;
  capacityWeightKg: number;
  capacityVolumeCbm: number;
  reservedWeightKg: number;
  reservedVolumeCbm: number;
  shipmentIds: Types.ObjectId[];
  anchorShipmentId?: Types.ObjectId;
  viabilityStatus: 'PENDING' | 'PASSED' | 'FAILED';
  viabilityReason?: string;
  lockedSnapshot?: PoolLockedSnapshot;
  allocationAudit?: PoolAllocationCandidateAudit[];
  createdAt: Date;
  updatedAt: Date;
}

const shipmentLockedSnapshotSchema = new Schema<ShipmentLockedSnapshot>(
  {
    shipmentId: { type: Schema.Types.ObjectId, ref: 'Shipment', required: true },
    chargeableWeightKg: { type: Number, required: true },
    baseFreightPaise: { type: Number, required: true },
    poolDiscountPaise: { type: Number, required: true },
    anchorDiscountPaise: { type: Number, required: true },
    handlingFeePaise: { type: Number, required: true },
    subsidyPaise: { type: Number, default: 0 },
    finalChargePaise: { type: Number, required: true },
    tokenPaidPaise: { type: Number, required: true },
    remainingBalancePaise: { type: Number, required: true },
  },
  { _id: false }
);

const poolLockedSnapshotSchema = new Schema<PoolLockedSnapshot>(
  {
    pricingVersion: { type: String, required: true },
    lockedAt: { type: Date, required: true },
    weightUtilizationPct: { type: Number, required: true },
    volumeUtilizationPct: { type: Number, required: true },
    appliedDiscountBps: { type: Number, required: true },
    anchorShipmentId: { type: Schema.Types.ObjectId, ref: 'Shipment' },
    anchorRewardBps: { type: Number, required: true },
    effectiveRatePaisePerKg: { type: Number, required: true },
    ceilingRatePaisePerKg: { type: Number, required: true },
    totalPoolRevenuePaise: { type: Number, required: true },
    estimatedTripCostPaise: { type: Number, required: true },
    contributionPaise: { type: Number, required: true },
    shipmentSnapshots: { type: [shipmentLockedSnapshotSchema], default: [] },
  },
  { _id: false }
);

const poolSchema = new Schema<IPool>(
  {
    poolCode: { type: String, required: true, unique: true, uppercase: true, trim: true },
    corridorId: { type: Schema.Types.ObjectId, ref: 'Corridor', required: true, index: true },
    slotId: { type: Schema.Types.ObjectId, ref: 'Slot', required: true, unique: true },
    status: {
      type: String,
      enum: [
        'OPEN',
        'LOCKING',
        'LOCKED',
        'AWAITING_VIABILITY_DECISION',
        'CANCELLED',
        'ROLLED_OVER',
      ],
      default: 'OPEN',
      index: true,
    },
    capacityWeightKg: { type: Number, required: true, min: 1 },
    capacityVolumeCbm: { type: Number, required: true, min: 0.1 },
    reservedWeightKg: { type: Number, default: 0, min: 0 },
    reservedVolumeCbm: { type: Number, default: 0, min: 0 },
    shipmentIds: [{ type: Schema.Types.ObjectId, ref: 'Shipment' }],
    anchorShipmentId: { type: Schema.Types.ObjectId, ref: 'Shipment' },
    viabilityStatus: {
      type: String,
      enum: ['PENDING', 'PASSED', 'FAILED'],
      default: 'PENDING',
    },
    viabilityReason: { type: String, trim: true },
    lockedSnapshot: { type: poolLockedSnapshotSchema },
    allocationAudit: {
      type: [
        new Schema(
          {
            vehicleId: { type: Schema.Types.ObjectId, ref: 'Vehicle', required: true },
            driverUserId: { type: Schema.Types.ObjectId, ref: 'User' },
            registrationNumber: { type: String, required: true },
            tier: { type: String, enum: ['TIER_1', 'TIER_2', 'TIER_3'], required: true },
            decision: { type: String, enum: ['ACCEPTED', 'REJECTED'], required: true },
            reason: { type: String, required: true },
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

export const Pool = model<IPool>('Pool', poolSchema);
