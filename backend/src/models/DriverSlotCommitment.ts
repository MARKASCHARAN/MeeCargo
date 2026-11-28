import mongoose, { Document, Schema, Types } from 'mongoose';

export type DriverSlotCommitmentStatus =
  | 'COMMITTED'
  | 'LOCKED'
  | 'WITHDRAWN'
  | 'ALLOCATED'
  | 'NOT_ALLOCATED'
  | 'ROLLED_OVER'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'INVALIDATED';

export interface DriverCommitmentAuditEntry {
  action:
    | 'SUBMITTED'
    | 'UPDATED'
    | 'WITHDRAWN'
    | 'LOCKED'
    | 'ALLOCATED'
    | 'NOT_ALLOCATED'
    | 'ROLLED_OVER'
    | 'CANCELLED'
    | 'INVALIDATED';
  status: DriverSlotCommitmentStatus;
  actorUserId?: Types.ObjectId;
  at: Date;
  note?: string;
}

export interface IDriverSlotCommitment extends Document {
  corridorId: Types.ObjectId;
  slotId: Types.ObjectId;
  poolId?: Types.ObjectId;
  driverUserId: Types.ObjectId;
  driverProfileId: Types.ObjectId;
  vehicleId: Types.ObjectId;
  slotNumber: 1 | 2;
  departureDate: Date;
  selectedPickupTime: string;
  selectedReturnTime: string;
  status: DriverSlotCommitmentStatus;
  invalidationReason?: string;
  auditHistory?: DriverCommitmentAuditEntry[];
  committedAt: Date;
  lockedAt?: Date;
  withdrawnAt?: Date;
  allocatedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const driverSlotCommitmentSchema = new Schema<IDriverSlotCommitment>(
  {
    corridorId: {
      type: Schema.Types.ObjectId,
      ref: 'Corridor',
      required: true,
      index: true,
    },
    slotId: {
      type: Schema.Types.ObjectId,
      ref: 'Slot',
      required: true,
      index: true,
    },
    poolId: {
      type: Schema.Types.ObjectId,
      ref: 'Pool',
    },
    driverUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    driverProfileId: {
      type: Schema.Types.ObjectId,
      ref: 'DriverProfile',
      required: true,
    },
    vehicleId: {
      type: Schema.Types.ObjectId,
      ref: 'Vehicle',
      required: true,
    },
    slotNumber: {
      type: Number,
      enum: [1, 2],
      required: true,
    },
    departureDate: {
      type: Date,
      required: true,
      index: true,
    },
    selectedPickupTime: {
      type: String,
      required: true,
      trim: true,
    },
    selectedReturnTime: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: [
        'COMMITTED',
        'LOCKED',
        'WITHDRAWN',
        'ALLOCATED',
        'NOT_ALLOCATED',
        'ROLLED_OVER',
        'CANCELLED',
        'EXPIRED',
        'INVALIDATED',
      ],
      default: 'COMMITTED',
      required: true,
      index: true,
    },
    invalidationReason: {
      type: String,
      trim: true,
    },
    auditHistory: {
      type: [
        new Schema(
          {
            action: { type: String, required: true },
            status: { type: String, required: true },
            actorUserId: { type: Schema.Types.ObjectId, ref: 'User' },
            at: { type: Date, required: true, default: Date.now },
            note: { type: String, trim: true },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
    committedAt: {
      type: Date,
      default: Date.now,
      required: true,
    },
    lockedAt: {
      type: Date,
    },
    withdrawnAt: {
      type: Date,
    },
    allocatedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

driverSlotCommitmentSchema.index({ slotId: 1, driverUserId: 1 }, { unique: true });
driverSlotCommitmentSchema.index({ driverUserId: 1, departureDate: 1, status: 1 });
driverSlotCommitmentSchema.index({ slotId: 1, status: 1 });

export const DriverSlotCommitment = mongoose.model<IDriverSlotCommitment>(
  'DriverSlotCommitment',
  driverSlotCommitmentSchema
);
