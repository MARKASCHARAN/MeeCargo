import { Schema, model, type Document, type Types } from 'mongoose';
import { geoPointSchema, type GeoPoint } from './common.js';

export type FleetTier = 'TIER_1' | 'TIER_2' | 'TIER_3';
export type PayoutModelType = 'MIN_GUARANTEE_PLUS_KM' | 'PER_KM' | 'FIXED_TRIP';
export type VehicleOwnershipType = 'DRIVER_OWNED' | 'MARKETPLACE';
export type VehicleBodyType =
  | 'CLOSED_BODY'
  | 'OPEN_BODY'
  | 'CONTAINER'
  | 'FLATBED'
  | 'MINI_PICKUP';
export type VehicleOperationalStatus =
  | 'ACTIVE'
  | 'INACTIVE'
  | 'MAINTENANCE'
  | 'SUSPENDED';
export type VehicleDocumentVerificationStatus = 'PENDING' | 'VERIFIED' | 'REJECTED';

export interface BedDimensionsCm {
  length: number;
  width: number;
  height: number;
}

export interface VehiclePayoutModel {
  modelType: PayoutModelType;
  minGuaranteePaise: number;
  perKmRatePaise: number;
  fixedTripPaise: number;
}

export interface VehicleDocuments {
  rcNumber?: string;
  insurancePolicyNumber?: string;
  insuranceValidUntil?: Date;
  fitnessValidUntil?: Date;
  permitNotes?: string;
  verificationStatus: VehicleDocumentVerificationStatus;
  verifiedAt?: Date;
}

export interface IVehicle extends Document {
  _id: Types.ObjectId;
  registrationNumber: string;
  operatorName: string;
  driverId?: Types.ObjectId;
  tier: FleetTier;
  ownershipType: VehicleOwnershipType;
  vehicleClass: string;
  bodyType: VehicleBodyType;
  maxWeightKg: number;
  maxVolumeCbm: number;
  bedDimensionsCm: BedDimensionsCm;
  minGuaranteePaise: number;
  perKmRatePaise: number;
  payoutModel: VehiclePayoutModel;
  contractedCorridorIds: Types.ObjectId[];
  contractedSlotLabels: string[];
  unavailableDates: string[];
  blockedSlotIds: Types.ObjectId[];
  operatingRestrictions: string[];
  supportsBackhaul: boolean;
  homeLocation: GeoPoint;
  operationalStatus: VehicleOperationalStatus;
  isAvailable: boolean;
  documents: VehicleDocuments;
  createdAt: Date;
  updatedAt: Date;
}

const vehicleSchema = new Schema<IVehicle>(
  {
    registrationNumber: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },
    operatorName: { type: String, required: true, trim: true },
    driverId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    tier: {
      type: String,
      enum: ['TIER_1', 'TIER_2', 'TIER_3'],
      required: true,
    },
    ownershipType: {
      type: String,
      enum: ['DRIVER_OWNED', 'MARKETPLACE'],
      default: function (this: Partial<IVehicle>) {
        return this.tier === 'TIER_1' ? 'DRIVER_OWNED' : 'MARKETPLACE';
      },
      required: true,
    },
    vehicleClass: { type: String, required: true, trim: true },
    bodyType: {
      type: String,
      enum: ['CLOSED_BODY', 'OPEN_BODY', 'CONTAINER', 'FLATBED', 'MINI_PICKUP'],
      default: 'CLOSED_BODY',
      required: true,
    },
    maxWeightKg: { type: Number, required: true, min: 100 },
    maxVolumeCbm: { type: Number, required: true, min: 0.5 },
    bedDimensionsCm: {
      length: { type: Number, required: true, min: 50 },
      width: { type: Number, required: true, min: 50 },
      height: { type: Number, required: true, min: 50 },
    },
    minGuaranteePaise: { type: Number, default: 0, min: 0 },
    perKmRatePaise: { type: Number, required: true, min: 1 },
    payoutModel: {
      modelType: {
        type: String,
        enum: ['MIN_GUARANTEE_PLUS_KM', 'PER_KM', 'FIXED_TRIP'],
        default: 'PER_KM',
      },
      minGuaranteePaise: { type: Number, default: 0, min: 0 },
      perKmRatePaise: { type: Number, default: 2000, min: 0 },
      fixedTripPaise: { type: Number, default: 0, min: 0 },
    },
    contractedCorridorIds: [{ type: Schema.Types.ObjectId, ref: 'Corridor' }],
    contractedSlotLabels: { type: [String], default: [] },
    unavailableDates: { type: [String], default: [] },
    blockedSlotIds: [{ type: Schema.Types.ObjectId, ref: 'Slot' }],
    operatingRestrictions: { type: [String], default: [] },
    supportsBackhaul: { type: Boolean, default: false },
    homeLocation: { type: geoPointSchema, required: true },
    operationalStatus: {
      type: String,
      enum: ['ACTIVE', 'INACTIVE', 'MAINTENANCE', 'SUSPENDED'],
      default: 'ACTIVE',
      required: true,
    },
    isAvailable: { type: Boolean, default: true },
    documents: {
      rcNumber: { type: String, trim: true, uppercase: true, maxlength: 40 },
      insurancePolicyNumber: { type: String, trim: true, uppercase: true, maxlength: 60 },
      insuranceValidUntil: { type: Date },
      fitnessValidUntil: { type: Date },
      permitNotes: { type: String, trim: true, maxlength: 200 },
      verificationStatus: {
        type: String,
        enum: ['PENDING', 'VERIFIED', 'REJECTED'],
        default: 'PENDING',
      },
      verifiedAt: { type: Date },
    },
  },
  { timestamps: true }
);

vehicleSchema.pre('validate', function () {
  if (this.tier === 'TIER_1') {
    this.ownershipType = 'DRIVER_OWNED';
  }
  this.isAvailable = this.operationalStatus === 'ACTIVE';
});

vehicleSchema.index({ homeLocation: '2dsphere' });
vehicleSchema.index({ tier: 1, isAvailable: 1, operationalStatus: 1 });
vehicleSchema.index({ contractedCorridorIds: 1, tier: 1 });

export const Vehicle = model<IVehicle>('Vehicle', vehicleSchema);
