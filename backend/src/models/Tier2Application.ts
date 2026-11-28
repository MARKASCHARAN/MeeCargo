import { Schema, model, type Document, type Types } from 'mongoose';
import type { VehicleBodyType, VehicleDocumentVerificationStatus } from './Vehicle.js';

export type Tier2ApplicationStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export type IdProofType = 'AADHAAR' | 'PAN' | 'PASSPORT' | 'VOTER_ID';
export type Tier2DocumentType =
  | 'DRIVING_LICENSE'
  | 'IDENTITY_PROOF'
  | 'VEHICLE_RC'
  | 'INSURANCE_POLICY';

export interface Tier2UploadedDocument {
  docType: Tier2DocumentType;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  uploadedAt: Date;
}

export interface Tier2DecisionHistoryEntry {
  action: 'SUBMITTED' | 'RESUBMITTED' | 'APPROVED' | 'REJECTED';
  status: Tier2ApplicationStatus;
  actorUserId: Types.ObjectId;
  at: Date;
  note?: string;
}

export interface ITier2Application extends Document {
  _id: Types.ObjectId;
  applicationRef: string;
  userId: Types.ObjectId;
  driverProfileId?: Types.ObjectId;
  vehicleId?: Types.ObjectId;
  fullName: string;
  email: string;
  phone: string;
  address: {
    addressLine: string;
    cityOrTown: string;
    district: string;
    state: string;
    pincode: string;
  };
  identity: {
    licenseNumber: string;
    idProofType: IdProofType;
    idProofNumber: string;
  };
  vehicle: {
    registrationNumber: string;
    vehicleCategory: string;
    bodyType: VehicleBodyType;
    maxWeightKg: number;
    bedLengthCm: number;
    bedWidthCm: number;
    bedHeightCm: number;
    maxVolumeCbm: number;
    perKmRatePaise: number;
  };
  documents: {
    rcNumber: string;
    insurancePolicyNumber: string;
    insuranceValidUntil?: Date;
    fitnessValidUntil?: Date;
    permitNotes?: string;
    verificationStatus: VehicleDocumentVerificationStatus;
    verifiedAt?: Date;
  };
  status: Tier2ApplicationStatus;
  appliedAt: Date;
  reviewedByUserId?: Types.ObjectId;
  reviewedAt?: Date;
  approvedAt?: Date;
  rejectedAt?: Date;
  rejectionReason?: string;
  reviewNote?: string;
  resubmissionCount: number;
  uploadedDocuments: Tier2UploadedDocument[];
  decisionHistory: Tier2DecisionHistoryEntry[];
  createdAt: Date;
  updatedAt: Date;
}

const tier2UploadedDocumentSchema = new Schema<Tier2UploadedDocument>(
  {
    docType: {
      type: String,
      enum: ['DRIVING_LICENSE', 'IDENTITY_PROOF', 'VEHICLE_RC', 'INSURANCE_POLICY'],
      required: true,
    },
    originalName: { type: String, required: true, trim: true, maxlength: 140 },
    mimeType: { type: String, required: true, trim: true, maxlength: 80 },
    sizeBytes: { type: Number, required: true, min: 1 },
    storageKey: { type: String, required: true, trim: true, maxlength: 120 },
    uploadedAt: { type: Date, required: true, default: Date.now },
  },
  { _id: false }
);

const tier2DecisionHistorySchema = new Schema<Tier2DecisionHistoryEntry>(
  {
    action: {
      type: String,
      enum: ['SUBMITTED', 'RESUBMITTED', 'APPROVED', 'REJECTED'],
      required: true,
    },
    status: {
      type: String,
      enum: ['PENDING', 'APPROVED', 'REJECTED'],
      required: true,
    },
    actorUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    at: { type: Date, required: true, default: Date.now },
    note: { type: String, trim: true, maxlength: 400 },
  },
  { _id: false }
);

const tier2ApplicationSchema = new Schema<ITier2Application>(
  {
    applicationRef: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    driverProfileId: { type: Schema.Types.ObjectId, ref: 'DriverProfile' },
    vehicleId: { type: Schema.Types.ObjectId, ref: 'Vehicle' },
    fullName: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, trim: true, lowercase: true },
    phone: { type: String, required: true, trim: true, maxlength: 20 },
    address: {
      addressLine: { type: String, required: true, trim: true, maxlength: 250 },
      cityOrTown: { type: String, required: true, trim: true, maxlength: 100 },
      district: { type: String, required: true, trim: true, maxlength: 100 },
      state: { type: String, required: true, trim: true, maxlength: 80 },
      pincode: { type: String, required: true, trim: true, match: /^\d{6}$/ },
    },
    identity: {
      licenseNumber: { type: String, required: true, trim: true, uppercase: true, maxlength: 40 },
      idProofType: {
        type: String,
        enum: ['AADHAAR', 'PAN', 'PASSPORT', 'VOTER_ID'],
        required: true,
      },
      idProofNumber: { type: String, required: true, trim: true, uppercase: true, maxlength: 40 },
    },
    vehicle: {
      registrationNumber: { type: String, required: true, trim: true, uppercase: true, maxlength: 30 },
      vehicleCategory: { type: String, required: true, trim: true, maxlength: 80 },
      bodyType: {
        type: String,
        enum: ['CLOSED_BODY', 'OPEN_BODY', 'CONTAINER', 'FLATBED', 'MINI_PICKUP'],
        required: true,
      },
      maxWeightKg: { type: Number, required: true, min: 100 },
      bedLengthCm: { type: Number, required: true, min: 50 },
      bedWidthCm: { type: Number, required: true, min: 50 },
      bedHeightCm: { type: Number, required: true, min: 50 },
      maxVolumeCbm: { type: Number, required: true, min: 0.5 },
      perKmRatePaise: { type: Number, required: true, min: 100, default: 1900 },
    },
    documents: {
      rcNumber: { type: String, required: true, trim: true, uppercase: true, maxlength: 40 },
      insurancePolicyNumber: { type: String, required: true, trim: true, uppercase: true, maxlength: 60 },
      insuranceValidUntil: { type: Date },
      fitnessValidUntil: { type: Date },
      permitNotes: { type: String, trim: true, maxlength: 200 },
      verificationStatus: {
        type: String,
        enum: ['PENDING', 'VERIFIED', 'REJECTED'],
        default: 'PENDING',
        required: true,
      },
      verifiedAt: { type: Date },
    },
    status: {
      type: String,
      enum: ['PENDING', 'APPROVED', 'REJECTED'],
      default: 'PENDING',
      required: true,
      index: true,
    },
    appliedAt: { type: Date, required: true, default: Date.now },
    reviewedByUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
    approvedAt: { type: Date },
    rejectedAt: { type: Date },
    rejectionReason: { type: String, trim: true, maxlength: 400 },
    reviewNote: { type: String, trim: true, maxlength: 400 },
    resubmissionCount: { type: Number, default: 0, min: 0 },
    uploadedDocuments: { type: [tier2UploadedDocumentSchema], default: [] },
    decisionHistory: { type: [tier2DecisionHistorySchema], default: [] },
  },
  { timestamps: true }
);

tier2ApplicationSchema.index({ status: 1, appliedAt: -1 });
tier2ApplicationSchema.index({ 'vehicle.registrationNumber': 1 });

export const Tier2Application = model<ITier2Application>(
  'Tier2Application',
  tier2ApplicationSchema
);
