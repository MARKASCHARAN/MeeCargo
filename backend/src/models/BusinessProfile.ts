import { Schema, model, type Document, type Types } from 'mongoose';
import { geoPointSchema, type GeoPoint } from './common.js';

export type BusinessType =
  | 'MANUFACTURER'
  | 'WHOLESALER'
  | 'TEXTILE_MILL'
  | 'AGRO_PROCESSOR'
  | 'RETAILER'
  | 'OTHER';

export interface StructuredAddress {
  addressLine: string;
  villageOrTown: string;
  district: string;
  state: string;
  pincode: string;
  landmark?: string;
  location: GeoPoint;
}

export interface ServiceLocation {
  label: string;
  villageOrTown: string;
  district: string;
  state: string;
  pincode?: string;
  location?: GeoPoint;
}

export interface IBusinessProfile extends Document {
  _id: Types.ObjectId;
  businessName: string;
  businessType: BusinessType;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  gstin?: string;
  pickupAddress: StructuredAddress;
  serviceLocations: ServiceLocation[];
  ownerId: Types.ObjectId;
  memberUserIds: Types.ObjectId[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const structuredAddressSchema = new Schema<StructuredAddress>(
  {
    addressLine: { type: String, required: true, trim: true, maxlength: 250 },
    villageOrTown: { type: String, required: true, trim: true, maxlength: 100 },
    district: { type: String, required: true, trim: true, maxlength: 100 },
    state: { type: String, required: true, trim: true, default: 'Gujarat', maxlength: 80 },
    pincode: {
      type: String,
      required: true,
      trim: true,
      match: [/^\d{6}$/, 'PIN code must be 6 digits'],
    },
    landmark: { type: String, trim: true, maxlength: 150 },
    location: { type: geoPointSchema, required: true },
  },
  { _id: false }
);

const serviceLocationSchema = new Schema<ServiceLocation>(
  {
    label: { type: String, required: true, trim: true, maxlength: 100 },
    villageOrTown: { type: String, required: true, trim: true, maxlength: 100 },
    district: { type: String, required: true, trim: true, maxlength: 100 },
    state: { type: String, required: true, trim: true, default: 'Gujarat', maxlength: 80 },
    pincode: {
      type: String,
      trim: true,
      match: [/^\d{6}$/, 'PIN code must be 6 digits'],
    },
    location: { type: geoPointSchema },
  },
  { _id: false }
);

const businessProfileSchema = new Schema<IBusinessProfile>(
  {
    businessName: { type: String, required: true, trim: true, maxlength: 160 },
    businessType: {
      type: String,
      enum: [
        'MANUFACTURER',
        'WHOLESALER',
        'TEXTILE_MILL',
        'AGRO_PROCESSOR',
        'RETAILER',
        'OTHER',
      ],
      default: 'OTHER',
    },
    contactName: { type: String, required: true, trim: true, maxlength: 120 },
    contactPhone: { type: String, required: true, trim: true, maxlength: 20 },
    contactEmail: { type: String, required: true, lowercase: true, trim: true },
    gstin: {
      type: String,
      trim: true,
      uppercase: true,
      match: [
        /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/,
        'Invalid GSTIN format',
      ],
    },
    pickupAddress: { type: structuredAddressSchema, required: true },
    serviceLocations: { type: [serviceLocationSchema], default: [] },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    memberUserIds: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

businessProfileSchema.index({ 'pickupAddress.location': '2dsphere' });
businessProfileSchema.index({ memberUserIds: 1 });

export const BusinessProfile = model<IBusinessProfile>(
  'BusinessProfile',
  businessProfileSchema
);
