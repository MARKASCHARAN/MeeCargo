import { env } from '../config/env.js';
import { PricingConfig, type DiscountTier } from '../models/PricingConfig.js';
import { HttpError } from '../utils/errors.js';

export interface PricingRuleSet {
  version: string;
  discountTiers: DiscountTier[];
  anchorRewardBps: number;
  anchorMinWeightKg: number;
  tokenPercentage: number;
  minMarginBps: number;
  estimatedCostPaisePerKg: number;
  handlingFeePaisePerShipment: number;
}

export const DEFAULT_PRICING_RULES: PricingRuleSet = {
  version: '2026.11.v1',
  discountTiers: [
    { minUtilizationPct: 0, discountBps: 0, label: 'Base Pool (0–39%)' },
    { minUtilizationPct: 40, discountBps: 800, label: 'Growing Pool (40–64% • 8% off)' },
    { minUtilizationPct: 65, discountBps: 1500, label: 'High Fill Pool (65–84% • 15% off)' },
    { minUtilizationPct: 85, discountBps: 2200, label: 'Full Pool (85%+ • 22% off)' },
  ],
  anchorRewardBps: 500,
  anchorMinWeightKg: 50,
  tokenPercentage: env.TOKEN_PERCENTAGE,
  minMarginBps: 800,
  estimatedCostPaisePerKg: 280,
  handlingFeePaisePerShipment: 5000,
};

export async function getActivePricingRules(): Promise<PricingRuleSet> {
  const doc = await PricingConfig.findOne({ isActive: true }).sort({ createdAt: -1 }).lean();
  if (!doc) return DEFAULT_PRICING_RULES;
  return {
    version: doc.version,
    discountTiers: doc.discountTiers,
    anchorRewardBps: doc.anchorRewardBps,
    anchorMinWeightKg: doc.anchorMinWeightKg,
    tokenPercentage: doc.tokenPercentage,
    minMarginBps: doc.minMarginBps,
    estimatedCostPaisePerKg: doc.estimatedCostPaisePerKg,
    handlingFeePaisePerShipment: doc.handlingFeePaisePerShipment,
  };
}

export interface PriceCalculationInput {
  chargeableWeightKg: number;
  baseRatePaisePerKg: number;
  guaranteedCeilingPaisePerKg: number;
  weightUtilizationPct: number;
  volumeUtilizationPct: number;
  isAnchorEligible: boolean;
  rules?: PricingRuleSet;
  allowSubsidy?: boolean;
  tokenPaidPaise?: number;
}

export interface PriceCalculationBreakdown {
  pricingVersion: string;
  chargeableWeightKg: number;
  effectiveUtilizationPct: number;
  appliedTierLabel: string;
  appliedDiscountBps: number;
  baseFreightPaise: number;
  ceilingPricePaise: number;
  poolDiscountPaise: number;
  anchorDiscountPaise: number;
  handlingFeePaise: number;
  computedPricePaise: number;
  minAllowedPricePaise: number;
  subsidyPaise: number;
  marginFlagged: boolean;
  tokenAmountPaise: number;
  remainingBalancePaise: number;
  effectiveRatePaisePerKg: number;
}

export function selectDiscountTier(
  effectiveUtilizationPct: number,
  tiers: DiscountTier[]
): DiscountTier {
  const sorted = [...tiers].sort((a, b) => b.minUtilizationPct - a.minUtilizationPct);
  return (
    sorted.find((t) => effectiveUtilizationPct >= t.minUtilizationPct) ?? {
      minUtilizationPct: 0,
      discountBps: 0,
      label: 'Base Pool',
    }
  );
}

/**
 * Deterministic TypeScript pricing engine.
 * All monetary figures are calculated strictly in integer paise.
 */
export function calculateDeterministicPrice(
  input: PriceCalculationInput
): PriceCalculationBreakdown {
  const rules = input.rules ?? DEFAULT_PRICING_RULES;
  if (!Number.isFinite(input.chargeableWeightKg) || input.chargeableWeightKg <= 0) {
    throw new HttpError(400, 'Chargeable weight must be positive', 'VALIDATION_ERROR');
  }

  const effectiveUtilizationPct = Math.max(
    0,
    Math.min(100, Math.max(input.weightUtilizationPct, input.volumeUtilizationPct))
  );

  const tier = selectDiscountTier(effectiveUtilizationPct, rules.discountTiers);
  const baseFreightPaise = Math.round(input.chargeableWeightKg * input.baseRatePaisePerKg);
  const ceilingFreightPaise = Math.round(
    input.chargeableWeightKg * input.guaranteedCeilingPaisePerKg
  );
  const ceilingPricePaise = ceilingFreightPaise + rules.handlingFeePaisePerShipment;

  const poolDiscountPaise = Math.round((baseFreightPaise * tier.discountBps) / 10000);
  const qualifiesAnchor =
    input.isAnchorEligible && input.chargeableWeightKg >= rules.anchorMinWeightKg;
  const anchorDiscountPaise = qualifiesAnchor
    ? Math.round((baseFreightPaise * rules.anchorRewardBps) / 10000)
    : 0;

  const discountedFreightPaise = Math.max(
    0,
    baseFreightPaise - poolDiscountPaise - anchorDiscountPaise
  );
  const grossPricePaise = discountedFreightPaise + rules.handlingFeePaisePerShipment;
  const cappedPricePaise = Math.min(grossPricePaise, ceilingPricePaise);

  const minFreightWithMarginPaise = Math.round(
    input.chargeableWeightKg *
      rules.estimatedCostPaisePerKg *
      (1 + rules.minMarginBps / 10000)
  );
  const minAllowedPricePaise =
    minFreightWithMarginPaise + rules.handlingFeePaisePerShipment;

  let marginFlagged = false;
  let subsidyPaise = 0;
  let finalPricePaise = cappedPricePaise;

  if (cappedPricePaise < minAllowedPricePaise) {
    if (!input.allowSubsidy) {
      throw new HttpError(
        422,
        `Calculated price (${cappedPricePaise} paise) violates minimum margin floor (${minAllowedPricePaise} paise) without an approved subsidy.`,
        'MARGIN_POLICY_VIOLATION'
      );
    }
    marginFlagged = true;
    subsidyPaise = minAllowedPricePaise - cappedPricePaise;
    finalPricePaise = cappedPricePaise;
  }

  const tokenAmountPaise = Math.round(
    (ceilingPricePaise * rules.tokenPercentage) / 100
  );
  const tokenPaidPaise = input.tokenPaidPaise ?? 0;
  const remainingBalancePaise = Math.max(0, finalPricePaise - tokenPaidPaise);
  const effectiveRatePaisePerKg = Math.round(
    finalPricePaise / input.chargeableWeightKg
  );

  return {
    pricingVersion: rules.version,
    chargeableWeightKg: input.chargeableWeightKg,
    effectiveUtilizationPct: Number(effectiveUtilizationPct.toFixed(1)),
    appliedTierLabel: tier.label,
    appliedDiscountBps: tier.discountBps,
    baseFreightPaise,
    ceilingPricePaise,
    poolDiscountPaise,
    anchorDiscountPaise,
    handlingFeePaise: rules.handlingFeePaisePerShipment,
    computedPricePaise: finalPricePaise,
    minAllowedPricePaise,
    subsidyPaise,
    marginFlagged,
    tokenAmountPaise,
    remainingBalancePaise,
    effectiveRatePaisePerKg,
  };
}
