import { Schema, model, type Document, type Types } from 'mongoose';

export interface DiscountTier {
  minUtilizationPct: number;
  discountBps: number; // basis points (e.g. 1000 = 10%)
  label: string;
}

export interface IPricingConfig extends Document {
  _id: Types.ObjectId;
  version: string;
  discountTiers: DiscountTier[];
  anchorRewardBps: number;
  anchorMinWeightKg: number;
  tokenPercentage: number;
  minMarginBps: number;
  estimatedCostPaisePerKg: number;
  handlingFeePaisePerShipment: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const discountTierSchema = new Schema<DiscountTier>(
  {
    minUtilizationPct: { type: Number, required: true, min: 0, max: 100 },
    discountBps: { type: Number, required: true, min: 0, max: 5000 },
    label: { type: String, required: true, trim: true },
  },
  { _id: false }
);

const pricingConfigSchema = new Schema<IPricingConfig>(
  {
    version: { type: String, required: true, unique: true, trim: true },
    discountTiers: { type: [discountTierSchema], required: true },
    anchorRewardBps: { type: Number, default: 500, min: 0, max: 2500 },
    anchorMinWeightKg: { type: Number, default: 50, min: 0 },
    tokenPercentage: { type: Number, default: 15, min: 5, max: 50 },
    minMarginBps: { type: Number, default: 800, min: 0, max: 5000 },
    estimatedCostPaisePerKg: { type: Number, default: 280, min: 1 },
    handlingFeePaisePerShipment: { type: Number, default: 5000, min: 0 },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

export const PricingConfig = model<IPricingConfig>('PricingConfig', pricingConfigSchema);
