import { Schema, model, type Document, type Types } from 'mongoose';
import { geoPointSchema, type GeoPoint } from './common.js';

export interface CorridorStop {
  stopCode: string;
  name: string;
  district: string;
  state: string;
  sequenceOrder: number;
  location: GeoPoint;
}

export type Weekday = 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN';

export interface ICorridor extends Document {
  _id: Types.ObjectId;
  code: string;
  name: string;
  description?: string;
  stops: CorridorStop[];
  operatingDays: Weekday[];
  isEstablishedRoute: boolean;
  guaranteedCeilingPaisePerKg: number;
  baseRatePaisePerKg: number;
  viabilityThresholdPct: number;
  isDemoData: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const corridorStopSchema = new Schema<CorridorStop>(
  {
    stopCode: { type: String, required: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    district: { type: String, required: true, trim: true },
    state: { type: String, required: true, trim: true, default: 'Gujarat' },
    sequenceOrder: { type: Number, required: true, min: 0 },
    location: { type: geoPointSchema, required: true },
  },
  { _id: false }
);

const corridorSchema = new Schema<ICorridor>(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    stops: {
      type: [corridorStopSchema],
      required: true,
      validate: {
        validator: (stops: CorridorStop[]) => Array.isArray(stops) && stops.length >= 2,
        message: 'A corridor must define at least 2 ordered stops.',
      },
    },
    operatingDays: {
      type: [String],
      enum: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'],
      required: true,
    },
    isEstablishedRoute: { type: Boolean, default: true },
    guaranteedCeilingPaisePerKg: { type: Number, required: true, min: 1 },
    baseRatePaisePerKg: { type: Number, required: true, min: 1 },
    viabilityThresholdPct: { type: Number, default: 50, min: 0, max: 100 },
    isDemoData: { type: Boolean, default: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

corridorSchema.index({ 'stops.location': '2dsphere' });
corridorSchema.index({ isActive: 1 });

export const Corridor = model<ICorridor>('Corridor', corridorSchema);
