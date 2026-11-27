import { Schema, model, type Document, type Types } from 'mongoose';
import { geoPointSchema, type GeoPoint } from './common.js';

export type DeliveryConfirmationMode = 'OTP' | 'B2B_WAREHOUSE_SIGN_OFF';

export interface IDeliveryProof extends Document {
  _id: Types.ObjectId;
  shipmentId: Types.ObjectId;
  tripId: Types.ObjectId;
  confirmationMode: DeliveryConfirmationMode;
  otpHash?: string;
  otpExpiresAt?: Date;
  attemptCount: number;
  maxAttempts: number;
  b2bSignOffName?: string;
  b2bSignOffNote?: string;
  photoStorageKey?: string;
  photoMimeType?: string;
  photoAccessToken?: string;
  verifiedAt?: Date;
  verifiedByUserId?: Types.ObjectId;
  location?: GeoPoint;
  createdAt: Date;
  updatedAt: Date;
}

const deliveryProofSchema = new Schema<IDeliveryProof>(
  {
    shipmentId: { type: Schema.Types.ObjectId, ref: 'Shipment', required: true, unique: true },
    tripId: { type: Schema.Types.ObjectId, ref: 'Trip', required: true, index: true },
    confirmationMode: {
      type: String,
      enum: ['OTP', 'B2B_WAREHOUSE_SIGN_OFF'],
      default: 'OTP',
    },
    otpHash: { type: String, select: false },
    otpExpiresAt: { type: Date },
    attemptCount: { type: Number, default: 0, min: 0 },
    maxAttempts: { type: Number, default: 5, min: 1 },
    b2bSignOffName: { type: String, trim: true, maxlength: 120 },
    b2bSignOffNote: { type: String, trim: true, maxlength: 300 },
    photoStorageKey: { type: String, trim: true },
    photoMimeType: { type: String, trim: true },
    photoAccessToken: { type: String, unique: true, sparse: true },
    verifiedAt: { type: Date },
    verifiedByUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    location: { type: geoPointSchema },
  },
  { timestamps: true }
);

export const DeliveryProof = model<IDeliveryProof>(
  'DeliveryProof',
  deliveryProofSchema
);
