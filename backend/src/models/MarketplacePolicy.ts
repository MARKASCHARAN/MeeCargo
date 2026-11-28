import { Schema, model, type Document } from 'mongoose';

export type MarketplaceOpportunityType =
  | 'OVERFLOW'
  | 'RIGHT_SIZING'
  | 'EXPRESS'
  | 'NEW_ROUTE';

export interface IMarketplacePolicy extends Document {
  policyVersion: string;
  isActive: boolean;
  enabledOpportunityTypes: MarketplaceOpportunityType[];
  earlyFillFirstRefusalMin: number;
  offerExpiryMin: number;
  maxActiveOffersPerOpportunity: number;
  overflowMinChargeableWeightKg: number;
  overflowMinVolumeCbm: number;
  rightSizingMinNetSavingsPaise: number;
  newRouteViabilityThresholdPct: number;
  minContributionPaise: number;
  maxNewRouteDetourPct: number;
  payoutPolicy: {
    baseDispatchFeePaise: number;
    defaultPerKmPaise: number;
    perKmByBodyTypePaise: {
      MINI_PICKUP: number;
      CLOSED_BODY: number;
      OPEN_BODY: number;
      CONTAINER: number;
      FLATBED: number;
    };
    weightSurchargePaisePerKg: number;
    volumeSurchargePaisePerCbm: number;
    expressUrgencyMultiplierBps: number;
    approachAllowancePaisePerKm: number;
    maxApproachBillableKm: number;
    defaultTollAllowancePaise: number;
  };
  expressPricing: {
    baseFeePaise: number;
    ratePaisePerKm: number;
    chargeableKgRatePaise: number;
    minCustomerChargePaise: number;
    platformMinMarginPaise: number;
  };
  createdAt: Date;
  updatedAt: Date;
}

export const DEFAULT_MARKETPLACE_POLICY_VALUES = {
  policyVersion: 't2-mkt-v1',
  isActive: true,
  enabledOpportunityTypes: ['OVERFLOW', 'RIGHT_SIZING', 'EXPRESS', 'NEW_ROUTE'] as MarketplaceOpportunityType[],
  earlyFillFirstRefusalMin: 30,
  offerExpiryMin: 45,
  maxActiveOffersPerOpportunity: 10,
  overflowMinChargeableWeightKg: 50,
  overflowMinVolumeCbm: 0.2,
  rightSizingMinNetSavingsPaise: 15000,
  newRouteViabilityThresholdPct: 50,
  minContributionPaise: 0,
  maxNewRouteDetourPct: 35,
  payoutPolicy: {
    baseDispatchFeePaise: 25000,
    defaultPerKmPaise: 1900,
    perKmByBodyTypePaise: {
      MINI_PICKUP: 1600,
      CLOSED_BODY: 1900,
      OPEN_BODY: 1850,
      CONTAINER: 2200,
      FLATBED: 2100,
    },
    weightSurchargePaisePerKg: 20,
    volumeSurchargePaisePerCbm: 1500,
    expressUrgencyMultiplierBps: 12000,
    approachAllowancePaisePerKm: 800,
    maxApproachBillableKm: 25,
    defaultTollAllowancePaise: 0,
  },
  expressPricing: {
    baseFeePaise: 45000,
    ratePaisePerKm: 2600,
    chargeableKgRatePaise: 120,
    minCustomerChargePaise: 90000,
    platformMinMarginPaise: 20000,
  },
};

const marketplacePolicySchema = new Schema<IMarketplacePolicy>(
  {
    policyVersion: { type: String, required: true, unique: true, trim: true },
    isActive: { type: Boolean, default: true, index: true },
    enabledOpportunityTypes: {
      type: [String],
      enum: ['OVERFLOW', 'RIGHT_SIZING', 'EXPRESS', 'NEW_ROUTE'],
      default: () => DEFAULT_MARKETPLACE_POLICY_VALUES.enabledOpportunityTypes,
    },
    earlyFillFirstRefusalMin: { type: Number, default: 30, min: 0, max: 720 },
    offerExpiryMin: { type: Number, default: 45, min: 5, max: 1440 },
    maxActiveOffersPerOpportunity: { type: Number, default: 10, min: 1, max: 50 },
    overflowMinChargeableWeightKg: { type: Number, default: 50, min: 0 },
    overflowMinVolumeCbm: { type: Number, default: 0.2, min: 0 },
    rightSizingMinNetSavingsPaise: { type: Number, default: 15000, min: 0 },
    newRouteViabilityThresholdPct: { type: Number, default: 50, min: 0, max: 100 },
    minContributionPaise: { type: Number, default: 0 },
    maxNewRouteDetourPct: { type: Number, default: 35, min: 0, max: 100 },
    payoutPolicy: {
      baseDispatchFeePaise: { type: Number, default: 25000, min: 0 },
      defaultPerKmPaise: { type: Number, default: 1900, min: 100 },
      perKmByBodyTypePaise: {
        MINI_PICKUP: { type: Number, default: 1600, min: 100 },
        CLOSED_BODY: { type: Number, default: 1900, min: 100 },
        OPEN_BODY: { type: Number, default: 1850, min: 100 },
        CONTAINER: { type: Number, default: 2200, min: 100 },
        FLATBED: { type: Number, default: 2100, min: 100 },
      },
      weightSurchargePaisePerKg: { type: Number, default: 20, min: 0 },
      volumeSurchargePaisePerCbm: { type: Number, default: 1500, min: 0 },
      expressUrgencyMultiplierBps: { type: Number, default: 12000, min: 10000 },
      approachAllowancePaisePerKm: { type: Number, default: 800, min: 0 },
      maxApproachBillableKm: { type: Number, default: 25, min: 0 },
      defaultTollAllowancePaise: { type: Number, default: 0, min: 0 },
    },
    expressPricing: {
      baseFeePaise: { type: Number, default: 45000, min: 0 },
      ratePaisePerKm: { type: Number, default: 2600, min: 100 },
      chargeableKgRatePaise: { type: Number, default: 120, min: 0 },
      minCustomerChargePaise: { type: Number, default: 90000, min: 0 },
      platformMinMarginPaise: { type: Number, default: 20000, min: 0 },
    },
  },
  { timestamps: true }
);

export const MarketplacePolicy = model<IMarketplacePolicy>(
  'MarketplacePolicy',
  marketplacePolicySchema
);
