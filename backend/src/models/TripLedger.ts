import { Schema, model, type Document, type Types } from 'mongoose';

export interface LedgerLine {
  key: string;
  category: 'REVENUE' | 'COST' | 'SUBSIDY_REFUND';
  label: string;
  amountPaise: number;
  status: 'ESTIMATED' | 'ACTUAL';
  source: string;
}

export interface ITripLedger extends Document {
  _id: Types.ObjectId;
  tripId: Types.ObjectId;
  isDemoIllustrative: boolean;
  lines: LedgerLine[];
  outboundRevenuePaise: number;
  confirmedBackhaulRevenuePaise: number;
  vehiclePayoutAndMinGuaranteePaise: number;
  fuelAndTollPaise: number;
  hubHandlingCostPaise: number;
  paymentAndOperatingFeesPaise: number;
  refundsAndSubsidiesPaise: number;
  platformContributionPaise: number;
  createdAt: Date;
  updatedAt: Date;
}

const ledgerLineSchema = new Schema<LedgerLine>(
  {
    key: { type: String, required: true },
    category: {
      type: String,
      enum: ['REVENUE', 'COST', 'SUBSIDY_REFUND'],
      required: true,
    },
    label: { type: String, required: true },
    amountPaise: { type: Number, required: true },
    status: { type: String, enum: ['ESTIMATED', 'ACTUAL'], required: true },
    source: { type: String, required: true },
  },
  { _id: false }
);

const tripLedgerSchema = new Schema<ITripLedger>(
  {
    tripId: { type: Schema.Types.ObjectId, ref: 'Trip', required: true, unique: true },
    isDemoIllustrative: { type: Boolean, default: true },
    lines: { type: [ledgerLineSchema], default: [] },
    outboundRevenuePaise: { type: Number, required: true },
    confirmedBackhaulRevenuePaise: { type: Number, required: true },
    vehiclePayoutAndMinGuaranteePaise: { type: Number, required: true },
    fuelAndTollPaise: { type: Number, required: true },
    hubHandlingCostPaise: { type: Number, required: true },
    paymentAndOperatingFeesPaise: { type: Number, required: true },
    refundsAndSubsidiesPaise: { type: Number, required: true },
    platformContributionPaise: { type: Number, required: true },
  },
  { timestamps: true }
);

export const TripLedger = model<ITripLedger>('TripLedger', tripLedgerSchema);
