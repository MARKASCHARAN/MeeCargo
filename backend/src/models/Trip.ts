import { Schema, model, type Document, type Types } from 'mongoose';
import type { FleetTier } from './Vehicle.js';

export type TripStatus =
  | 'ASSIGNED'
  | 'DRIVER_ACCEPTED'
  | 'DRIVER_REJECTED'
  | 'REASSIGNING'
  | 'IN_PROGRESS'
  | 'PAUSED'
  | 'COMPLETED'
  | 'CANCELLED';

export interface TripStopSummary {
  stopCode: string;
  name: string;
  sequenceOrder: number;
}

export interface TripAssignmentAudit {
  driverId?: Types.ObjectId;
  vehicleId: Types.ObjectId;
  action: 'ASSIGNED' | 'ACCEPTED' | 'DECLINED' | 'REASSIGNED' | 'FAILED_NO_DRIVER';
  reason?: string;
  actorUserId?: Types.ObjectId;
  at: Date;
}

export interface TripAllocationEconomics {
  allocatedTier: FleetTier;
  tier1MinGuaranteeIncludedPaise: number;
  selectedVehicleMinGuaranteePaise: number;
  estimatedDistanceKm: number;
  estimatedVehiclePayoutPaise: number;
  rightSized: boolean;
  reason: string;
}

export interface ITrip extends Document {
  _id: Types.ObjectId;
  tripCode: string;
  poolId?: Types.ObjectId;
  corridorId: Types.ObjectId;
  slotId: Types.ObjectId;
  vehicleId: Types.ObjectId;
  driverId: Types.ObjectId;
  shipmentIds: Types.ObjectId[];
  status: TripStatus;
  plannedDepartureAt: Date;
  estimatedEndAt: Date;
  stopsSummary: TripStopSummary[];
  allocationEconomics?: TripAllocationEconomics;
  assignmentHistory: TripAssignmentAudit[];
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const tripStopSummarySchema = new Schema<TripStopSummary>(
  {
    stopCode: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    sequenceOrder: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const tripAssignmentAuditSchema = new Schema<TripAssignmentAudit>(
  {
    driverId: { type: Schema.Types.ObjectId, ref: 'User' },
    vehicleId: { type: Schema.Types.ObjectId, ref: 'Vehicle', required: true },
    action: {
      type: String,
      enum: ['ASSIGNED', 'ACCEPTED', 'DECLINED', 'REASSIGNED', 'FAILED_NO_DRIVER'],
      required: true,
    },
    reason: { type: String, trim: true },
    actorUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    at: { type: Date, required: true, default: Date.now },
  },
  { _id: false }
);

const tripSchema = new Schema<ITrip>(
  {
    tripCode: { type: String, required: true, unique: true, uppercase: true, trim: true },
    poolId: { type: Schema.Types.ObjectId, ref: 'Pool', unique: true, sparse: true },
    corridorId: { type: Schema.Types.ObjectId, ref: 'Corridor', required: true },
    slotId: { type: Schema.Types.ObjectId, ref: 'Slot', required: true },
    vehicleId: { type: Schema.Types.ObjectId, ref: 'Vehicle', required: true },
    driverId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    shipmentIds: [{ type: Schema.Types.ObjectId, ref: 'Shipment' }],
    status: {
      type: String,
      enum: [
        'ASSIGNED',
        'DRIVER_ACCEPTED',
        'DRIVER_REJECTED',
        'REASSIGNING',
        'IN_PROGRESS',
        'PAUSED',
        'COMPLETED',
        'CANCELLED',
      ],
      default: 'ASSIGNED',
    },
    plannedDepartureAt: { type: Date, required: true },
    estimatedEndAt: { type: Date, required: true },
    stopsSummary: { type: [tripStopSummarySchema], default: [] },
    allocationEconomics: {
      allocatedTier: { type: String, enum: ['TIER_1', 'TIER_2', 'TIER_3'] },
      tier1MinGuaranteeIncludedPaise: { type: Number, default: 0 },
      selectedVehicleMinGuaranteePaise: { type: Number, default: 0 },
      estimatedDistanceKm: { type: Number, default: 0 },
      estimatedVehiclePayoutPaise: { type: Number, default: 0 },
      rightSized: { type: Boolean, default: false },
      reason: { type: String },
    },
    assignmentHistory: { type: [tripAssignmentAuditSchema], default: [] },
    notes: { type: String, trim: true },
  },
  { timestamps: true }
);

tripSchema.index({ driverId: 1, status: 1, plannedDepartureAt: 1 });
tripSchema.index({ vehicleId: 1, status: 1, plannedDepartureAt: 1 });

export const Trip = model<ITrip>('Trip', tripSchema);
