import { Schema, model, type Document, type Types } from 'mongoose';
import { geoPointSchema, type GeoPoint } from './common.js';

export type BackhaulStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'MATCHED'
  | 'REJECTED'
  | 'CANCELLED';

export interface IBackhaulRequest extends Document {
  _id: Types.ObjectId;
  requestCode: string;
  businessId: Types.ObjectId;
  corridorId: Types.ObjectId;
  originStopCode: string;
  destinationStopCode: string;
  originLocation: GeoPoint;
  destinationLocation: GeoPoint;
  earliestPickupAt: Date;
  latestArrivalAt: Date;
  cargo: {
    chargeableWeightKg: number;
    volumeCbm: number;
    unitDimensionsCm: { length: number; width: number; height: number };
    declaredContents: string;
  };
  quotedRevenuePaise: number;
  status: BackhaulStatus;
  matchedTripId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const backhaulRequestSchema = new Schema<IBackhaulRequest>(
  {
    requestCode: { type: String, required: true, unique: true, uppercase: true, trim: true },
    businessId: { type: Schema.Types.ObjectId, ref: 'BusinessProfile', required: true },
    corridorId: { type: Schema.Types.ObjectId, ref: 'Corridor', required: true },
    originStopCode: { type: String, required: true, uppercase: true, trim: true },
    destinationStopCode: { type: String, required: true, uppercase: true, trim: true },
    originLocation: { type: geoPointSchema, required: true },
    destinationLocation: { type: geoPointSchema, required: true },
    earliestPickupAt: { type: Date, required: true },
    latestArrivalAt: { type: Date, required: true },
    cargo: {
      chargeableWeightKg: { type: Number, required: true, min: 1 },
      volumeCbm: { type: Number, required: true, min: 0.01 },
      unitDimensionsCm: {
        length: { type: Number, required: true, min: 1 },
        width: { type: Number, required: true, min: 1 },
        height: { type: Number, required: true, min: 1 },
      },
      declaredContents: { type: String, required: true, trim: true },
    },
    quotedRevenuePaise: { type: Number, required: true, min: 0 },
    status: {
      type: String,
      enum: ['PENDING', 'CONFIRMED', 'MATCHED', 'REJECTED', 'CANCELLED'],
      default: 'PENDING',
      index: true,
    },
    matchedTripId: { type: Schema.Types.ObjectId, ref: 'Trip' },
  },
  { timestamps: true }
);

export const BackhaulRequest = model<IBackhaulRequest>(
  'BackhaulRequest',
  backhaulRequestSchema
);
