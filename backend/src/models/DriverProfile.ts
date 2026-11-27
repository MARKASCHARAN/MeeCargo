import { Schema, model, type Document, type Types } from 'mongoose';
import type { FleetTier } from './Vehicle.js';

export type DriverAvailability = 'AVAILABLE' | 'ON_TRIP' | 'OFFLINE';

export interface IDriverProfile extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  name: string;
  phone: string;
  availabilityStatus: DriverAvailability;
  fleetTier: FleetTier;
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
    fleetTier: {
      type: String,
      enum: ['TIER_1', 'TIER_2', 'TIER_3'],
      default: 'TIER_1',
      required: true,
    },
    vehicleId: { type: Schema.Types.ObjectId, ref: 'Vehicle' },
    licenseNumber: { type: String, trim: true, uppercase: true, maxlength: 40 },
    homeBase: { type: String, trim: true, maxlength: 120 },
  },
  { timestamps: true }
);

driverProfileSchema.index({ availabilityStatus: 1, fleetTier: 1 });

export const DriverProfile = model<IDriverProfile>('DriverProfile', driverProfileSchema);
