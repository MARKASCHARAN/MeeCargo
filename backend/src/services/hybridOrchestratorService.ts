import crypto from 'node:crypto';
import { isValidObjectId, Types, type ClientSession } from 'mongoose';
import { z } from 'zod';
import { withTransaction } from '../config/database.js';
import { Corridor, type ICorridor } from '../models/Corridor.js';
import { DriverProfile, type IDriverProfile } from '../models/DriverProfile.js';
import { DriverSlotCommitment } from '../models/DriverSlotCommitment.js';
import {
  MarketplaceOpportunity,
  type IMarketplaceOpportunity,
  type MarketplaceOpportunityStatus,
} from '../models/MarketplaceOpportunity.js';
import type { MarketplaceOpportunityType } from '../models/MarketplacePolicy.js';
import { Payment } from '../models/Payment.js';
import { Pool, type IPool } from '../models/Pool.js';
import { Shipment, isValidShipmentTransition, type IShipment } from '../models/Shipment.js';
import { Slot } from '../models/Slot.js';
import { Trip, type ITrip } from '../models/Trip.js';
import { Vehicle, type IVehicle } from '../models/Vehicle.js';
import { HttpError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import {
  calculateCargoMetrics,
  type CargoCategory,
  type DimensionUnit,
  type WeightUnit,
} from './cargoCalculator.js';
import { getCoordinateRoadEstimate, getRoadDistanceMatrix } from './distanceMatrixService.js';
import { hasOverlappingDriverTrip } from './driverAssignment.js';
import { doesCargoFitVehicle } from './fleetAllocator.js';
import { sendLifecycleNotification } from './notificationService.js';
import { optimizeAndPlanTripRoute } from './routePlanningService.js';
import { addressSchema, haversineDistanceKm } from './shipmentService.js';
import {
  calculateDeterministicTier2Payout,
  calculateExpressCustomerQuotePaise,
  createAcceptedTier2Earning,
  getActiveMarketplacePolicy,
  holdOrReverseTier2Earning,
  type MarketplacePolicySnapshot,
} from './tier2PayoutService.js';

export const marketplaceCargoSchema = z.object({
  category: z.enum(['STANDARD_BOX', 'SACK_BAG', 'TEXTILE_ROLL', 'PALLET_BUNDLE', 'CUSTOM']),
  quantity: z.number().int().min(1).max(500),
  unitDimensions: z.object({
    length: z.number().positive(),
    width: z.number().positive(),
    height: z.number().positive(),
    unit: z.enum(['CM', 'IN', 'M']).default('CM'),
  }),
  unitActualWeight: z.number().positive(),
  weightUnit: z.enum(['KG', 'G']).default('KG'),
  stackable: z.boolean().default(true),
  handlingRestrictions: z.array(z.string().trim().max(40)).default([]),
  declaredContents: z.string().trim().min(2).max(200),
  handlingNotes: z.string().trim().max(300).optional(),
  irregularCargoNotes: z.string().trim().max(300).optional(),
});

export const expressBookingSchema = z
  .object({
    serviceType: z
      .enum(['EXPRESS_MARKETPLACE', 'NEW_ROUTE_MARKETPLACE'])
      .default('EXPRESS_MARKETPLACE'),
    returnTrip: z.any().optional(),
    twoWayDelivery: z.any().optional(),
    roundTrip: z.any().optional(),
    pickupStopCode: z.string().trim().min(2).max(16).default('EXP-PKP'),
    deliveryStopCode: z.string().trim().min(2).max(16).default('EXP-DRP'),
    pickupAddress: addressSchema,
    deliveryAddress: addressSchema,
    pickupContact: z
      .object({
        name: z.string().trim().min(2).max(120),
        phone: z.string().trim().min(8).max(20),
      })
      .optional(),
    recipientName: z.string().trim().min(2).max(120),
    recipientPhone: z.string().trim().min(8).max(20),
    cargo: marketplaceCargoSchema,
    requestedPickupStartAt: z.string().datetime().optional(),
    requestedPickupEndAt: z.string().datetime().optional(),
    requestedDeliveryDeadlineAt: z.string().datetime().optional(),
    simulatePaymentOutcome: z.enum(['SUCCESS', 'FAILED']).default('SUCCESS'),
    idempotencyKey: z.string().trim().max(120).optional(),
  })
  .passthrough();

export interface CargoEnvelope {
  totalWeightKg: number;
  totalVolumeCbm: number;
  maxUnitLengthCm: number;
  maxUnitWidthCm: number;
  maxUnitHeightCm: number;
  allStackable?: boolean;
  handlingRestrictions?: string[];
  requiresDryVan?: boolean;
}

function envelopeToFitInput(
  envelope: CargoEnvelope
): Array<Pick<IShipment, 'cargo'>> {
  return [
    {
      cargo: {
        category: 'CUSTOM',
        quantity: 1,
        unitDimensionsCm: {
          length: envelope.maxUnitLengthCm,
          width: envelope.maxUnitWidthCm,
          height: envelope.maxUnitHeightCm,
        },
        unitActualWeightKg: envelope.totalWeightKg,
        totalActualWeightKg: envelope.totalWeightKg,
        volumetricDivisor: 5000,
        volumetricWeightKg: envelope.totalWeightKg,
        chargeableWeightKg: envelope.totalWeightKg,
        billingBasis: 'ACTUAL',
        volumeCbm: envelope.totalVolumeCbm,
        stackable: envelope.allStackable ?? true,
        handlingRestrictions: envelope.handlingRestrictions ?? [],
        declaredContents: 'Marketplace batch cargo envelope',
      },
    },
  ];
}

function doesEnvelopeFitVehicle(
  vehicle: Pick<
    IVehicle,
    'maxWeightKg' | 'maxVolumeCbm' | 'bedDimensionsCm' | 'operatingRestrictions' | 'bodyType'
  >,
  envelope: CargoEnvelope
): { fits: boolean; reason?: string } {
  if (
    envelope.requiresDryVan &&
    vehicle.bodyType !== 'CLOSED_BODY' &&
    vehicle.bodyType !== 'CONTAINER'
  ) {
    return {
      fits: false,
      reason: `Closed/container body required for moisture-sensitive cargo (vehicle is ${vehicle.bodyType})`,
    };
  }
  const fit = doesCargoFitVehicle(envelopeToFitInput(envelope), vehicle);
  return { fits: fit.feasible, reason: fit.reason };
}

export type ExpressBookingInput = z.infer<typeof expressBookingSchema>;

export interface EligibleTier2Candidate {
  driverProfile: IDriverProfile;
  vehicle: IVehicle;
  approachDistanceKm: number;
}

export interface OpportunityCargoFitSummary {
  shipmentCount: number;
  totalWeightKg: number;
  totalVolumeCbm: number;
  maxUnitLengthCm: number;
  maxUnitWidthCm: number;
  maxUnitHeightCm: number;
  allStackable: boolean;
  handlingRestrictions: string[];
  requiredBodyTypes: string[];
  summaryLabel: string;
}

function summarizeShipmentsCargo(shipments: IShipment[]): {
  cargoEnvelope: CargoEnvelope;
  summary: OpportunityCargoFitSummary;
} {
  let totalWeightKg = 0;
  let totalVolumeCbm = 0;
  let maxUnitLengthCm = 1;
  let maxUnitWidthCm = 1;
  let maxUnitHeightCm = 1;
  let allStackable = true;
  const restrictionSet = new Set<string>();
  const labels: string[] = [];

  for (const s of shipments) {
    totalWeightKg += s.cargo.chargeableWeightKg;
    totalVolumeCbm += s.cargo.volumeCbm;
    maxUnitLengthCm = Math.max(maxUnitLengthCm, s.cargo.unitDimensionsCm.length);
    maxUnitWidthCm = Math.max(maxUnitWidthCm, s.cargo.unitDimensionsCm.width);
    maxUnitHeightCm = Math.max(maxUnitHeightCm, s.cargo.unitDimensionsCm.height);
    if (!s.cargo.stackable) allStackable = false;
    for (const tag of s.cargo.handlingRestrictions ?? []) {
      restrictionSet.add(tag.toUpperCase());
    }
    labels.push(`${s.cargo.quantity}x ${s.cargo.declaredContents}`);
  }

  const handlingRestrictions = Array.from(restrictionSet);
  const requiresDryVan =
    handlingRestrictions.includes('KEEP_DRY') ||
    handlingRestrictions.includes('MOISTURE_SENSITIVE');
  const requiredBodyTypes = requiresDryVan
    ? ['CLOSED_BODY', 'CONTAINER']
    : ['CLOSED_BODY', 'CONTAINER', 'OPEN_BODY', 'MINI_PICKUP', 'FLATBED'];

  return {
    cargoEnvelope: {
      totalWeightKg: Number(totalWeightKg.toFixed(2)),
      totalVolumeCbm: Number(totalVolumeCbm.toFixed(3)),
      maxUnitLengthCm,
      maxUnitWidthCm,
      maxUnitHeightCm,
      requiresDryVan,
    },
    summary: {
      shipmentCount: shipments.length,
      totalWeightKg: Number(totalWeightKg.toFixed(2)),
      totalVolumeCbm: Number(totalVolumeCbm.toFixed(3)),
      maxUnitLengthCm,
      maxUnitWidthCm,
      maxUnitHeightCm,
      allStackable,
      handlingRestrictions,
      requiredBodyTypes,
      summaryLabel: labels.slice(0, 3).join(', ') || `${shipments.length} shipment(s)`,
    },
  };
}

export function isVehicleDocumentationValid(vehicle: IVehicle, referenceDate: Date): boolean {
  if (vehicle.documents?.verificationStatus === 'REJECTED') {
    return false;
  }
  if (
    vehicle.documents?.insuranceValidUntil &&
    new Date(vehicle.documents.insuranceValidUntil) < referenceDate
  ) {
    return false;
  }
  if (
    vehicle.documents?.fitnessValidUntil &&
    new Date(vehicle.documents.fitnessValidUntil) < referenceDate
  ) {
    return false;
  }
  return true;
}

export async function verifyTier2DriverEligibility(params: {
  driverUserId: string | Types.ObjectId;
  now?: Date;
  windowStart?: Date;
  windowEnd?: Date;
  cargoEnvelope?: CargoEnvelope;
  session?: ClientSession | null;
}): Promise<{
  eligible: boolean;
  reason?: string;
  driverProfile?: IDriverProfile;
  vehicle?: IVehicle;
}> {
  const now = params.now ?? new Date();
  const driverProfile = await DriverProfile.findOne({
    userId: params.driverUserId,
  }).session(params.session ?? null);

  if (!driverProfile || driverProfile.fleetTier !== 'TIER_2') {
    return { eligible: false, reason: 'Driver profile is not an active Tier 2 marketplace profile' };
  }
  if (driverProfile.tier2ApplicationStatus !== 'APPROVED') {
    return {
      eligible: false,
      reason: `Tier 2 application status is ${driverProfile.tier2ApplicationStatus ?? 'PENDING'}; approval required`,
    };
  }
  if (driverProfile.accountStatus !== 'ACTIVE') {
    return {
      eligible: false,
      reason: `Driver account is ${driverProfile.accountStatus}`,
    };
  }
  if (driverProfile.availabilityStatus === 'OFFLINE') {
    return {
      eligible: false,
      reason: 'Driver is currently OFFLINE and unavailable for marketplace offers',
    };
  }
  if (!driverProfile.vehicleId) {
    return { eligible: false, reason: 'No registered Tier 2 vehicle linked to driver' };
  }

  const vehicle = await Vehicle.findOne({
    _id: driverProfile.vehicleId,
    tier: 'TIER_2',
  }).session(params.session ?? null);

  if (!vehicle) {
    return { eligible: false, reason: 'Linked Tier 2 vehicle record not found' };
  }
  if (vehicle.operationalStatus !== 'ACTIVE' || !vehicle.isAvailable) {
    return {
      eligible: false,
      reason: `Vehicle is ${vehicle.operationalStatus} / unavailable`,
    };
  }
  const docCheckDate = params.windowEnd && params.windowEnd > now ? params.windowEnd : now;
  if (!isVehicleDocumentationValid(vehicle, docCheckDate)) {
    return {
      eligible: false,
      reason: 'Vehicle insurance, fitness certificate, or verification status is expired or rejected',
    };
  }

  if (params.cargoEnvelope) {
    const fit = doesEnvelopeFitVehicle(vehicle, params.cargoEnvelope);
    if (!fit.fits) {
      return {
        eligible: false,
        reason: `Vehicle capacity mismatch: ${fit.reason}`,
      };
    }
  }

  if (params.windowStart && params.windowEnd) {
    const overlapsTrip = await hasOverlappingDriverTrip({
      driverId: driverProfile.userId,
      windowStart: params.windowStart,
      windowEnd: params.windowEnd,
      session: params.session ?? null,
    });
    if (overlapsTrip) {
      return {
        eligible: false,
        reason: 'Driver has an overlapping active trip during this service window',
      };
    }

    const overlapsCommitment = await DriverSlotCommitment.findOne({
      driverUserId: driverProfile.userId,
      status: { $in: ['COMMITTED', 'LOCKED', 'ALLOCATED'] },
      departureDate: {
        $gte: new Date(params.windowStart.getTime() - 12 * 3600_000),
        $lte: new Date(params.windowEnd.getTime() + 12 * 3600_000),
      },
    }).session(params.session ?? null);

    if (overlapsCommitment) {
      return {
        eligible: false,
        reason: 'Driver has a conflicting slot commitment around this service window',
      };
    }
  }

  return { eligible: true, driverProfile, vehicle };
}

export async function findEligibleTier2DriversForOpportunity(
  opp: IMarketplaceOpportunity,
  policy: MarketplacePolicySnapshot,
  now = new Date(),
  session?: ClientSession | null
): Promise<EligibleTier2Candidate[]> {
  const excludedSet = new Set(
    (opp.declinedOrExhaustedDriverIds ?? []).map((id) => String(id))
  );

  const profiles = await DriverProfile.find({
    fleetTier: 'TIER_2',
    tier2ApplicationStatus: 'APPROVED',
    accountStatus: 'ACTIVE',
    availabilityStatus: { $ne: 'OFFLINE' },
    vehicleId: { $exists: true, $ne: null },
  })
    .session(session ?? null)
    .limit(50);

  const cargoEnvelope: CargoEnvelope = {
    totalWeightKg: opp.cargoSummary.totalWeightKg,
    totalVolumeCbm: opp.cargoSummary.totalVolumeCbm,
    maxUnitLengthCm: opp.cargoSummary.maxUnitLengthCm,
    maxUnitWidthCm: opp.cargoSummary.maxUnitWidthCm,
    maxUnitHeightCm: opp.cargoSummary.maxUnitHeightCm,
    requiresDryVan: opp.cargoSummary.requiredBodyTypes?.includes('CLOSED_BODY') &&
      opp.cargoSummary.requiredBodyTypes?.length <= 2,
  };

  const candidates: EligibleTier2Candidate[] = [];
  for (const profile of profiles) {
    if (excludedSet.has(String(profile.userId))) continue;
    const check = await verifyTier2DriverEligibility({
      driverUserId: profile.userId,
      now,
      windowStart: opp.serviceWindowStartAt,
      windowEnd: opp.deliveryDeadlineAt,
      cargoEnvelope,
      session,
    });
    if (!check.eligible || !check.vehicle) continue;

    const approachMeters = getCoordinateRoadEstimate(
      check.vehicle.homeLocation.coordinates,
      opp.originLocation.coordinates
    ).meters;
    const approachDistanceKm = Number((approachMeters / 1000).toFixed(1));
    candidates.push({
      driverProfile: profile,
      vehicle: check.vehicle,
      approachDistanceKm,
    });
  }

  candidates.sort((a, b) => a.approachDistanceKm - b.approachDistanceKm);
  return candidates.slice(0, policy.maxActiveOffersPerOpportunity);
}

export async function dispatchOffersForOpportunity(params: {
  opportunityId: string | Types.ObjectId;
  now?: Date;
  session?: ClientSession | null;
}) {
  const now = params.now ?? new Date();
  const opp = await MarketplaceOpportunity.findById(params.opportunityId).session(
    params.session ?? null
  );
  if (!opp) {
    throw new HttpError(404, 'Marketplace opportunity not found', 'NOT_FOUND');
  }
  if (
    opp.status === 'ASSIGNED' ||
    opp.status === 'COMPLETED' ||
    opp.status === 'CANCELLED' ||
    opp.status === 'EXPIRED'
  ) {
    return { opportunity: opp, dispatchedCount: 0, deferred: false };
  }

  if (opp.earlyFillFirstRefusalUntil && now < opp.earlyFillFirstRefusalUntil) {
    opp.status = 'CREATED';
    await opp.save({ session: params.session ?? undefined });
    return {
      opportunity: opp,
      dispatchedCount: 0,
      deferred: true,
      deferredUntil: opp.earlyFillFirstRefusalUntil,
    };
  }

  const policy = await getActiveMarketplacePolicy(params.session);
  const candidates = await findEligibleTier2DriversForOpportunity(
    opp,
    policy,
    now,
    params.session
  );

  let dispatchedCount = 0;
  for (const candidate of candidates) {
    const alreadyOfferedInVersion = opp.offers.some(
      (o) =>
        String(o.driverUserId) === String(candidate.driverProfile.userId) &&
        o.offerVersion === opp.offerVersion &&
        (o.status === 'OFFERED' || o.status === 'VIEWED')
    );
    if (alreadyOfferedInVersion) continue;

    const quote = calculateDeterministicTier2Payout({
      opportunityType: opp.opportunityType,
      estimatedDistanceKm: opp.estimatedDistanceKm,
      totalWeightKg: opp.cargoSummary.totalWeightKg,
      totalVolumeCbm: opp.cargoSummary.totalVolumeCbm,
      bodyType: candidate.vehicle.bodyType,
      approachDistanceKm: candidate.approachDistanceKm,
      policy,
    });

    opp.offers.push({
      driverUserId: candidate.driverProfile.userId,
      vehicleId: candidate.vehicle._id,
      offerVersion: opp.offerVersion,
      status: 'OFFERED',
      spotPayoutPaise: quote.spotPayoutPaise,
      approachDistanceKm: candidate.approachDistanceKm,
      offeredAt: now,
      expiresAt: opp.offerExpiresAt,
    });
    dispatchedCount += 1;

    await sendLifecycleNotification({
      eventType: 'MARKETPLACE_OFFER',
      dedupeKey: `MKT_OFFER:${opp.opportunityCode}:v${opp.offerVersion}:${String(
        candidate.driverProfile.userId
      )}`,
      recipientUserId: candidate.driverProfile.userId,
      vars: {
        opportunityCode: opp.opportunityCode,
        opportunityType: opp.opportunityType,
        route: `${opp.originLabel} -> ${opp.destinationLabel}`,
        payout: `₹${(quote.spotPayoutPaise / 100).toFixed(2)}`,
        expiresAt: opp.offerExpiresAt.toISOString(),
      },
      metadata: {
        opportunityId: String(opp._id),
        opportunityType: opp.opportunityType,
        spotPayoutPaise: quote.spotPayoutPaise,
      },
    });
  }

  const prevStatus = opp.status;
  opp.status = opp.offers.some(
    (o) =>
      o.offerVersion === opp.offerVersion &&
      (o.status === 'OFFERED' || o.status === 'VIEWED')
  )
    ? 'OFFERED'
    : 'OPEN';

  if (prevStatus !== opp.status || dispatchedCount > 0) {
    opp.auditHistory.push({
      action: 'OFFERS_DISPATCHED',
      fromStatus: prevStatus,
      toStatus: opp.status,
      reason: `Dispatched ${dispatchedCount} eligible Tier 2 offer(s) at v${opp.offerVersion}`,
      at: now,
    });
  }

  await opp.save({ session: params.session ?? undefined });
  return { opportunity: opp, dispatchedCount, deferred: false };
}

export function redactOpportunityForDriver(
  opp: IMarketplaceOpportunity | Record<string, unknown>,
  viewerDriverUserId: string,
  shipments?: IShipment[]
) {
  const doc = opp as IMarketplaceOpportunity;
  const isAssignedToViewer =
    Boolean(doc.acceptedByDriverId) &&
    String(doc.acceptedByDriverId) === String(viewerDriverUserId);

  const driverOffers = (doc.offers ?? []).filter(
    (o) => String(o.driverUserId) === String(viewerDriverUserId)
  );
  const latestOffer = driverOffers.sort((a, b) => b.offerVersion - a.offerVersion)[0];
  const spotPayoutPaise = latestOffer?.spotPayoutPaise ?? doc.payoutQuote.spotPayoutPaise;

  return {
    id: String(doc._id),
    opportunityCode: doc.opportunityCode,
    opportunityType: doc.opportunityType,
    status: doc.status,
    offerVersion: doc.offerVersion,
    originLabel: doc.originLabel,
    destinationLabel: doc.destinationLabel,
    originStopCode: doc.originStopCode,
    deliveryStopCode: doc.deliveryStopCode,
    stopsSummary: doc.stopsSummary,
    serviceWindowStartAt: doc.serviceWindowStartAt,
    pickupDeadlineAt: doc.pickupDeadlineAt,
    deliveryDeadlineAt: doc.deliveryDeadlineAt,
    offerExpiresAt: doc.offerExpiresAt,
    earlyFillFirstRefusalUntil: doc.earlyFillFirstRefusalUntil,
    estimatedDistanceKm: doc.estimatedDistanceKm,
    estimatedDurationMin: doc.estimatedDurationMin,
    cargoSummary: doc.cargoSummary,
    payoutQuote: {
      ...doc.payoutQuote,
      spotPayoutPaise,
      tier1MinGuaranteeIncludedPaise: 0,
    },
    driverOfferStatus: latestOffer?.status ?? null,
    tripId: doc.tripId ? String(doc.tripId) : undefined,
    piiUnlocked: isAssignedToViewer,
    // Shipper & recipient phone/address are strictly hidden until driver accepts & assignment locks
    assignedStopContacts: isAssignedToViewer && shipments
      ? shipments.map((s) => ({
          shipmentId: String(s._id),
          reference: s.reference,
          pickupContact: s.pickupContact ?? null,
          pickupAddress: s.pickupAddress,
          recipientName: s.recipientName,
          recipientPhone: s.recipientPhone,
          deliveryAddress: s.deliveryAddress,
        }))
      : [],
  };
}

export async function listEligibleOpportunitiesForDriver(
  driverUserId: string,
  now = new Date()
) {
  const eligibility = await verifyTier2DriverEligibility({ driverUserId, now });
  if (!eligibility.eligible || !eligibility.vehicle) {
    return {
      eligible: false,
      ineligibilityReason: eligibility.reason,
      opportunities: [],
    };
  }

  const driverObjId = new Types.ObjectId(driverUserId);
  const openOpps = await MarketplaceOpportunity.find({
    status: { $in: ['OPEN', 'OFFERED', 'REASSIGNING'] },
    offerExpiresAt: { $gt: now },
    declinedOrExhaustedDriverIds: { $ne: driverObjId },
    $or: [
      { earlyFillFirstRefusalUntil: { $exists: false } },
      { earlyFillFirstRefusalUntil: null },
      { earlyFillFirstRefusalUntil: { $lte: now } },
    ],
  }).sort({ serviceWindowStartAt: 1, createdAt: -1 });

  const matched = [];
  for (const opp of openOpps) {
    const cargoEnvelope: CargoEnvelope = {
      totalWeightKg: opp.cargoSummary.totalWeightKg,
      totalVolumeCbm: opp.cargoSummary.totalVolumeCbm,
      maxUnitLengthCm: opp.cargoSummary.maxUnitLengthCm,
      maxUnitWidthCm: opp.cargoSummary.maxUnitWidthCm,
      maxUnitHeightCm: opp.cargoSummary.maxUnitHeightCm,
      requiresDryVan:
        opp.cargoSummary.requiredBodyTypes?.includes('CLOSED_BODY') &&
        opp.cargoSummary.requiredBodyTypes.length <= 2,
    };
    const check = await verifyTier2DriverEligibility({
      driverUserId,
      now,
      windowStart: opp.serviceWindowStartAt,
      windowEnd: opp.deliveryDeadlineAt,
      cargoEnvelope,
    });
    if (check.eligible) {
      matched.push(redactOpportunityForDriver(opp, driverUserId));
    }
  }

  return {
    eligible: true,
    opportunities: matched,
  };
}

export async function viewMarketplaceOffer(params: {
  opportunityId: string;
  driverUserId: string;
}) {
  const now = new Date();
  const opp = await MarketplaceOpportunity.findById(params.opportunityId);
  if (!opp) {
    throw new HttpError(404, 'Marketplace opportunity not found', 'NOT_FOUND');
  }

  const eligibility = await verifyTier2DriverEligibility({
    driverUserId: params.driverUserId,
    now,
  });
  if (!eligibility.eligible) {
    throw new HttpError(
      403,
      eligibility.reason ?? 'Not eligible for Tier 2 marketplace offers',
      'TIER2_NOT_ELIGIBLE'
    );
  }

  const offer = opp.offers.find(
    (o) =>
      String(o.driverUserId) === params.driverUserId &&
      o.offerVersion === opp.offerVersion &&
      o.status === 'OFFERED'
  );
  if (offer) {
    offer.status = 'VIEWED';
    offer.viewedAt = now;
    await opp.save();
  }

  const shipments =
    opp.acceptedByDriverId && String(opp.acceptedByDriverId) === params.driverUserId
      ? await Shipment.find({ _id: { $in: opp.shipmentIds } })
      : undefined;

  return redactOpportunityForDriver(opp, params.driverUserId, shipments);
}

export async function evaluatePoolForMarketplaceOpportunities(params: {
  poolId: string;
  actorUserId?: string;
  now?: Date;
  triggerType?: 'OVERFLOW' | 'RIGHT_SIZING';
  session?: ClientSession | null;
}) {
  const now = params.now ?? new Date();
  const pool = await Pool.findById(params.poolId).session(params.session ?? null);
  if (!pool) {
    throw new HttpError(404, 'Pool not found', 'POOL_NOT_FOUND');
  }

  const policy = await getActiveMarketplacePolicy(params.session);
  const corridor = await Corridor.findById(pool.corridorId).session(params.session ?? null);
  const slot = await Slot.findById(pool.slotId).session(params.session ?? null);
  if (!corridor || !slot) {
    throw new HttpError(404, 'Corridor or slot not found for pool', 'NOT_FOUND');
  }

  const shipments = await Shipment.find({ _id: { $in: pool.shipmentIds } }).session(
    params.session ?? null
  );
  if (shipments.length === 0) {
    return { created: false, reason: 'No shipments in pool' };
  }

  const existingTrip = await Trip.findOne({ poolId: pool._id }).session(params.session ?? null);
  const requestedType: MarketplaceOpportunityType = params.triggerType ?? 'OVERFLOW';

  if (!policy.enabledOpportunityTypes.includes(requestedType)) {
    return {
      created: false,
      reason: `Policy disables marketplace opportunity type ${requestedType}`,
    };
  }

  const { summary } = summarizeShipmentsCargo(shipments);

  if (requestedType === 'OVERFLOW') {
    if (existingTrip) {
      return {
        created: false,
        reason: 'Pool is already fulfilled by a Tier 1 trip; overflow not triggered',
      };
    }

    const totalChargeableKg = shipments.reduce(
      (sum, s) => sum + s.cargo.chargeableWeightKg,
      0
    );
    if (
      totalChargeableKg < policy.overflowMinChargeableWeightKg &&
      summary.totalVolumeCbm < policy.overflowMinVolumeCbm
    ) {
      return {
        created: false,
        reason: 'Pool cargo below minimum Tier 2 overflow dispatch threshold',
      };
    }
  }

  const sourceDemandKey = `${requestedType}:POOL:${String(pool._id)}`;
  const existingOpp = await MarketplaceOpportunity.findOne({
    sourceDemandKey,
    status: { $nin: ['EXPIRED', 'CANCELLED', 'FAILED'] },
  }).session(params.session ?? null);
  if (existingOpp) {
    return {
      created: false,
      duplicate: true,
      opportunity: existingOpp,
      reason: 'Active marketplace opportunity already exists for this pool demand',
    };
  }

  const orderedStops = [...corridor.stops].sort((a, b) => a.sequenceOrder - b.sequenceOrder);
  const originStop = orderedStops[0];
  const destStop = orderedStops[orderedStops.length - 1];
  const corridorMeters =
    originStop && destStop
      ? getCoordinateRoadEstimate(
          originStop.location.coordinates,
          destStop.location.coordinates
        ).meters
      : 115000;
  const estimatedDistanceKm = Math.max(25, Math.round(corridorMeters / 1000));
  const estimatedDurationMin = Math.round((estimatedDistanceKm / 45) * 60);

  if (requestedType === 'RIGHT_SIZING') {
    if (!existingTrip) {
      return {
        created: false,
        reason: 'Right-sizing comparison requires an existing Tier 1 allocation baseline',
      };
    }
    const t1Commitment = existingTrip.sourceCommitmentId
      ? await DriverSlotCommitment.findById(existingTrip.sourceCommitmentId).session(
          params.session ?? null
        )
      : null;
    if (t1Commitment && t1Commitment.status === 'ALLOCATED') {
      return {
        created: false,
        reason:
          'Locked Tier 1 driver commitment is protected and cannot be displaced by Tier 2 right-sizing',
      };
    }
    const candidateQuote = calculateDeterministicTier2Payout({
      opportunityType: 'RIGHT_SIZING',
      estimatedDistanceKm,
      totalWeightKg: summary.totalWeightKg,
      totalVolumeCbm: summary.totalVolumeCbm,
      policy,
    });
    const tier1CostWithGuarantee =
      (existingTrip.allocationEconomics?.estimatedVehiclePayoutPaise ?? 0) +
      (existingTrip.allocationEconomics?.tier1MinGuaranteeIncludedPaise ?? 0);
    const netSavings = tier1CostWithGuarantee - candidateQuote.spotPayoutPaise;
    if (netSavings < policy.rightSizingMinNetSavingsPaise) {
      return {
        created: false,
        reason: `Right-sizing net savings ₹${(netSavings / 100).toFixed(2)} below policy minimum ₹${(
          policy.rightSizingMinNetSavingsPaise / 100
        ).toFixed(2)} (preserving Tier 1 guarantees)`,
      };
    }
  }

  // Enforce Early-Fill Tier 1 First-Right-of-Refusal Window if before cutoff and uncommitted Tier 1 vehicles exist
  let earlyFillFirstRefusalUntil: Date | undefined;
  if (policy.earlyFillFirstRefusalMin > 0 && slot.cutoffAt > now) {
    const corridorTier1Count = await Vehicle.countDocuments({
      tier: 'TIER_1',
      operationalStatus: 'ACTIVE',
      isAvailable: true,
      contractedCorridorIds: corridor._id,
    }).session(params.session ?? null);

    const committedCount = await DriverSlotCommitment.countDocuments({
      slotId: slot._id,
      status: { $in: ['COMMITTED', 'LOCKED', 'ALLOCATED'] },
    }).session(params.session ?? null);

    if (corridorTier1Count > committedCount) {
      const windowEnd = new Date(
        Math.min(
          slot.cutoffAt.getTime(),
          now.getTime() + policy.earlyFillFirstRefusalMin * 60_000
        )
      );
      if (windowEnd > now) {
        earlyFillFirstRefusalUntil = windowEnd;
      }
    }
  }

  const payoutQuote = calculateDeterministicTier2Payout({
    opportunityType: requestedType,
    estimatedDistanceKm,
    totalWeightKg: summary.totalWeightKg,
    totalVolumeCbm: summary.totalVolumeCbm,
    policy,
  });

  const offerExpiresAt = new Date(
    Math.min(
      slot.plannedDepartureAt.getTime(),
      (earlyFillFirstRefusalUntil ?? now).getTime() + policy.offerExpiryMin * 60_000
    )
  );
  const safeExpiresAt =
    offerExpiresAt > now ? offerExpiresAt : new Date(now.getTime() + policy.offerExpiryMin * 60_000);

  const [createdOpp] = await MarketplaceOpportunity.create(
    [
      {
        opportunityCode: `MKT-${requestedType.slice(0, 3)}-${crypto
          .randomBytes(3)
          .toString('hex')
          .toUpperCase()}`,
        opportunityType: requestedType,
        status: earlyFillFirstRefusalUntil ? 'CREATED' : 'OPEN',
        offerVersion: 1,
        sourceDemandKey,
        corridorId: corridor._id,
        sourcePoolId: pool._id,
        sourceSlotId: slot._id,
        shipmentIds: shipments.map((s) => s._id),
        originLabel: originStop?.name ?? 'Origin Hub',
        destinationLabel: destStop?.name ?? 'Destination Hub',
        originStopCode: originStop?.stopCode ?? 'ORIG',
        deliveryStopCode: destStop?.stopCode ?? 'DEST',
        originLocation: originStop.location,
        destinationLocation: destStop.location,
        stopsSummary: orderedStops.map((s) => ({
          stopCode: s.stopCode,
          name: s.name,
          sequenceOrder: s.sequenceOrder,
        })),
        serviceWindowStartAt: slot.plannedDepartureAt,
        pickupDeadlineAt: slot.plannedDepartureAt,
        deliveryDeadlineAt: slot.estimatedArrivalEndAt,
        ...(earlyFillFirstRefusalUntil ? { earlyFillFirstRefusalUntil } : {}),
        offerExpiresAt: safeExpiresAt,
        cargoSummary: summary,
        estimatedDistanceKm,
        estimatedDurationMin,
        payoutQuote,
        offers: [],
        declinedOrExhaustedDriverIds: [],
        orchestrationReason: earlyFillFirstRefusalUntil
          ? `Tier 1 early-fill first refusal window until ${earlyFillFirstRefusalUntil.toISOString()}`
          : `Triggered ${requestedType} marketplace opportunity from pool ${pool.poolCode}`,
        auditHistory: [
          {
            action: 'OPPORTUNITY_CREATED_FROM_POOL',
            toStatus: earlyFillFirstRefusalUntil ? 'CREATED' : 'OPEN',
            ...(params.actorUserId && isValidObjectId(params.actorUserId)
              ? { actorUserId: new Types.ObjectId(params.actorUserId) }
              : {}),
            reason: earlyFillFirstRefusalUntil
              ? `Held for Tier 1 early-fill first refusal until ${earlyFillFirstRefusalUntil.toISOString()}`
              : `Triggered ${requestedType} marketplace opportunity from pool ${pool.poolCode}`,
            at: now,
          },
        ],
      },
    ],
    { session: params.session ?? undefined }
  );

  if (!earlyFillFirstRefusalUntil) {
    await dispatchOffersForOpportunity({
      opportunityId: createdOpp._id,
      now,
      session: params.session,
    });
  }

  return {
    created: true,
    deferredByTier1Refusal: Boolean(earlyFillFirstRefusalUntil),
    opportunity: createdOpp,
  };
}

export async function acceptMarketplaceOpportunityAtomic(params: {
  opportunityId: string;
  driverUserId: string;
}) {
  if (!isValidObjectId(params.opportunityId)) {
    throw new HttpError(400, 'Invalid opportunityId', 'VALIDATION_ERROR');
  }

  const now = new Date();
  const driverObjId = new Types.ObjectId(params.driverUserId);
  let txResult: {
    opportunity: IMarketplaceOpportunity;
    trip: ITrip;
    earning: Awaited<ReturnType<typeof createAcceptedTier2Earning>>;
  };

  try {
    const res = await withTransaction(async (session) => {
      const existing = await MarketplaceOpportunity.findById(params.opportunityId).session(session);
    if (!existing) {
      throw new HttpError(404, 'Marketplace opportunity not found', 'NOT_FOUND');
    }
    if (existing.earlyFillFirstRefusalUntil && now < existing.earlyFillFirstRefusalUntil) {
      throw new HttpError(
        409,
        'Early-fill Tier 1 first-right-of-refusal window is still active for this pool.',
        'EARLY_FILL_TIER1_WINDOW_ACTIVE'
      );
    }
    if (existing.offerExpiresAt <= now || existing.status === 'EXPIRED') {
      throw new HttpError(410, 'Marketplace offer window has expired', 'OFFER_EXPIRED');
    }
    if (existing.status === 'ASSIGNED' || existing.acceptedByDriverId) {
      throw new HttpError(
        409,
        'Marketplace opportunity has already been claimed by another driver',
        'ALREADY_ASSIGNED'
      );
    }
    if ((existing.declinedOrExhaustedDriverIds ?? []).some((id) => String(id) === params.driverUserId)) {
      throw new HttpError(
        409,
        'You previously declined or were unassigned from this opportunity version',
        'DRIVER_DECLINED_OPPORTUNITY'
      );
    }

    const cargoEnvelope: CargoEnvelope = {
      totalWeightKg: existing.cargoSummary.totalWeightKg,
      totalVolumeCbm: existing.cargoSummary.totalVolumeCbm,
      maxUnitLengthCm: existing.cargoSummary.maxUnitLengthCm,
      maxUnitWidthCm: existing.cargoSummary.maxUnitWidthCm,
      maxUnitHeightCm: existing.cargoSummary.maxUnitHeightCm,
      requiresDryVan:
        existing.cargoSummary.requiredBodyTypes?.includes('CLOSED_BODY') &&
        existing.cargoSummary.requiredBodyTypes.length <= 2,
    };

    const eligibility = await verifyTier2DriverEligibility({
      driverUserId: params.driverUserId,
      now,
      windowStart: existing.serviceWindowStartAt,
      windowEnd: existing.deliveryDeadlineAt,
      cargoEnvelope,
      session,
    });
    if (!eligibility.eligible || !eligibility.vehicle || !eligibility.driverProfile) {
      throw new HttpError(
        403,
        eligibility.reason ?? 'Driver or vehicle not eligible for this opportunity',
        'TIER2_NOT_ELIGIBLE'
      );
    }

    const policy = await getActiveMarketplacePolicy(session);
    const matchingOffer = existing.offers.find(
      (o) =>
        String(o.driverUserId) === params.driverUserId &&
        o.offerVersion === existing.offerVersion
    );
    const approachKm =
      matchingOffer?.approachDistanceKm ??
      Number(
        (
          getCoordinateRoadEstimate(
            eligibility.vehicle.homeLocation.coordinates,
            existing.originLocation.coordinates
          ).meters / 1000
        ).toFixed(1)
      );
    const finalQuote =
      matchingOffer?.spotPayoutPaise !== undefined
        ? { ...existing.payoutQuote, spotPayoutPaise: matchingOffer.spotPayoutPaise }
        : calculateDeterministicTier2Payout({
            opportunityType: existing.opportunityType,
            estimatedDistanceKm: existing.estimatedDistanceKm,
            totalWeightKg: existing.cargoSummary.totalWeightKg,
            totalVolumeCbm: existing.cargoSummary.totalVolumeCbm,
            bodyType: eligibility.vehicle.bodyType,
            approachDistanceKm: approachKm,
            policy,
          });

    // Atomic conditional transition: ONLY succeeds for the winning concurrent driver!
    const claimed = await MarketplaceOpportunity.findOneAndUpdate(
      {
        _id: existing._id,
        status: { $in: ['OPEN', 'OFFERED', 'REASSIGNING'] },
        acceptedByDriverId: { $exists: false },
        offerExpiresAt: { $gt: now },
        declinedOrExhaustedDriverIds: { $ne: driverObjId },
      },
      {
        $set: {
          status: 'ASSIGNED',
          acceptedByDriverId: driverObjId,
          acceptedVehicleId: eligibility.vehicle._id,
          acceptedAt: now,
          'payoutQuote.spotPayoutPaise': finalQuote.spotPayoutPaise,
        },
        $push: {
          auditHistory: {
            action: 'OFFER_ACCEPTED_ATOMICALLY',
            fromStatus: existing.status,
            toStatus: 'ASSIGNED',
            actorUserId: driverObjId,
            reason: `Claimed by Tier 2 driver ${eligibility.driverProfile.name} (${eligibility.vehicle.registrationNumber}) for ₹${(
              finalQuote.spotPayoutPaise / 100
            ).toFixed(2)}`,
            at: now,
          },
        },
      },
      { returnDocument: 'after', session }
    );

    if (!claimed) {
      throw new HttpError(
        409,
        'Marketplace opportunity is no longer available (already claimed or expired)',
        'ALREADY_ASSIGNED'
      );
    }

    // Update individual offer statuses in claimed doc
    let hadOffer = false;
    for (const o of claimed.offers) {
      if (String(o.driverUserId) === params.driverUserId && o.offerVersion === claimed.offerVersion) {
        o.status = 'ACCEPTED';
        o.respondedAt = now;
        hadOffer = true;
      } else if (o.status === 'OFFERED' || o.status === 'VIEWED') {
        o.status = 'REVOKED';
        o.respondedAt = now;
      }
    }
    if (!hadOffer) {
      claimed.offers.push({
        driverUserId: driverObjId,
        vehicleId: eligibility.vehicle._id,
        offerVersion: claimed.offerVersion,
        status: 'ACCEPTED',
        spotPayoutPaise: finalQuote.spotPayoutPaise,
        approachDistanceKm: approachKm,
        offeredAt: now,
        respondedAt: now,
        expiresAt: claimed.offerExpiresAt,
      });
    }

    // Create linked Trip (one trip per active assignment)
    const tripCode = `MC-T2-${now.toISOString().slice(0, 10).replace(/-/g, '')}-${crypto
      .randomBytes(2)
      .toString('hex')
      .toUpperCase()}`;

    const trip = new Trip({
      tripCode,
      ...(claimed.sourcePoolId ? { poolId: claimed.sourcePoolId } : {}),
      ...(claimed.corridorId ? { corridorId: claimed.corridorId } : {}),
      ...(claimed.sourceSlotId ? { slotId: claimed.sourceSlotId } : {}),
      marketplaceOpportunityId: claimed._id,
      vehicleId: eligibility.vehicle._id,
      driverId: driverObjId,
      shipmentIds: claimed.shipmentIds,
      status: 'DRIVER_ACCEPTED',
      scheduleSnapshot: {
        serviceDate: claimed.serviceWindowStartAt,
        slotCode: claimed.opportunityCode,
        slotLabel: `${claimed.opportunityType} (${claimed.originStopCode}->${claimed.deliveryStopCode})`,
        outboundPickupTime: claimed.serviceWindowStartAt.toISOString().slice(11, 16),
        selectedReturnTime: claimed.deliveryDeadlineAt.toISOString().slice(11, 16),
        returnTimeLocked: true,
      },
      vehicleSnapshot: {
        registrationNumber: eligibility.vehicle.registrationNumber,
        vehicleClass: eligibility.vehicle.vehicleClass,
        bodyType: eligibility.vehicle.bodyType,
        maxWeightKg: eligibility.vehicle.maxWeightKg,
        maxVolumeCbm: eligibility.vehicle.maxVolumeCbm,
        bedDimensionsCm: eligibility.vehicle.bedDimensionsCm,
        ownershipType: eligibility.vehicle.ownershipType,
      },
      plannedDepartureAt: claimed.serviceWindowStartAt,
      estimatedEndAt: claimed.deliveryDeadlineAt,
      driverRespondedAt: now,
      stopsSummary: claimed.stopsSummary,
      allocationEconomics: {
        allocatedTier: 'TIER_2',
        tier1MinGuaranteeIncludedPaise: 0,
        selectedVehicleMinGuaranteePaise: 0,
        estimatedDistanceKm: claimed.estimatedDistanceKm,
        estimatedVehiclePayoutPaise: finalQuote.spotPayoutPaise,
        rightSized: claimed.opportunityType === 'RIGHT_SIZING',
        reason: `Fixed Tier 2 spot payout for ${claimed.opportunityType} (${claimed.opportunityCode})`,
      },
      assignmentHistory: [
        {
          driverId: driverObjId,
          vehicleId: eligibility.vehicle._id,
          action: 'ACCEPTED',
          reason: `Accepted marketplace opportunity ${claimed.opportunityCode}`,
          actorUserId: driverObjId,
          at: now,
        },
      ],
      notes: `Tier 2 ${claimed.opportunityType} job ${claimed.opportunityCode}`,
    });
    await trip.save({ session: session ?? undefined });

    claimed.tripId = trip._id;
    await claimed.save({ session });

    // Create snapshotted Tier 2 earning ledger entry immediately on accept
    const earning = await createAcceptedTier2Earning({
      opportunityId: claimed._id,
      tripId: trip._id,
      driverUserId: driverObjId,
      vehicleId: eligibility.vehicle._id,
      opportunityType: claimed.opportunityType,
      grossPayoutPaise: finalQuote.spotPayoutPaise,
      policyVersion: finalQuote.policyVersion,
      actorUserId: driverObjId,
      session,
    });

    // Attach shipments to the new Trip & lock them for execution
    const shipments = await Shipment.find({ _id: { $in: claimed.shipmentIds } }).session(session);
    for (const s of shipments) {
      s.tripId = trip._id;
      s.marketplaceOpportunityId = claimed._id;
      s.viabilityDecision = 'NONE';
      if (s.status !== 'LOCKED' && isValidShipmentTransition(s.status, 'LOCKED')) {
        s.status = 'LOCKED';
        s.statusHistory.push({
          status: 'LOCKED',
          at: now,
          actorUserId: driverObjId,
          note: `Assigned to Tier 2 marketplace trip ${trip.tripCode}`,
        });
      }
      await s.save({ session });
    }

    if (claimed.sourcePoolId) {
      await Pool.updateOne(
        { _id: claimed.sourcePoolId, status: { $in: ['AWAITING_VIABILITY_DECISION', 'OPEN'] } },
        {
          $set: {
            status: 'LOCKED',
            viabilityStatus: 'PASSED',
            viabilityReason: `Fulfilled via Tier 2 ${claimed.opportunityType} trip ${trip.tripCode}`,
          },
        }
      ).session(session ?? null);
    }

    return { opportunity: claimed, trip, earning };
    });
    txResult = res;
  } catch (err: unknown) {
    const isWriteConflict =
      typeof err === 'object' &&
      err !== null &&
      ('code' in err && ((err as { code?: number }).code === 112 || (err as { code?: number }).code === 11000));
    if (isWriteConflict) {
      throw new HttpError(
        409,
        'Marketplace opportunity was simultaneously claimed by another driver',
        'ALREADY_ASSIGNED'
      );
    }
    throw err;
  }

  // Optimize route & build LIFO loading plan post-commit (works for both corridor & non-corridor trips via MC-079)
  try {
    await optimizeAndPlanTripRoute({
      tripId: String(txResult.trip._id),
      actorUserId: params.driverUserId,
    });
    const refreshedTrip = await Trip.findById(txResult.trip._id);
    if (refreshedTrip) {
      txResult.trip = refreshedTrip;
    }
  } catch (err) {
    logger.warn('[HybridOrchestrator] Route/LIFO auto-planning skipped after accept', {
      tripId: String(txResult.trip._id),
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return txResult;
}

export async function declineMarketplaceOffer(params: {
  opportunityId: string;
  driverUserId: string;
  reason?: string;
}) {
  const now = new Date();
  const opp = await MarketplaceOpportunity.findById(params.opportunityId);
  if (!opp) {
    throw new HttpError(404, 'Marketplace opportunity not found', 'NOT_FOUND');
  }
  if (opp.status === 'ASSIGNED' || opp.status === 'COMPLETED') {
    throw new HttpError(409, 'Opportunity is already assigned or completed', 'INVALID_STATE');
  }

  const driverObjId = new Types.ObjectId(params.driverUserId);
  if (!opp.declinedOrExhaustedDriverIds.some((id) => String(id) === params.driverUserId)) {
    opp.declinedOrExhaustedDriverIds.push(driverObjId);
  }
  for (const offer of opp.offers) {
    if (String(offer.driverUserId) === params.driverUserId && offer.offerVersion === opp.offerVersion) {
      offer.status = 'DECLINED';
      offer.respondedAt = now;
      offer.declineReason = params.reason?.trim() || 'Declined by driver';
    }
  }
  opp.auditHistory.push({
    action: 'OFFER_DECLINED_BY_DRIVER',
    fromStatus: opp.status,
    toStatus: opp.status,
    actorUserId: driverObjId,
    reason: params.reason?.trim() || 'Driver declined offer',
    at: now,
  });
  await opp.save();

  // Attempt re-dispatch to any other eligible Tier 2 drivers
  await dispatchOffersForOpportunity({ opportunityId: opp._id, now });
  return { opportunity: opp, declined: true };
}

export async function handleTier2CancellationOrBreakdownReassignment(params: {
  opportunityId?: string;
  tripId?: string;
  reason: string;
  actorUserId?: string;
}) {
  const now = new Date();
  const opp = params.opportunityId
    ? await MarketplaceOpportunity.findById(params.opportunityId)
    : params.tripId
      ? await MarketplaceOpportunity.findOne({ tripId: new Types.ObjectId(params.tripId) })
      : null;

  if (!opp) {
    throw new HttpError(404, 'Marketplace opportunity for reassignment not found', 'NOT_FOUND');
  }
  if (opp.status === 'COMPLETED' || opp.status === 'CANCELLED') {
    throw new HttpError(409, `Cannot reassign opportunity in status ${opp.status}`, 'INVALID_STATE');
  }

  const oldTripId = opp.tripId;
  const oldDriverId = opp.acceptedByDriverId;

  if (oldTripId) {
    await Trip.updateOne(
      { _id: oldTripId, status: { $in: ['ASSIGNED', 'DRIVER_ACCEPTED', 'PAUSED', 'IN_PROGRESS'] } },
      {
        $set: {
          status: 'DRIVER_REJECTED',
          notes: `Reassigned to marketplace: ${params.reason}`,
        },
        $push: {
          assignmentHistory: {
            driverId: oldDriverId,
            vehicleId: opp.acceptedVehicleId,
            action: 'REASSIGNED',
            reason: params.reason,
            ...(params.actorUserId && isValidObjectId(params.actorUserId)
              ? { actorUserId: new Types.ObjectId(params.actorUserId) }
              : {}),
            at: now,
          },
        },
      }
    );

    await holdOrReverseTier2Earning({
      tripId: oldTripId,
      action: 'REVERSE',
      reason: `Trip released for reassignment: ${params.reason}`,
      actorUserId:
        params.actorUserId && isValidObjectId(params.actorUserId)
          ? new Types.ObjectId(params.actorUserId)
          : undefined,
    });
  }

  if (oldDriverId && !opp.declinedOrExhaustedDriverIds.some((id) => id.equals(oldDriverId))) {
    opp.declinedOrExhaustedDriverIds.push(oldDriverId);
  }
  if (oldDriverId) {
    await DriverProfile.updateOne(
      { userId: oldDriverId, availabilityStatus: 'ON_TRIP' },
      { $set: { availabilityStatus: 'AVAILABLE' } }
    );
  }

  const prevStatus = opp.status;
  opp.status = 'REASSIGNING';
  opp.offerVersion += 1;
  opp.acceptedByDriverId = undefined;
  opp.acceptedVehicleId = undefined;
  opp.acceptedAt = undefined;
  opp.tripId = undefined;

  const policy = await getActiveMarketplacePolicy();
  opp.offerExpiresAt = new Date(
    Math.max(opp.offerExpiresAt.getTime(), now.getTime() + policy.offerExpiryMin * 60_000)
  );
  opp.auditHistory.push({
    action: 'REASSIGNMENT_TRIGGERED',
    fromStatus: prevStatus,
    toStatus: 'REASSIGNING',
    ...(params.actorUserId && isValidObjectId(params.actorUserId)
      ? { actorUserId: new Types.ObjectId(params.actorUserId) }
      : {}),
    reason: params.reason,
    at: now,
  });

  await opp.save();

  // Re-dispatch automatically to next eligible Tier 2 drivers without creating duplicate Trips
  const dispatched = await dispatchOffersForOpportunity({ opportunityId: opp._id, now });
  return {
    opportunity: dispatched.opportunity,
    reassignedFromTripId: oldTripId ? String(oldTripId) : undefined,
    dispatchedCount: dispatched.dispatchedCount,
  };
}

async function initiateAutomaticExpressUnfilledRefund(
  opp: IMarketplaceOpportunity,
  reason: string
) {
  const shipments = await Shipment.find({ _id: { $in: opp.shipmentIds } });
  for (const shipment of shipments) {
    const existingRefund = await Payment.findOne({
      shipmentId: shipment._id,
      type: 'REFUND',
      status: 'REFUNDED',
    });
    if (!existingRefund) {
      const paidPayments = await Payment.find({
        shipmentId: shipment._id,
        type: 'TOKEN',
        status: 'SUCCESS',
      });
      const totalPaid = paidPayments.reduce((sum, p) => sum + p.amountPaise, 0);
      if (totalPaid > 0) {
        const refundRef = `SIM-EXP-REF-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
        await Payment.create({
          shipmentId: shipment._id,
          businessId: shipment.businessId,
          type: 'REFUND',
          amountPaise: totalPaid,
          status: 'REFUNDED',
          mode: 'SIMULATED',
          isSimulated: true,
          providerRef: refundRef,
          refundReference: refundRef,
          refundReason: reason,
          processedAt: new Date(),
        });
        await Payment.updateMany(
          { _id: { $in: paidPayments.map((p) => p._id) } },
          { $set: { status: 'REFUNDED', refundReference: refundRef, refundReason: reason } }
        );
      }
    }

    shipment.tokenStatus = 'REFUNDED';
    shipment.viabilityDecision = 'REFUND_REQUESTED';
    if (isValidShipmentTransition(shipment.status, 'CANCELLED')) {
      shipment.status = 'CANCELLED';
    }
    shipment.statusHistory.push({
      status: shipment.status,
      at: new Date(),
      actorUserId: shipment.createdByUserId,
      note: reason,
    });
    await shipment.save();

    await sendLifecycleNotification({
      eventType: 'EXPRESS_UNFILLED',
      dedupeKey: `EXPRESS_UNFILLED:${String(shipment._id)}`,
      recipientUserId: shipment.createdByUserId,
      vars: {
        reference: shipment.reference,
        refundRef: reason,
      },
      metadata: { opportunityCode: opp.opportunityCode },
    });
  }
}

export async function processExpiredMarketplaceOpportunities(now = new Date()) {
  const summary = {
    promotedEarlyFillCount: 0,
    expiredOpportunitiesCount: 0,
    refundedExpressCount: 0,
  };

  // 1. Release opportunities whose early-fill Tier 1 first-right-of-refusal window has elapsed
  const readyCreated = await MarketplaceOpportunity.find({
    status: 'CREATED',
    earlyFillFirstRefusalUntil: { $lte: now },
    offerExpiresAt: { $gt: now },
  });
  for (const opp of readyCreated) {
    opp.earlyFillFirstRefusalUntil = undefined;
    opp.status = 'OPEN';
    opp.auditHistory.push({
      action: 'TIER1_REFUSAL_WINDOW_ELAPSED',
      fromStatus: 'CREATED',
      toStatus: 'OPEN',
      reason: 'Early-fill Tier 1 refusal window expired; opening to Tier 2 marketplace',
      at: now,
    });
    await opp.save();
    await dispatchOffersForOpportunity({ opportunityId: opp._id, now });
    summary.promotedEarlyFillCount += 1;
  }

  // 2. Expire opportunities past offerExpiresAt without an active acceptance
  const expiredOpps = await MarketplaceOpportunity.find({
    status: { $in: ['CREATED', 'OPEN', 'OFFERED', 'REASSIGNING'] },
    offerExpiresAt: { $lte: now },
    acceptedByDriverId: { $exists: false },
  });

  for (const opp of expiredOpps) {
    const prev = opp.status;
    opp.status = 'EXPIRED';
    for (const offer of opp.offers) {
      if (offer.status === 'OFFERED' || offer.status === 'VIEWED') {
        offer.status = 'EXPIRED';
      }
    }
    opp.auditHistory.push({
      action: 'OFFER_WINDOW_EXPIRED',
      fromStatus: prev,
      toStatus: 'EXPIRED',
      reason: `Marketplace opportunity ${opp.opportunityCode} expired unfilled at ${now.toISOString()}`,
      at: now,
    });
    await opp.save();
    summary.expiredOpportunitiesCount += 1;

    if (opp.opportunityType === 'EXPRESS') {
      await initiateAutomaticExpressUnfilledRefund(
        opp,
        `Express opportunity ${opp.opportunityCode} expired without Tier 2 acceptance`
      );
      summary.refundedExpressCount += 1;
    } else if (opp.opportunityType === 'NEW_ROUTE') {
      await Shipment.updateMany(
        { _id: { $in: opp.shipmentIds }, status: { $in: ['CONFIRMED', 'POOLED'] } },
        { $set: { viabilityDecision: 'PENDING_CHOICE' } }
      );
    }
  }

  return summary;
}

async function computePointToPointRoadMetrics(
  fromCoords: [number, number],
  toCoords: [number, number],
  fromCode: string,
  toCode: string
) {
  const matrix = await getRoadDistanceMatrix(
    [
      { code: fromCode, coordinates: fromCoords },
      { code: toCode, coordinates: toCoords },
    ],
    { allowCoordinateEstimate: true }
  );
  const meters = matrix.distanceMatrixMeters[0]?.[1] ?? 10000;
  const seconds = matrix.durationMatrixSeconds[0]?.[1] ?? 1200;
  return {
    distanceKm: Math.max(1, Number((meters / 1000).toFixed(1))),
    durationMin: Math.max(10, Math.round(seconds / 60)),
  };
}

function rejectTwoWayBookingPayload(input: ExpressBookingInput) {
  if (
    input.returnTrip !== undefined &&
    input.returnTrip !== false &&
    input.returnTrip !== null
  ) {
    throw new HttpError(
      400,
      'Two-way / return delivery is not supported. Only one-way Express or New-Route marketplace bookings are allowed.',
      'TWO_WAY_UNSUPPORTED'
    );
  }
  if (input.twoWayDelivery === true || input.roundTrip === true) {
    throw new HttpError(
      400,
      'Two-way delivery is out of scope and rejected.',
      'TWO_WAY_UNSUPPORTED'
    );
  }
}

export async function quoteExpressOrNewRouteBooking(rawInput: unknown) {
  const input = expressBookingSchema.parse(rawInput);
  rejectTwoWayBookingPayload(input);

  const policy = await getActiveMarketplacePolicy();
  const cargoCalc = calculateCargoMetrics({
    category: input.cargo.category as CargoCategory,
    quantity: input.cargo.quantity,
    length: input.cargo.unitDimensions.length,
    width: input.cargo.unitDimensions.width,
    height: input.cargo.unitDimensions.height,
    dimensionUnit: input.cargo.unitDimensions.unit as DimensionUnit,
    unitActualWeight: input.cargo.unitActualWeight,
    weightUnit: input.cargo.weightUnit as WeightUnit,
  });

  const road = await computePointToPointRoadMetrics(
    input.pickupAddress.location.coordinates,
    input.deliveryAddress.location.coordinates,
    input.pickupStopCode,
    input.deliveryStopCode
  );

  const requiresDryVan =
    input.cargo.handlingRestrictions.some((t) =>
      ['KEEP_DRY', 'MOISTURE_SENSITIVE'].includes(t.toUpperCase())
    );
  const cargoEnvelope: CargoEnvelope = {
    totalWeightKg: cargoCalc.chargeableWeightKg,
    totalVolumeCbm: cargoCalc.totalVolumeCbm,
    maxUnitLengthCm: cargoCalc.unitDimensionsCm.length,
    maxUnitWidthCm: cargoCalc.unitDimensionsCm.width,
    maxUnitHeightCm: cargoCalc.unitDimensionsCm.height,
    allStackable: input.cargo.stackable,
    handlingRestrictions: input.cargo.handlingRestrictions,
    requiresDryVan,
  };

  // Validate against active APPROVED Tier 2 capacity
  const activeTier2Profiles = await DriverProfile.find({
    fleetTier: 'TIER_2',
    tier2ApplicationStatus: 'APPROVED',
    accountStatus: 'ACTIVE',
    availabilityStatus: { $ne: 'OFFLINE' },
    vehicleId: { $exists: true, $ne: null },
  })
    .select('vehicleId')
    .lean();
  const vehicleIds = activeTier2Profiles
    .map((p) => p.vehicleId)
    .filter((id): id is Types.ObjectId => Boolean(id));
  const candidateVehicles = await Vehicle.find({
    _id: { $in: vehicleIds },
    tier: 'TIER_2',
    operationalStatus: 'ACTIVE',
    isAvailable: true,
  });

  const fittingVehicles = candidateVehicles.filter(
    (v) =>
      isVehicleDocumentationValid(v, new Date()) &&
      doesEnvelopeFitVehicle(v, cargoEnvelope).fits
  );

  const quote = calculateExpressCustomerQuotePaise({
    estimatedDistanceKm: road.distanceKm,
    chargeableWeightKg: cargoCalc.chargeableWeightKg,
    volumeCbm: cargoCalc.totalVolumeCbm,
    bodyType: fittingVehicles[0]?.bodyType,
    policy,
  });

  return {
    serviceType: input.serviceType,
    compatibleVehicleCount: fittingVehicles.length,
    estimatedDistanceKm: road.distanceKm,
    estimatedDurationMin: road.durationMin,
    cargo: cargoCalc,
    customerChargePaise: quote.customerChargePaise,
    estimatedSpotPayoutPaise: quote.estimatedSpotPayoutPaise,
    platformMarginPaise: quote.platformMarginPaise,
    policyVersion: policy.policyVersion,
  };
}

export async function createExpressOrNewRouteBooking(params: {
  businessId: Types.ObjectId;
  userId: string;
  rawInput: unknown;
}) {
  const input = expressBookingSchema.parse(params.rawInput);
  rejectTwoWayBookingPayload(input);

  const now = new Date();
  const policy = await getActiveMarketplacePolicy();
  const oppType: MarketplaceOpportunityType =
    input.serviceType === 'NEW_ROUTE_MARKETPLACE' ? 'NEW_ROUTE' : 'EXPRESS';

  if (!policy.enabledOpportunityTypes.includes(oppType)) {
    throw new HttpError(
      409,
      `${oppType} marketplace booking is currently disabled by Platform Owner policy.`,
      'OPPORTUNITY_TYPE_DISABLED'
    );
  }

  if (input.idempotencyKey) {
    const existingShipment = await Shipment.findOne({
      businessId: params.businessId,
      idempotencyKey: input.idempotencyKey,
    });
    if (existingShipment) {
      const existingOpp = existingShipment.marketplaceOpportunityId
        ? await MarketplaceOpportunity.findById(existingShipment.marketplaceOpportunityId)
        : null;
      return {
        shipment: existingShipment,
        opportunity: existingOpp,
        deduplicated: true,
      };
    }
  }

  const quoteResult = await quoteExpressOrNewRouteBooking(input);
  if (quoteResult.compatibleVehicleCount === 0) {
    throw new HttpError(
      422,
      'No active verified Tier 2 marketplace vehicle currently fits these cargo dimensions, weight, and handling requirements.',
      'NO_COMPATIBLE_TIER2_CAPACITY'
    );
  }

  if (input.simulatePaymentOutcome === 'FAILED') {
    throw new HttpError(402, 'Simulated Express payment failed; booking was not created', 'PAYMENT_FAILED');
  }

  const pickupStart = input.requestedPickupStartAt
    ? new Date(input.requestedPickupStartAt)
    : new Date(now.getTime() + 15 * 60_000);
  const pickupEnd = input.requestedPickupEndAt
    ? new Date(input.requestedPickupEndAt)
    : new Date(pickupStart.getTime() + 45 * 60_000);
  const deliveryDeadline = input.requestedDeliveryDeadlineAt
    ? new Date(input.requestedDeliveryDeadlineAt)
    : new Date(
        pickupStart.getTime() +
          Math.max(90, quoteResult.estimatedDurationMin + 60) * 60_000
      );

  if (deliveryDeadline <= pickupStart) {
    throw new HttpError(
      400,
      'Requested delivery deadline must be after pickup window start',
      'INVALID_DEADLINE'
    );
  }

  const refPrefix = oppType === 'EXPRESS' ? 'EXP' : 'NRT';
  const reference = `MC-${refPrefix}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const trackingToken = crypto.randomBytes(12).toString('hex');
  const qrToken = `MCQR:${reference}:${crypto.randomBytes(6).toString('hex').toUpperCase()}`;

  const txRes = await withTransaction(async (session) => {
    const [shipment] = await Shipment.create(
      [
        {
          reference,
          businessId: params.businessId,
          createdByUserId: new Types.ObjectId(params.userId),
          pickupStopCode: input.pickupStopCode.toUpperCase(),
          pickupStopOrder: 0,
          deliveryStopCode: input.deliveryStopCode.toUpperCase(),
          deliveryStopOrder: 1,
          pickupAddress: input.pickupAddress,
          deliveryAddress: input.deliveryAddress,
          ...(input.pickupContact ? { pickupContact: input.pickupContact } : {}),
          requestedPickupWindow: { startAt: pickupStart, endAt: pickupEnd },
          requestedDeliveryDeadlineAt: deliveryDeadline,
          recipientName: input.recipientName,
          recipientPhone: input.recipientPhone,
          cargo: {
            category: input.cargo.category,
            quantity: input.cargo.quantity,
            unitDimensionsCm: quoteResult.cargo.unitDimensionsCm,
            unitActualWeightKg: quoteResult.cargo.unitActualWeightKg,
            totalActualWeightKg: quoteResult.cargo.totalActualWeightKg,
            volumetricDivisor: quoteResult.cargo.volumetricDivisor,
            volumetricWeightKg: quoteResult.cargo.totalVolumetricWeightKg,
            chargeableWeightKg: quoteResult.cargo.chargeableWeightKg,
            billingBasis: quoteResult.cargo.billingBasis,
            volumeCbm: quoteResult.cargo.totalVolumeCbm,
            stackable: input.cargo.stackable,
            handlingRestrictions: input.cargo.handlingRestrictions,
            declaredContents: input.cargo.declaredContents,
            handlingNotes: input.cargo.handlingNotes,
            irregularCargoNotes: input.cargo.irregularCargoNotes,
          },
          serviceType: input.serviceType,
          paymentChoice: 'FULL_PREPAID',
          tokenStatus: 'PAID',
          pricingSnapshot: {
            pricingVersion: policy.policyVersion,
            ceilingPricePaise: quoteResult.customerChargePaise,
            projectedPricePaise: quoteResult.customerChargePaise,
            finalLockedPricePaise: quoteResult.customerChargePaise,
            tokenAmountPaise: quoteResult.customerChargePaise,
            tokenPaidPaise: quoteResult.customerChargePaise,
            remainingBalancePaise: 0,
            isAnchorEligible: false,
            poolDiscountPaise: 0,
            anchorDiscountPaise: 0,
            handlingFeePaise: 0,
            subsidyPaise: 0,
            marginFlagged: false,
          },
          viabilityDecision: 'NONE',
          status: 'CONFIRMED',
          idempotencyKey: input.idempotencyKey,
          trackingToken,
          qrToken,
          statusHistory: [
            {
              status: 'CONFIRMED',
              at: now,
              actorUserId: new Types.ObjectId(params.userId),
              note: `${input.serviceType} confirmed with payment ₹${(
                quoteResult.customerChargePaise / 100
              ).toFixed(2)}`,
            },
          ],
        },
      ],
      { session }
    );

    const [payment] = await Payment.create(
      [
        {
          shipmentId: shipment._id,
          businessId: params.businessId,
          type: 'TOKEN',
          amountPaise: quoteResult.customerChargePaise,
          status: 'SUCCESS',
          mode: 'SIMULATED',
          isSimulated: true,
          providerRef: `SIM-EXP-${crypto.randomBytes(5).toString('hex').toUpperCase()}`,
          idempotencyKey: input.idempotencyKey
            ? `${input.idempotencyKey}:payment`
            : undefined,
          actorUserId: new Types.ObjectId(params.userId),
          processedAt: now,
        },
      ],
      { session }
    );

    return { shipment, payment };
  });

  if (oppType === 'EXPRESS') {
    const payoutQuote = calculateDeterministicTier2Payout({
      opportunityType: 'EXPRESS',
      estimatedDistanceKm: quoteResult.estimatedDistanceKm,
      totalWeightKg: txRes.shipment.cargo.chargeableWeightKg,
      totalVolumeCbm: txRes.shipment.cargo.volumeCbm,
      policy,
    });
    const { summary } = summarizeShipmentsCargo([txRes.shipment]);
    const offerExpiresAt = new Date(
      Math.min(
        deliveryDeadline.getTime(),
        now.getTime() + policy.offerExpiryMin * 60_000
      )
    );

    const [opp] = await MarketplaceOpportunity.create([
      {
        opportunityCode: `MKT-EXP-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
        opportunityType: 'EXPRESS',
        status: 'OPEN',
        offerVersion: 1,
        sourceDemandKey: `EXPRESS:${String(txRes.shipment._id)}`,
        shipmentIds: [txRes.shipment._id],
        originLabel: `${input.pickupAddress.villageOrTown}, ${input.pickupAddress.district}`,
        destinationLabel: `${input.deliveryAddress.villageOrTown}, ${input.deliveryAddress.district}`,
        originStopCode: input.pickupStopCode.toUpperCase(),
        deliveryStopCode: input.deliveryStopCode.toUpperCase(),
        originLocation: input.pickupAddress.location,
        destinationLocation: input.deliveryAddress.location,
        stopsSummary: [
          {
            stopCode: input.pickupStopCode.toUpperCase(),
            name: `${input.pickupAddress.villageOrTown} Pickup`,
            sequenceOrder: 0,
          },
          {
            stopCode: input.deliveryStopCode.toUpperCase(),
            name: `${input.deliveryAddress.villageOrTown} Drop`,
            sequenceOrder: 1,
          },
        ],
        serviceWindowStartAt: pickupStart,
        pickupDeadlineAt: pickupEnd,
        deliveryDeadlineAt: deliveryDeadline,
        offerExpiresAt: offerExpiresAt > now ? offerExpiresAt : deliveryDeadline,
        cargoSummary: summary,
        estimatedDistanceKm: quoteResult.estimatedDistanceKm,
        estimatedDurationMin: quoteResult.estimatedDurationMin,
        payoutQuote,
        offers: [],
        declinedOrExhaustedDriverIds: [],
        orchestrationReason: `Direct one-way Express shipment ${txRes.shipment.reference}`,
        auditHistory: [
          {
            action: 'EXPRESS_OPPORTUNITY_CREATED',
            toStatus: 'OPEN',
            actorUserId: new Types.ObjectId(params.userId),
            reason: `Direct one-way Express shipment ${txRes.shipment.reference}`,
            at: now,
          },
        ],
      },
    ]);

    txRes.shipment.marketplaceOpportunityId = opp._id;
    await txRes.shipment.save();

    const dispatched = await dispatchOffersForOpportunity({ opportunityId: opp._id, now });
    return {
      shipment: txRes.shipment,
      payment: txRes.payment,
      opportunity: dispatched.opportunity,
      dispatchedCount: dispatched.dispatchedCount,
    };
  }

  // NEW_ROUTE_MARKETPLACE checks viability & batched stops rather than blindly dispatching low-fill demand
  const batchEvaluation = await evaluateNewRouteBatching({
    newShipmentId: String(txRes.shipment._id),
    actorUserId: params.userId,
    now,
  });

  const latestShipment = await Shipment.findById(txRes.shipment._id);
  return {
    shipment: latestShipment ?? txRes.shipment,
    payment: txRes.payment,
    batchEvaluation,
    opportunity: batchEvaluation.opportunity ?? null,
  };
}

export async function evaluateNewRouteBatching(params: {
  newShipmentId?: string;
  actorUserId?: string;
  now?: Date;
}) {
  const now = params.now ?? new Date();
  const policy = await getActiveMarketplacePolicy();

  if (!policy.enabledOpportunityTypes.includes('NEW_ROUTE')) {
    return { viable: false, reason: 'NEW_ROUTE marketplace opportunities disabled by policy' };
  }

  const pendingNewRouteShipments = await Shipment.find({
    serviceType: 'NEW_ROUTE_MARKETPLACE',
    marketplaceOpportunityId: { $exists: false },
    status: { $in: ['CONFIRMED', 'POOLED'] },
    viabilityDecision: 'NONE',
  }).sort({ createdAt: 1 });

  if (pendingNewRouteShipments.length === 0) {
    return { viable: false, reason: 'No unbatched NEW_ROUTE_MARKETPLACE shipments found' };
  }

  // Group strictly by origin district -> delivery district corridor direction (zero Tier 3 backhaul merging)
  const anchor = params.newShipmentId
    ? pendingNewRouteShipments.find((s) => String(s._id) === params.newShipmentId) ??
      pendingNewRouteShipments[0]
    : pendingNewRouteShipments[0];

  const batchShipments = pendingNewRouteShipments.filter(
    (s) =>
      s.pickupAddress.district.toLowerCase() === anchor.pickupAddress.district.toLowerCase() &&
      s.deliveryAddress.district.toLowerCase() === anchor.deliveryAddress.district.toLowerCase()
  );

  const { cargoEnvelope, summary } = summarizeShipmentsCargo(batchShipments);

  // Determine smallest eligible Tier 2 vehicle for utilization viability check
  const tier2Vehicles = await Vehicle.find({
    tier: 'TIER_2',
    operationalStatus: 'ACTIVE',
    isAvailable: true,
  }).sort({ maxWeightKg: 1 });

  const fittingVehicle = tier2Vehicles.find(
    (v) =>
      isVehicleDocumentationValid(v, now) && doesEnvelopeFitVehicle(v, cargoEnvelope).fits
  );

  const refVehicleWeight = fittingVehicle?.maxWeightKg ?? 1200;
  const refVehicleVol = fittingVehicle?.maxVolumeCbm ?? 6;
  const weightUtilPct = Number(((summary.totalWeightKg / refVehicleWeight) * 100).toFixed(1));
  const volUtilPct = Number(((summary.totalVolumeCbm / refVehicleVol) * 100).toFixed(1));
  const effectiveFillPct = Math.max(weightUtilPct, volUtilPct);

  // Measure route detour overhead across batched pickup/drop points vs direct anchor distance
  const directKm = Math.max(
    5,
    haversineDistanceKm(
      anchor.pickupAddress.location.coordinates,
      anchor.deliveryAddress.location.coordinates
    ) * 1.28
  );

  let chainedMeters = 0;
  const orderedWaypoints = [
    anchor.pickupAddress.location.coordinates,
    ...batchShipments.map((s) => s.deliveryAddress.location.coordinates),
  ];
  for (let i = 0; i < orderedWaypoints.length - 1; i += 1) {
    chainedMeters += getCoordinateRoadEstimate(
      orderedWaypoints[i],
      orderedWaypoints[i + 1]
    ).meters;
  }
  const batchedDistanceKm = Math.max(directKm, Number((chainedMeters / 1000).toFixed(1)));
  const detourPct = Number((((batchedDistanceKm - directKm) / directKm) * 100).toFixed(1));

  const payoutQuote = calculateDeterministicTier2Payout({
    opportunityType: 'NEW_ROUTE',
    estimatedDistanceKm: batchedDistanceKm,
    totalWeightKg: summary.totalWeightKg,
    totalVolumeCbm: summary.totalVolumeCbm,
    bodyType: fittingVehicle?.bodyType,
    policy,
  });

  const combinedRevenuePaise = batchShipments.reduce(
    (sum, s) => sum + (s.pricingSnapshot?.finalLockedPricePaise ?? s.pricingSnapshot?.tokenPaidPaise ?? 0),
    0
  );
  const contributionPaise = combinedRevenuePaise - payoutQuote.spotPayoutPaise;

  const passesFill = effectiveFillPct >= policy.newRouteViabilityThresholdPct;
  const passesMargin = contributionPaise >= policy.minContributionPaise;
  const passesDetour = detourPct <= policy.maxNewRouteDetourPct;

  if (!fittingVehicle || !passesFill || !passesMargin || !passesDetour) {
    const reasons: string[] = [];
    if (!fittingVehicle) reasons.push('no verified Tier 2 vehicle fits batch');
    if (!passesFill) {
      reasons.push(
        `utilization ${effectiveFillPct}% below threshold ${policy.newRouteViabilityThresholdPct}%`
      );
    }
    if (!passesMargin) {
      reasons.push(
        `contribution ₹${(contributionPaise / 100).toFixed(2)} below minimum ₹${(
          policy.minContributionPaise / 100
        ).toFixed(2)}`
      );
    }
    if (!passesDetour) {
      reasons.push(`route detour ${detourPct}% exceeds limit ${policy.maxNewRouteDetourPct}%`);
    }

    // Mark thin shipments pending choice so shipper can rollover or claim refund without spawning low-viability dispatch
    for (const s of batchShipments) {
      if (batchShipments.length >= 1 && s.requestedDeliveryDeadlineAt && s.requestedDeliveryDeadlineAt <= new Date(now.getTime() + 60 * 60_000)) {
        s.viabilityDecision = 'PENDING_CHOICE';
        await s.save();
      }
    }

    return {
      viable: false,
      effectiveFillPct,
      detourPct,
      contributionPaise,
      shipmentCount: batchShipments.length,
      reason: `Below viability threshold: ${reasons.join('; ')}`,
    };
  }

  const batchKey = `NEW_ROUTE:${batchShipments
    .map((s) => String(s._id))
    .sort()
    .join(',')}`;

  const earliestPickup = batchShipments
    .map((s) => s.requestedPickupWindow?.startAt ?? now)
    .sort((a, b) => a.getTime() - b.getTime())[0];
  const latestDelivery = batchShipments
    .map((s) => s.requestedDeliveryDeadlineAt ?? new Date(now.getTime() + 6 * 3600_000))
    .sort((a, b) => b.getTime() - a.getTime())[0];

  const [opp] = await MarketplaceOpportunity.create([
    {
      opportunityCode: `MKT-NRT-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
      opportunityType: 'NEW_ROUTE',
      status: 'OPEN',
      offerVersion: 1,
      sourceDemandKey: batchKey,
      shipmentIds: batchShipments.map((s) => s._id),
      originLabel: `${anchor.pickupAddress.villageOrTown}, ${anchor.pickupAddress.district}`,
      destinationLabel: `${anchor.deliveryAddress.villageOrTown}, ${anchor.deliveryAddress.district}`,
      originStopCode: anchor.pickupStopCode,
      deliveryStopCode: anchor.deliveryStopCode,
      originLocation: anchor.pickupAddress.location,
      destinationLocation: anchor.deliveryAddress.location,
      stopsSummary: [
        {
          stopCode: anchor.pickupStopCode,
          name: `${anchor.pickupAddress.villageOrTown} Pickup Hub`,
          sequenceOrder: 0,
        },
        ...batchShipments.map((s, idx) => ({
          stopCode: s.deliveryStopCode,
          name: `${s.deliveryAddress.villageOrTown} (${s.reference})`,
          sequenceOrder: idx + 1,
        })),
      ],
      serviceWindowStartAt: earliestPickup,
      pickupDeadlineAt: new Date(earliestPickup.getTime() + 60 * 60_000),
      deliveryDeadlineAt: latestDelivery,
      offerExpiresAt: new Date(
        Math.min(latestDelivery.getTime(), now.getTime() + policy.offerExpiryMin * 60_000)
      ),
      cargoSummary: summary,
      estimatedDistanceKm: batchedDistanceKm,
      estimatedDurationMin: Math.round((batchedDistanceKm / 45) * 60),
      payoutQuote,
      offers: [],
      declinedOrExhaustedDriverIds: [],
      orchestrationReason: `Batched ${batchShipments.length} new-route shipments (${effectiveFillPct}% fill, detour ${detourPct}%)`,
      auditHistory: [
        {
          action: 'NEW_ROUTE_BATCH_VIABLE',
          toStatus: 'OPEN',
          ...(params.actorUserId && isValidObjectId(params.actorUserId)
            ? { actorUserId: new Types.ObjectId(params.actorUserId) }
            : {}),
          reason: `Batched ${batchShipments.length} shipments (${effectiveFillPct}% fill, detour ${detourPct}%)`,
          at: now,
        },
      ],
    },
  ]);

  await Shipment.updateMany(
    { _id: { $in: batchShipments.map((s) => s._id) } },
    { $set: { marketplaceOpportunityId: opp._id, viabilityDecision: 'NONE' } }
  );

  const dispatched = await dispatchOffersForOpportunity({ opportunityId: opp._id, now });
  return {
    viable: true,
    effectiveFillPct,
    detourPct,
    contributionPaise,
    opportunity: dispatched.opportunity,
    dispatchedCount: dispatched.dispatchedCount,
  };
}

export async function listMarketplaceOpportunitiesForOwner(filters?: {
  status?: MarketplaceOpportunityStatus;
  opportunityType?: MarketplaceOpportunityType;
}) {
  const query: Record<string, unknown> = {};
  if (filters?.status) query.status = filters.status;
  if (filters?.opportunityType) query.opportunityType = filters.opportunityType;

  const opportunities = await MarketplaceOpportunity.find(query)
    .populate('acceptedByDriverId', 'name email phone')
    .populate('acceptedVehicleId', 'registrationNumber vehicleClass bodyType')
    .populate('tripId', 'tripCode status')
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();

  return opportunities;
}
