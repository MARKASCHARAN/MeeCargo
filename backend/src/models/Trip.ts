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

export interface TripRoutePlan {
  optimizationStatus: 'PENDING' | 'OPTIMAL' | 'INFEASIBLE' | 'OPTIMIZER_UNAVAILABLE';
  provider: 'OR_TOOLS' | 'NONE';
  matrixProvider: 'FIXTURE' | 'OSRM';
  totalDistanceMeters: number;
  estimatedDurationSeconds: number;
  orderedStops: Array<{
    sequence: number;
    stopCode: string;
    name: string;
    arrivalMin: number;
    cumulativeDistanceMeters: number;
    shipmentIds: string[];
  }>;
  failureReason?: string;
  optimizedAt?: Date;
}

export type ZoneColor = 'GREEN' | 'YELLOW' | 'RED' | 'BLUE';

export interface LoadingSequenceItem {
  loadOrder: number;
  shipmentId: string;
  reference: string;
  stopCode: string;
  dropSequence: number;
  zoneColor: ZoneColor;
  zoneLabel: string;
  quantity: number;
  dimensionsCm: { length: number; width: number; height: number };
  weightKg: number;
  stackable: boolean;
  handlingNotes?: string;
  placed: boolean;
  bedRect?: {
    xCm: number;
    yCm: number;
    lengthCm: number;
    widthCm: number;
  };
}

export interface TripLoadingPlan {
  zoneMapping: Array<{
    stopCode: string;
    dropSequence: number;
    zoneColor: ZoneColor;
    zoneLabel: string;
  }>;
  sequenceItems: LoadingSequenceItem[];
  overflowShipmentIds: string[];
  manualOverrides: Array<{
    shipmentId: string;
    note: string;
    actorUserId: Types.ObjectId;
    at: Date;
  }>;
  planningAidDisclaimer: string;
}

export interface TripBackhaulDecision {
  decision: 'MATCHED' | 'EARLY_TURNAROUND' | 'PENDING';
  backhaulRequestId?: Types.ObjectId;
  requestCode?: string;
  repositioningDistanceKm: number;
  repositioningCostPaise: number;
  expectedReturnRevenuePaise: number;
  netContributionPaise: number;
  tier1MinGuaranteeIncludedPaise: number;
  reason: string;
  evaluatedAt: Date;
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
  actualStartedAt?: Date;
  actualCompletedAt?: Date;
  pauseReason?: string;
  locationDisclosureAcceptedAt?: Date;
  lastKnownLocation?: {
    coordinates: [number, number];
    recordedAt: Date;
  };
  stopsSummary: TripStopSummary[];
  allocationEconomics?: TripAllocationEconomics;
  routePlan?: TripRoutePlan;
  loadingPlan?: TripLoadingPlan;
  backhaulDecision?: TripBackhaulDecision;
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
    actualStartedAt: { type: Date },
    actualCompletedAt: { type: Date },
    pauseReason: { type: String, trim: true, maxlength: 300 },
    locationDisclosureAcceptedAt: { type: Date },
    lastKnownLocation: {
      coordinates: { type: [Number] },
      recordedAt: { type: Date },
    },
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
    routePlan: {
      optimizationStatus: {
        type: String,
        enum: ['PENDING', 'OPTIMAL', 'INFEASIBLE', 'OPTIMIZER_UNAVAILABLE'],
      },
      provider: { type: String, enum: ['OR_TOOLS', 'NONE'] },
      matrixProvider: { type: String, enum: ['FIXTURE', 'OSRM'] },
      totalDistanceMeters: { type: Number, default: 0 },
      estimatedDurationSeconds: { type: Number, default: 0 },
      orderedStops: { type: [Schema.Types.Mixed], default: [] },
      failureReason: { type: String },
      optimizedAt: { type: Date },
    },
    loadingPlan: {
      zoneMapping: { type: [Schema.Types.Mixed], default: [] },
      sequenceItems: { type: [Schema.Types.Mixed], default: [] },
      overflowShipmentIds: { type: [String], default: [] },
      manualOverrides: { type: [Schema.Types.Mixed], default: [] },
      planningAidDisclaimer: { type: String },
    },
    backhaulDecision: {
      decision: {
        type: String,
        enum: ['MATCHED', 'EARLY_TURNAROUND', 'PENDING'],
      },
      backhaulRequestId: { type: Schema.Types.ObjectId, ref: 'BackhaulRequest' },
      requestCode: { type: String },
      repositioningDistanceKm: { type: Number, default: 0 },
      repositioningCostPaise: { type: Number, default: 0 },
      expectedReturnRevenuePaise: { type: Number, default: 0 },
      netContributionPaise: { type: Number, default: 0 },
      tier1MinGuaranteeIncludedPaise: { type: Number, default: 0 },
      reason: { type: String },
      evaluatedAt: { type: Date },
    },
    assignmentHistory: { type: [tripAssignmentAuditSchema], default: [] },
    notes: { type: String, trim: true },
  },
  { timestamps: true }
);

tripSchema.index({ driverId: 1, status: 1, plannedDepartureAt: 1 });
tripSchema.index({ vehicleId: 1, status: 1, plannedDepartureAt: 1 });

export const Trip = model<ITrip>('Trip', tripSchema);
