import { Schema, model, type Document, type Types } from 'mongoose';

export type SlotStatus = 'OPEN' | 'LOCKING' | 'LOCKED' | 'COMPLETED' | 'CANCELLED';

export interface SlotScheduleSnapshot {
  outboundPickupTime: string;
  returnTimeOptions: string[];
  defaultReturnTime: string;
  returnTimeLocked: boolean;
  lockedReturnTime?: string;
}

export interface ISlot extends Document {
  _id: Types.ObjectId;
  corridorId: Types.ObjectId;
  slotNumber?: 1 | 2;
  slotCode: string;
  label: string;
  departureDate: Date;
  cutoffAt: Date;
  plannedDepartureAt: Date;
  estimatedArrivalStartAt: Date;
  estimatedArrivalEndAt: Date;
  returnTimeOptions?: string[];
  returnTimeLocked?: boolean;
  lockedReturnTime?: string;
  scheduleSnapshot?: SlotScheduleSnapshot;
  capacityWeightKg: number;
  capacityVolumeCbm: number;
  reservedWeightKg: number;
  reservedVolumeCbm: number;
  status: SlotStatus;
  createdAt: Date;
  updatedAt: Date;
}

const slotSchema = new Schema<ISlot>(
  {
    corridorId: { type: Schema.Types.ObjectId, ref: 'Corridor', required: true },
    slotNumber: { type: Number, enum: [1, 2] },
    slotCode: { type: String, required: true, unique: true, uppercase: true, trim: true },
    label: { type: String, required: true, trim: true },
    departureDate: { type: Date, required: true },
    cutoffAt: { type: Date, required: true },
    plannedDepartureAt: { type: Date, required: true },
    estimatedArrivalStartAt: { type: Date, required: true },
    estimatedArrivalEndAt: { type: Date, required: true },
    returnTimeOptions: { type: [String], default: undefined },
    returnTimeLocked: { type: Boolean, default: false },
    lockedReturnTime: { type: String, trim: true },
    scheduleSnapshot: {
      type: {
        outboundPickupTime: { type: String, required: true },
        returnTimeOptions: { type: [String], required: true },
        defaultReturnTime: { type: String, required: true },
        returnTimeLocked: { type: Boolean, required: true },
        lockedReturnTime: { type: String },
      },
      _id: false,
      default: undefined,
    },
    capacityWeightKg: { type: Number, required: true, min: 1 },
    capacityVolumeCbm: { type: Number, required: true, min: 0.1 },
    reservedWeightKg: { type: Number, default: 0, min: 0 },
    reservedVolumeCbm: { type: Number, default: 0, min: 0 },
    status: {
      type: String,
      enum: ['OPEN', 'LOCKING', 'LOCKED', 'COMPLETED', 'CANCELLED'],
      default: 'OPEN',
    },
  },
  { timestamps: true }
);

slotSchema.index({ corridorId: 1, departureDate: 1, status: 1 });
slotSchema.index({ cutoffAt: 1, status: 1 });

export const Slot = model<ISlot>('Slot', slotSchema);
