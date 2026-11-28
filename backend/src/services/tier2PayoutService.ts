import crypto from 'node:crypto';
import { Types, type ClientSession } from 'mongoose';
import {
  DEFAULT_MARKETPLACE_POLICY_VALUES,
  MarketplacePolicy,
  type IMarketplacePolicy,
  type MarketplaceOpportunityType,
} from '../models/MarketplacePolicy.js';
import {
  Tier2Earning,
  type ITier2Earning,
  type Tier2EarningStatus,
} from '../models/Tier2Earning.js';
import type { VehicleBodyType } from '../models/Vehicle.js';
import { HttpError } from '../utils/errors.js';

export type MarketplacePolicySnapshot = typeof DEFAULT_MARKETPLACE_POLICY_VALUES;

export interface Tier2PayoutQuote {
  currency: 'INR';
  spotPayoutPaise: number;
  baseFeePaise: number;
  distancePayPaise: number;
  cargoAllowancePaise: number;
  urgencyPremiumPaise: number;
  approachAllowancePaise: number;
  tollAllowancePaise: number;
  tier1MinGuaranteeIncludedPaise: number;
  policyVersion: string;
}

export async function getActiveMarketplacePolicy(
  session?: ClientSession | null
): Promise<MarketplacePolicySnapshot> {
  const existing = await MarketplacePolicy.findOne({ isActive: true })
    .sort({ updatedAt: -1 })
    .session(session ?? null)
    .lean();

  if (existing) {
    return {
      policyVersion: existing.policyVersion,
      isActive: existing.isActive,
      enabledOpportunityTypes:
        existing.enabledOpportunityTypes?.length > 0
          ? existing.enabledOpportunityTypes
          : DEFAULT_MARKETPLACE_POLICY_VALUES.enabledOpportunityTypes,
      earlyFillFirstRefusalMin: existing.earlyFillFirstRefusalMin,
      offerExpiryMin: existing.offerExpiryMin,
      maxActiveOffersPerOpportunity: existing.maxActiveOffersPerOpportunity,
      overflowMinChargeableWeightKg: existing.overflowMinChargeableWeightKg,
      overflowMinVolumeCbm: existing.overflowMinVolumeCbm,
      rightSizingMinNetSavingsPaise: existing.rightSizingMinNetSavingsPaise,
      newRouteViabilityThresholdPct: existing.newRouteViabilityThresholdPct,
      minContributionPaise: existing.minContributionPaise,
      maxNewRouteDetourPct: existing.maxNewRouteDetourPct,
      payoutPolicy: {
        ...DEFAULT_MARKETPLACE_POLICY_VALUES.payoutPolicy,
        ...(existing.payoutPolicy ?? {}),
        perKmByBodyTypePaise: {
          ...DEFAULT_MARKETPLACE_POLICY_VALUES.payoutPolicy.perKmByBodyTypePaise,
          ...(existing.payoutPolicy?.perKmByBodyTypePaise ?? {}),
        },
      },
      expressPricing: {
        ...DEFAULT_MARKETPLACE_POLICY_VALUES.expressPricing,
        ...(existing.expressPricing ?? {}),
      },
    };
  }

  return structuredClone(DEFAULT_MARKETPLACE_POLICY_VALUES);
}

export async function ensureActiveMarketplacePolicyDocument(
  session?: ClientSession | null
): Promise<IMarketplacePolicy> {
  const existing = await MarketplacePolicy.findOne({ isActive: true })
    .sort({ updatedAt: -1 })
    .session(session ?? null);
  if (existing) {
    return existing;
  }

  const created = await MarketplacePolicy.create(
    [
      {
        ...DEFAULT_MARKETPLACE_POLICY_VALUES,
        isActive: true,
      },
    ],
    { session: session ?? undefined }
  );
  return created[0];
}

export async function updateMarketplacePolicyForOwner(
  updates: Partial<MarketplacePolicySnapshot>
): Promise<MarketplacePolicySnapshot> {
  const current = await getActiveMarketplacePolicy();
  const nextVersion =
    typeof updates.policyVersion === 'string' && updates.policyVersion.trim()
      ? updates.policyVersion.trim()
      : `t2-mkt-v${Date.now()}`;

  const merged: MarketplacePolicySnapshot = {
    policyVersion: nextVersion,
    isActive: true,
    enabledOpportunityTypes:
      updates.enabledOpportunityTypes && updates.enabledOpportunityTypes.length > 0
        ? updates.enabledOpportunityTypes
        : current.enabledOpportunityTypes,
    earlyFillFirstRefusalMin:
      typeof updates.earlyFillFirstRefusalMin === 'number'
        ? Math.max(0, Math.min(720, Math.round(updates.earlyFillFirstRefusalMin)))
        : current.earlyFillFirstRefusalMin,
    offerExpiryMin:
      typeof updates.offerExpiryMin === 'number'
        ? Math.max(5, Math.min(1440, Math.round(updates.offerExpiryMin)))
        : current.offerExpiryMin,
    maxActiveOffersPerOpportunity:
      typeof updates.maxActiveOffersPerOpportunity === 'number'
        ? Math.max(1, Math.min(50, Math.round(updates.maxActiveOffersPerOpportunity)))
        : current.maxActiveOffersPerOpportunity,
    overflowMinChargeableWeightKg:
      typeof updates.overflowMinChargeableWeightKg === 'number'
        ? Math.max(0, updates.overflowMinChargeableWeightKg)
        : current.overflowMinChargeableWeightKg,
    overflowMinVolumeCbm:
      typeof updates.overflowMinVolumeCbm === 'number'
        ? Math.max(0, updates.overflowMinVolumeCbm)
        : current.overflowMinVolumeCbm,
    rightSizingMinNetSavingsPaise:
      typeof updates.rightSizingMinNetSavingsPaise === 'number'
        ? Math.max(0, Math.round(updates.rightSizingMinNetSavingsPaise))
        : current.rightSizingMinNetSavingsPaise,
    newRouteViabilityThresholdPct:
      typeof updates.newRouteViabilityThresholdPct === 'number'
        ? Math.max(10, Math.min(100, updates.newRouteViabilityThresholdPct))
        : current.newRouteViabilityThresholdPct,
    minContributionPaise:
      typeof updates.minContributionPaise === 'number'
        ? Math.round(updates.minContributionPaise)
        : current.minContributionPaise,
    maxNewRouteDetourPct:
      typeof updates.maxNewRouteDetourPct === 'number'
        ? Math.max(5, Math.min(100, updates.maxNewRouteDetourPct))
        : current.maxNewRouteDetourPct,
    payoutPolicy: {
      ...current.payoutPolicy,
      ...(updates.payoutPolicy ?? {}),
      perKmByBodyTypePaise: {
        ...current.payoutPolicy.perKmByBodyTypePaise,
        ...(updates.payoutPolicy?.perKmByBodyTypePaise ?? {}),
      },
    },
    expressPricing: {
      ...current.expressPricing,
      ...(updates.expressPricing ?? {}),
    },
  };

  await MarketplacePolicy.updateMany({ isActive: true }, { $set: { isActive: false } });
  await MarketplacePolicy.create(merged);
  return merged;
}

export function calculateDeterministicTier2Payout(params: {
  opportunityType: MarketplaceOpportunityType;
  estimatedDistanceKm: number;
  totalWeightKg: number;
  totalVolumeCbm: number;
  bodyType?: VehicleBodyType;
  approachDistanceKm?: number;
  tollAllowancePaise?: number;
  policy: MarketplacePolicySnapshot;
}): Tier2PayoutQuote {
  const { payoutPolicy } = params.policy;
  const safeDistanceKm = Math.max(1, params.estimatedDistanceKm);
  const safeWeightKg = Math.max(0, params.totalWeightKg);
  const safeVolumeCbm = Math.max(0, params.totalVolumeCbm);
  const perKmRatePaise =
    (params.bodyType && payoutPolicy.perKmByBodyTypePaise[params.bodyType]) ||
    payoutPolicy.defaultPerKmPaise;

  const baseFeePaise = Math.round(payoutPolicy.baseDispatchFeePaise);
  const distancePayPaise = Math.round(safeDistanceKm * perKmRatePaise);
  const cargoAllowancePaise = Math.round(
    safeWeightKg * payoutPolicy.weightSurchargePaisePerKg +
      safeVolumeCbm * payoutPolicy.volumeSurchargePaisePerCbm
  );

  const urgencyPremiumPaise =
    params.opportunityType === 'EXPRESS'
      ? Math.round(
          ((baseFeePaise + distancePayPaise) *
            Math.max(0, payoutPolicy.expressUrgencyMultiplierBps - 10000)) /
            10000
        )
      : 0;

  const billableApproachKm = Math.min(
    payoutPolicy.maxApproachBillableKm,
    Math.max(0, params.approachDistanceKm ?? 0)
  );
  const approachAllowancePaise = Math.round(
    billableApproachKm * payoutPolicy.approachAllowancePaisePerKm
  );
  const tollAllowancePaise = Math.max(
    0,
    Math.round(params.tollAllowancePaise ?? payoutPolicy.defaultTollAllowancePaise)
  );

  // Strict Tier 2 isolation: Tier 1 minimum weekly/monthly contract guarantees NEVER apply
  const tier1MinGuaranteeIncludedPaise = 0;

  const spotPayoutPaise =
    baseFeePaise +
    distancePayPaise +
    cargoAllowancePaise +
    urgencyPremiumPaise +
    approachAllowancePaise +
    tollAllowancePaise;

  return {
    currency: 'INR',
    spotPayoutPaise,
    baseFeePaise,
    distancePayPaise,
    cargoAllowancePaise,
    urgencyPremiumPaise,
    approachAllowancePaise,
    tollAllowancePaise,
    tier1MinGuaranteeIncludedPaise,
    policyVersion: params.policy.policyVersion,
  };
}

export function calculateExpressCustomerQuotePaise(params: {
  estimatedDistanceKm: number;
  chargeableWeightKg: number;
  volumeCbm: number;
  bodyType?: VehicleBodyType;
  policy: MarketplacePolicySnapshot;
}): {
  customerChargePaise: number;
  estimatedSpotPayoutPaise: number;
  platformMarginPaise: number;
  payoutQuote: Tier2PayoutQuote;
} {
  const { expressPricing } = params.policy;
  const payoutQuote = calculateDeterministicTier2Payout({
    opportunityType: 'EXPRESS',
    estimatedDistanceKm: params.estimatedDistanceKm,
    totalWeightKg: params.chargeableWeightKg,
    totalVolumeCbm: params.volumeCbm,
    bodyType: params.bodyType,
    policy: params.policy,
  });

  const formulaChargePaise = Math.round(
    expressPricing.baseFeePaise +
      Math.max(1, params.estimatedDistanceKm) * expressPricing.ratePaisePerKm +
      Math.max(1, params.chargeableWeightKg) * expressPricing.chargeableKgRatePaise
  );

  const floorChargePaise = Math.max(
    expressPricing.minCustomerChargePaise,
    payoutQuote.spotPayoutPaise + expressPricing.platformMinMarginPaise
  );

  const customerChargePaise = Math.max(formulaChargePaise, floorChargePaise);
  const platformMarginPaise = customerChargePaise - payoutQuote.spotPayoutPaise;

  return {
    customerChargePaise,
    estimatedSpotPayoutPaise: payoutQuote.spotPayoutPaise,
    platformMarginPaise,
    payoutQuote,
  };
}

function generateEarningCode(): string {
  return `T2E-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

export async function createAcceptedTier2Earning(params: {
  opportunityId: Types.ObjectId;
  tripId: Types.ObjectId;
  driverUserId: Types.ObjectId;
  vehicleId: Types.ObjectId;
  opportunityType: MarketplaceOpportunityType;
  grossPayoutPaise: number;
  policyVersion: string;
  actorUserId?: Types.ObjectId;
  session?: ClientSession | null;
}): Promise<ITier2Earning> {
  const grossPayoutPaise = Math.round(params.grossPayoutPaise);
  if (!Number.isInteger(grossPayoutPaise) || grossPayoutPaise < 0) {
    throw new HttpError(400, 'Earning payout must be a non-negative integer paise amount', 'INVALID_PAYOUT');
  }

  const existing = await Tier2Earning.findOne({
    tripId: params.tripId,
    status: { $ne: 'REVERSED' },
  }).session(params.session ?? null);

  if (existing) {
    return existing;
  }

  const created = await Tier2Earning.create(
    [
      {
        earningCode: generateEarningCode(),
        opportunityId: params.opportunityId,
        tripId: params.tripId,
        driverUserId: params.driverUserId,
        vehicleId: params.vehicleId,
        opportunityType: params.opportunityType,
        status: 'ACCEPTED',
        currency: 'INR',
        grossPayoutPaise,
        adjustmentsPaise: 0,
        netPayablePaise: grossPayoutPaise,
        policyVersion: params.policyVersion,
        isSimulated: true,
        auditHistory: [
          {
            action: 'EARNING_CREATED_ON_ACCEPT',
            toStatus: 'ACCEPTED',
            actorUserId: params.actorUserId ?? params.driverUserId,
            note: `Snapshotted fixed Tier 2 spot payout ₹${(grossPayoutPaise / 100).toFixed(2)}`,
            at: new Date(),
          },
        ],
      },
    ],
    { session: params.session ?? undefined }
  );

  return created[0];
}

export async function markTier2EarningCompleted(params: {
  tripId: Types.ObjectId;
  actorUserId?: Types.ObjectId;
  session?: ClientSession | null;
}): Promise<ITier2Earning | null> {
  const earning = await Tier2Earning.findOne({
    tripId: params.tripId,
    status: { $in: ['ACCEPTED', 'TRIP_COMPLETED', 'PENDING_SETTLEMENT', 'PAID'] },
  }).session(params.session ?? null);

  if (!earning) {
    return null;
  }

  if (
    earning.status === 'TRIP_COMPLETED' ||
    earning.status === 'PENDING_SETTLEMENT' ||
    earning.status === 'PAID'
  ) {
    return earning;
  }

  const now = new Date();
  const prevStatus = earning.status;
  earning.status = 'TRIP_COMPLETED';
  earning.completedAt = now;
  earning.auditHistory.push({
    action: 'TRIP_DELIVERED_ELIGIBLE_FOR_SETTLEMENT',
    fromStatus: prevStatus,
    toStatus: 'TRIP_COMPLETED',
    actorUserId: params.actorUserId,
    note: 'Trip completed with POD/OTP verification; eligible for Platform Owner settlement',
    at: now,
  });

  await earning.save({ session: params.session ?? undefined });
  return earning;
}

export async function settleTier2Earning(params: {
  earningId: string;
  actorUserId: string;
  idempotencyKey?: string;
  adjustmentsPaise?: number;
  note?: string;
  session?: ClientSession | null;
}): Promise<ITier2Earning> {
  const earning = await Tier2Earning.findById(params.earningId).session(params.session ?? null);
  if (!earning) {
    throw new HttpError(404, 'Tier 2 earning record not found', 'NOT_FOUND');
  }

  if (earning.status === 'PAID') {
    throw new HttpError(
      409,
      `Tier 2 earning ${earning.earningCode} has already been settled`,
      'DUPLICATE_SETTLEMENT'
    );
  }

  if (earning.status !== 'TRIP_COMPLETED' && earning.status !== 'PENDING_SETTLEMENT') {
    throw new HttpError(
      409,
      `Earning in status ${earning.status} cannot be settled (trip must be completed and undisputed)`,
      'SETTLEMENT_NOT_ELIGIBLE'
    );
  }

  if (typeof params.adjustmentsPaise === 'number') {
    if (!Number.isInteger(params.adjustmentsPaise)) {
      throw new HttpError(400, 'adjustmentsPaise must be an integer', 'VALIDATION_ERROR');
    }
    const nextNet = earning.grossPayoutPaise + params.adjustmentsPaise;
    if (nextNet < 0) {
      throw new HttpError(400, 'Resulting netPayablePaise cannot be negative', 'VALIDATION_ERROR');
    }
    earning.adjustmentsPaise = params.adjustmentsPaise;
    earning.netPayablePaise = nextNet;
  }

  const now = new Date();
  const prevStatus: Tier2EarningStatus = earning.status;
  const settlementRef = `SIM-T2-SET-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;

  earning.status = 'PAID';
  earning.settlementRef = settlementRef;
  earning.settlementIdempotencyKey =
    params.idempotencyKey?.trim() || `settle:${String(earning._id)}`;
  earning.settledAt = now;
  earning.isSimulated = true;
  earning.auditHistory.push({
    action: 'SIMULATED_SETTLEMENT_PAID',
    fromStatus: prevStatus,
    toStatus: 'PAID',
    actorUserId: new Types.ObjectId(params.actorUserId),
    note:
      params.note?.trim() ||
      `Simulated payout settled (${settlementRef}) for ₹${(earning.netPayablePaise / 100).toFixed(2)}`,
    at: now,
  });

  await earning.save({ session: params.session ?? undefined });
  return earning;
}

export async function holdOrReverseTier2Earning(params: {
  tripId?: Types.ObjectId;
  earningId?: string;
  action: 'HOLD' | 'DISPUTE' | 'REVERSE';
  reason: string;
  actorUserId?: Types.ObjectId;
  session?: ClientSession | null;
}): Promise<ITier2Earning | null> {
  if (!params.earningId && !params.tripId) return null;
  const earning = params.earningId
    ? await Tier2Earning.findById(params.earningId).session(params.session ?? null)
    : await Tier2Earning.findOne({
        tripId: params.tripId,
        status: { $ne: 'REVERSED' },
      }).session(params.session ?? null);
  if (!earning) return null;

  if (earning.status === 'PAID' && params.action !== 'DISPUTE') {
    throw new HttpError(
      409,
      'Settled Tier 2 earning cannot be cancelled without dispute review',
      'ALREADY_PAID'
    );
  }

  const targetStatus: Tier2EarningStatus =
    params.action === 'REVERSE'
      ? 'REVERSED'
      : params.action === 'DISPUTE'
        ? 'DISPUTED'
        : 'ON_HOLD';

  const prevStatus = earning.status;
  earning.status = targetStatus;
  if (params.action === 'REVERSE') {
    earning.reversalReason = params.reason;
  } else {
    earning.holdOrDisputeReason = params.reason;
  }

  earning.auditHistory.push({
    action: `EARNING_${params.action}`,
    fromStatus: prevStatus,
    toStatus: targetStatus,
    actorUserId: params.actorUserId,
    note: params.reason,
    at: new Date(),
  });

  await earning.save({ session: params.session ?? undefined });
  return earning;
}

export async function listDriverTier2Earnings(driverUserId: string) {
  const driverObjId = new Types.ObjectId(driverUserId);
  const earnings = await Tier2Earning.find({ driverUserId: driverObjId })
    .populate('tripId', 'tripCode status completedAt')
    .populate('opportunityId', 'opportunityCode opportunityType originLabel destinationLabel')
    .sort({ createdAt: -1 })
    .lean();

  const summary = {
    currency: 'INR' as const,
    isSimulated: true,
    totalEarnedPaise: 0,
    pendingSettlementPaise: 0,
    paidPaise: 0,
    activeAcceptedPaise: 0,
    onHoldOrDisputedPaise: 0,
    completedTripsCount: 0,
  };

  for (const item of earnings) {
    if (item.status === 'PAID') {
      summary.paidPaise += item.netPayablePaise;
      summary.totalEarnedPaise += item.netPayablePaise;
      summary.completedTripsCount += 1;
    } else if (item.status === 'TRIP_COMPLETED' || item.status === 'PENDING_SETTLEMENT') {
      summary.pendingSettlementPaise += item.netPayablePaise;
      summary.totalEarnedPaise += item.netPayablePaise;
      summary.completedTripsCount += 1;
    } else if (item.status === 'ACCEPTED') {
      summary.activeAcceptedPaise += item.netPayablePaise;
    } else if (item.status === 'ON_HOLD' || item.status === 'DISPUTED') {
      summary.onHoldOrDisputedPaise += item.netPayablePaise;
    }
  }

  return { summary, earnings };
}

export async function listOwnerTier2Earnings(filters?: { status?: Tier2EarningStatus }) {
  const query: Record<string, unknown> = {};
  if (filters?.status) {
    query.status = filters.status;
  }

  const earnings = await Tier2Earning.find(query)
    .populate('driverUserId', 'name email phone')
    .populate('tripId', 'tripCode status completedAt')
    .populate('opportunityId', 'opportunityCode opportunityType originLabel destinationLabel')
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();

  const totals = {
    totalRecords: earnings.length,
    pendingSettlementPaise: 0,
    paidPaise: 0,
    onHoldPaise: 0,
    acceptedPaise: 0,
  };

  for (const item of earnings) {
    if (item.status === 'PAID') totals.paidPaise += item.netPayablePaise;
    else if (item.status === 'TRIP_COMPLETED' || item.status === 'PENDING_SETTLEMENT') {
      totals.pendingSettlementPaise += item.netPayablePaise;
    } else if (item.status === 'ON_HOLD' || item.status === 'DISPUTED') {
      totals.onHoldPaise += item.netPayablePaise;
    } else if (item.status === 'ACCEPTED') {
      totals.acceptedPaise += item.netPayablePaise;
    }
  }

  return { totals, earnings };
}
