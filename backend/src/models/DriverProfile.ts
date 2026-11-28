import { Schema, model, type Document, type Types } from 'mongoose';
import type { Tier2ApplicationStatus } from './Tier2Application.js';
import type { FleetTier } from './Vehicle.js';

export type DriverAvailability = 'AVAILABLE' | 'ON_TRIP' | 'OFFLINE';
export type DriverAccountStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';

export interface IDriverProfile extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  name: string;
  phone: string;
  availabilityStatus: DriverAvailability;
  accountStatus: DriverAccountStatus;
  fleetTier: FleetTier;
  tier2ApplicationStatus?: Tier2ApplicationStatus;
  tier2ApplicationId?: Types.ObjectId;
  platformOwnerId?: Types.ObjectId;
  vehicleId?: Types.ObjectId;
  licenseNumber?: string;
  homeBase?: string;
  createdAt: Date;
  updatedAt: Date;
}

const driverProfileSchema = new Schema<IDriverProfile>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    phone: { type: String, required: true, trim: true, maxlength: 20 },
    availabilityStatus: {
      type: String,
      enum: ['AVAILABLE', 'ON_TRIP', 'OFFLINE'],
      default: 'AVAILABLE',
    },
    accountStatus: {
      type: String,
      enum: ['ACTIVE', 'INACTIVE', 'SUSPENDED'],
      default: 'ACTIVE',
      required: true,
    },
    fleetTier: {
      type: String,
      enum: ['TIER_1', 'TIER_2', 'TIER_3'],
      default: 'TIER_2',
      required: true,
    },
    tier2ApplicationStatus: {
      type: String,
      enum: ['PENDING', 'APPROVED', 'REJECTED'],
      default: undefined,
    },
    tier2ApplicationId: {
      type: Schema.Types.ObjectId,
      ref: 'Tier2Application',
    },
    platformOwnerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },
    vehicleId: { type: Schema.Types.ObjectId, ref: 'Vehicle' },
    licenseNumber: { type: String, trim: true, uppercase: true, maxlength: 40 },
    homeBase: { type: String, trim: true, maxlength: 120 },
  },
  { timestamps: true }
);

driverProfileSchema.pre('validate', function () {
  if (this.fleetTier === 'TIER_1' && !this.platformOwnerId) {
    this.invalidate(
      'platformOwnerId',
      'Tier 1 contract drivers must have a valid platformOwnerId.'
    );
  }
  if (this.fleetTier === 'TIER_2') {
    // Tier 2 marketplace drivers remain independent; never assign Platform Owner ownership
    this.platformOwnerId = undefined;
    if (!this.tier2ApplicationStatus) {
      this.tier2ApplicationStatus = 'PENDING';
    }
  }
});

driverProfileSchema.index({ availabilityStatus: 1, fleetTier: 1, accountStatus: 1 });
driverProfileSchema.index({ platformOwnerId: 1, fleetTier: 1 });

export const DriverProfile = model<IDriverProfile>('DriverProfile', driverProfileSchema);
