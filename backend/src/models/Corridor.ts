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

export interface CorridorSlotSchedule {
  slotNumber: 1 | 2;
  slotCodeSuffix: string;
  label: string;
  outboundPickupTime: string; // HH:mm (24-hour, e.g. '09:00', '12:30')
  returnTimeOptions: string[]; // Slot 1: ['14:00', '16:30']; Slot 2: ['16:30']
  defaultReturnTime: string;
  returnTimeLocked: boolean; // False for Slot 1, strictly TRUE for Slot 2
  lockedReturnTime?: string; // Mandatory locked return time for Slot 2 (e.g. '16:30')
}

export const DEFAULT_CORRIDOR_SLOT_SCHEDULES: CorridorSlotSchedule[] = [
  {
    slotNumber: 1,
    slotCodeSuffix: 'SLOT1',
    label: 'Pickup Slot 1 (09:00 Outbound)',
    outboundPickupTime: '09:00',
    returnTimeOptions: ['14:00', '16:30'],
    defaultReturnTime: '14:00',
    returnTimeLocked: false,
  },
  {
    slotNumber: 2,
    slotCodeSuffix: 'SLOT2',
    label: 'Pickup Slot 2 (12:30 Outbound • Mandatory 16:30 Return)',
    outboundPickupTime: '12:30',
    returnTimeOptions: ['16:30'],
    defaultReturnTime: '16:30',
    returnTimeLocked: true,
    lockedReturnTime: '16:30',
  },
];

export function validateCorridorSlotSchedules(
  schedules: CorridorSlotSchedule[]
): string | null {
  if (!Array.isArray(schedules) || schedules.length !== 2) {
    return 'Each corridor must configure exactly 2 coupled outbound pickup slots (Slot 1 and Slot 2).';
  }
  const s1 = schedules.find((s) => s.slotNumber === 1);
  const s2 = schedules.find((s) => s.slotNumber === 2);
  if (!s1 || !s2) {
    return 'Corridor schedules must contain slotNumber 1 and slotNumber 2.';
  }
  const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
  for (const s of [s1, s2]) {
    if (!timeRegex.test(s.outboundPickupTime)) {
      return `Invalid outboundPickupTime '${s.outboundPickupTime}'. Expected 24-hour HH:mm.`;
    }
    if (!Array.isArray(s.returnTimeOptions) || s.returnTimeOptions.length === 0) {
      return `Slot ${s.slotNumber} must define at least one return time option.`;
    }
    const seenReturns = new Set<string>();
    for (const rt of s.returnTimeOptions) {
      if (!timeRegex.test(rt)) {
        return `Invalid returnTimeOption '${rt}'. Expected 24-hour HH:mm.`;
      }
      if (seenReturns.has(rt)) {
        return `Duplicate returnTimeOption '${rt}' is not allowed on Slot ${s.slotNumber}.`;
      }
      seenReturns.add(rt);
    }
    if (!timeRegex.test(s.defaultReturnTime) || !s.returnTimeOptions.includes(s.defaultReturnTime)) {
      return `Slot ${s.slotNumber} defaultReturnTime must be present in returnTimeOptions.`;
    }
  }
  if (s1.returnTimeLocked) {
    return 'Slot 1 must remain flexible (returnTimeLocked must be false).';
  }
  if (!s2.returnTimeLocked || !s2.lockedReturnTime || !timeRegex.test(s2.lockedReturnTime)) {
    return 'Slot 2 return schedule must be mandatory and locked with a valid 24-hour lockedReturnTime.';
  }
  if (
    s2.returnTimeOptions.length !== 1 ||
    s2.returnTimeOptions[0] !== s2.lockedReturnTime ||
    s2.defaultReturnTime !== s2.lockedReturnTime
  ) {
    return 'Slot 2 returnTimeOptions and defaultReturnTime must stay strictly locked to lockedReturnTime.';
  }
  return null;
}

export interface ICorridor extends Document {
  _id: Types.ObjectId;
  code: string;
  name: string;
  description?: string;
  stops: CorridorStop[];
  operatingDays: Weekday[];
  slotSchedules: CorridorSlotSchedule[];
  estimatedOutboundDurationMin: number;
  turnaroundBufferMin: number;
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

const corridorSlotScheduleSchema = new Schema<CorridorSlotSchedule>(
  {
    slotNumber: { type: Number, enum: [1, 2], required: true },
    slotCodeSuffix: { type: String, required: true, trim: true, uppercase: true },
    label: { type: String, required: true, trim: true },
    outboundPickupTime: { type: String, required: true, trim: true },
    returnTimeOptions: { type: [String], required: true },
    defaultReturnTime: { type: String, required: true, trim: true },
    returnTimeLocked: { type: Boolean, default: false, required: true },
    lockedReturnTime: { type: String, trim: true },
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
    slotSchedules: {
      type: [corridorSlotScheduleSchema],
      default: () => DEFAULT_CORRIDOR_SLOT_SCHEDULES,
      required: true,
    },
    estimatedOutboundDurationMin: { type: Number, default: 120, min: 30, max: 720 },
    turnaroundBufferMin: { type: Number, default: 30, min: 0, max: 240 },
    isEstablishedRoute: { type: Boolean, default: true },
    guaranteedCeilingPaisePerKg: { type: Number, required: true, min: 1 },
    baseRatePaisePerKg: { type: Number, required: true, min: 1 },
    viabilityThresholdPct: { type: Number, default: 50, min: 0, max: 100 },
    isDemoData: { type: Boolean, default: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

corridorSchema.pre('validate', function () {
  if (!this.slotSchedules || this.slotSchedules.length === 0) {
    this.slotSchedules = DEFAULT_CORRIDOR_SLOT_SCHEDULES;
  }
  const err = validateCorridorSlotSchedules(this.slotSchedules);
  if (err) {
    this.invalidate('slotSchedules', err);
  }
});

corridorSchema.index({ 'stops.location': '2dsphere' });
corridorSchema.index({ isActive: 1 });

export const Corridor = model<ICorridor>('Corridor', corridorSchema);
