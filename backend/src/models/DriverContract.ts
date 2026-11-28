import { Schema, model, type Document, type Types } from 'mongoose';

export type DriverContractStatus =
  | 'DRAFT'
  | 'ACTIVE'
  | 'SUSPENDED'
  | 'INACTIVE'
  | 'EXPIRED'
  | 'TERMINATED';

export interface MinimumGuaranteeTerms {
  minGuaranteePaise: number;
  perKmRatePaise: number;
  guaranteedMonthlyDays?: number;
  notes?: string;
}

export interface ContractHistoryEntry {
  action: string;
  status: DriverContractStatus;
  actorUserId: Types.ObjectId;
  at: Date;
  note?: string;
  termsSnapshot?: {
    startDate: Date;
    endDate: Date;
    minGuaranteePaise: number;
    perKmRatePaise: number;
    assignedVehicleId?: string;
    eligibleCorridorIds: string[];
  };
}

export interface IDriverContract extends Document {
  _id: Types.ObjectId;
  contractCode: string;
  platformOwnerId: Types.ObjectId;
  driverProfileId: Types.ObjectId;
  driverUserId: Types.ObjectId;
  startDate: Date;
  endDate: Date;
  minimumGuaranteeTerms: MinimumGuaranteeTerms;
  assignedVehicleId?: Types.ObjectId;
  eligibleCorridorIds: Types.ObjectId[];
  status: DriverContractStatus;
  history: ContractHistoryEntry[];
  createdAt: Date;
  updatedAt: Date;
}

const contractHistorySchema = new Schema<ContractHistoryEntry>(
  {
    action: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: ['DRAFT', 'ACTIVE', 'SUSPENDED', 'INACTIVE', 'EXPIRED', 'TERMINATED'],
      required: true,
    },
    actorUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    at: { type: Date, required: true, default: Date.now },
    note: { type: String, trim: true, maxlength: 400 },
    termsSnapshot: {
      startDate: { type: Date },
      endDate: { type: Date },
      minGuaranteePaise: { type: Number },
      perKmRatePaise: { type: Number },
      assignedVehicleId: { type: String },
      eligibleCorridorIds: { type: [String], default: [] },
    },
  },
  { _id: false }
);

const driverContractSchema = new Schema<IDriverContract>(
  {
    contractCode: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },
    platformOwnerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    driverProfileId: {
      type: Schema.Types.ObjectId,
      ref: 'DriverProfile',
      required: true,
      index: true,
    },
    driverUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    minimumGuaranteeTerms: {
      minGuaranteePaise: { type: Number, required: true, min: 0 },
      perKmRatePaise: { type: Number, required: true, min: 0 },
      guaranteedMonthlyDays: { type: Number, min: 1, max: 31 },
      notes: { type: String, trim: true, maxlength: 400 },
    },
    assignedVehicleId: { type: Schema.Types.ObjectId, ref: 'Vehicle' },
    eligibleCorridorIds: [{ type: Schema.Types.ObjectId, ref: 'Corridor' }],
    status: {
      type: String,
      enum: ['DRAFT', 'ACTIVE', 'SUSPENDED', 'INACTIVE', 'EXPIRED', 'TERMINATED'],
      default: 'ACTIVE',
      required: true,
    },
    history: { type: [contractHistorySchema], default: [] },
  },
  { timestamps: true }
);

driverContractSchema.index({ platformOwnerId: 1, driverUserId: 1, status: 1 });

driverContractSchema.pre('validate', function () {
  if (
    this.startDate &&
    this.endDate &&
    new Date(this.endDate).getTime() <= new Date(this.startDate).getTime()
  ) {
    this.invalidate('endDate', 'Contract endDate must be after startDate.');
  }
});

export const DriverContract = model<IDriverContract>('DriverContract', driverContractSchema);
