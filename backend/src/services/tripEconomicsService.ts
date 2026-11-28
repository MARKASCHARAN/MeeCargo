import { isValidObjectId } from 'mongoose';
import { BackhaulRequest } from '../models/BackhaulRequest.js';
import { Payment } from '../models/Payment.js';
import { Shipment } from '../models/Shipment.js';
import { Trip } from '../models/Trip.js';
import { TripLedger, type LedgerLine } from '../models/TripLedger.js';
import { Vehicle } from '../models/Vehicle.js';
import { HttpError } from '../utils/errors.js';

export interface LedgerInputData {
  tripId: string;
  isDemoIllustrative: boolean;
  outboundShipments: Array<{
    finalLockedPricePaise?: number;
    projectedPricePaise?: number;
    subsidyPaise?: number;
    isLocked: boolean;
  }>;
  backhaul: {
    isConfirmedOrMatched: boolean;
    revenuePaise: number;
    repositioningCostPaise: number;
  };
  vehiclePayoutAndMinGuaranteePaise: number;
  vehiclePayoutStatus: 'ESTIMATED' | 'ACTUAL';
  roadDistanceKm: number;
  refundsPaise: number;
}

export function computeTripLedgerBreakdown(input: LedgerInputData) {
  let outboundRevenuePaise = 0;
  let subsidiesPaise = 0;
  let allLocked = input.outboundShipments.length > 0;

  for (const s of input.outboundShipments) {
    outboundRevenuePaise += s.finalLockedPricePaise ?? s.projectedPricePaise ?? 0;
    subsidiesPaise += s.subsidyPaise ?? 0;
    if (!s.isLocked) allLocked = false;
  }

  // Strictly exclude unconfirmed backhaul revenue
  const confirmedBackhaulRevenuePaise = input.backhaul.isConfirmedOrMatched
    ? input.backhaul.revenuePaise
    : 0;

  const vehiclePayoutAndMinGuaranteePaise = input.vehiclePayoutAndMinGuaranteePaise;
  const fuelAndTollPaise = Math.round(input.roadDistanceKm * 850); // ₹8.50/km estimate
  const hubHandlingCostPaise = input.outboundShipments.length * 3500; // ₹35/shipment
  const totalGrossRevenue = outboundRevenuePaise + confirmedBackhaulRevenuePaise;
  const paymentAndOperatingFeesPaise = Math.round(totalGrossRevenue * 0.02);
  const refundsAndSubsidiesPaise = input.refundsPaise + subsidiesPaise;

  const platformContributionPaise =
    totalGrossRevenue -
    vehiclePayoutAndMinGuaranteePaise -
    fuelAndTollPaise -
    hubHandlingCostPaise -
    paymentAndOperatingFeesPaise -
    refundsAndSubsidiesPaise -
    (input.backhaul.isConfirmedOrMatched ? input.backhaul.repositioningCostPaise : 0);

  const lines: LedgerLine[] = [
    {
      key: 'OUTBOUND_REVENUE',
      category: 'REVENUE',
      label: 'Outbound pooled shipment revenue',
      amountPaise: outboundRevenuePaise,
      status: allLocked ? 'ACTUAL' : 'ESTIMATED',
      source: 'Shipment locked pricing snapshots',
    },
    {
      key: 'CONFIRMED_BACKHAUL_REVENUE',
      category: 'REVENUE',
      label: 'Confirmed return / backhaul revenue',
      amountPaise: confirmedBackhaulRevenuePaise,
      status: input.backhaul.isConfirmedOrMatched ? 'ACTUAL' : 'ESTIMATED',
      source: input.backhaul.isConfirmedOrMatched
        ? 'Confirmed BackhaulRequest match'
        : 'None (unconfirmed backhauls excluded)',
    },
    {
      key: 'VEHICLE_PAYOUT_MIN_GUARANTEE',
      category: 'COST',
      label: 'Vehicle payout & Tier 1 minimum guarantee',
      amountPaise: vehiclePayoutAndMinGuaranteePaise,
      status: input.vehiclePayoutStatus,
      source: 'Fleet allocator & Tier 1 contract policy',
    },
    {
      key: 'FUEL_AND_TOLL',
      category: 'COST',
      label: 'Fuel & highway toll estimate',
      amountPaise: fuelAndTollPaise,
      status: 'ESTIMATED',
      source: `Road distance (${input.roadDistanceKm.toFixed(1)} km @ ₹8.50/km)`,
    },
    {
      key: 'HUB_HANDLING',
      category: 'COST',
      label: 'Origin/destination handling overhead',
      amountPaise: hubHandlingCostPaise,
      status: 'ESTIMATED',
      source: 'Per-shipment handling allowance',
    },
    {
      key: 'PAYMENT_OPERATING_FEES',
      category: 'COST',
      label: 'Payment gateway & platform operating fees (2%)',
      amountPaise: paymentAndOperatingFeesPaise,
      status: 'ESTIMATED',
      source: '2% of gross recognized revenue',
    },
    {
      key: 'REFUNDS_SUBSIDIES',
      category: 'SUBSIDY_REFUND',
      label: 'Customer refunds & margin subsidies',
      amountPaise: refundsAndSubsidiesPaise,
      status: 'ACTUAL',
      source: 'Payment refund & pricing subsidy ledger',
    },
  ];

  return {
    lines,
    outboundRevenuePaise,
    confirmedBackhaulRevenuePaise,
    vehiclePayoutAndMinGuaranteePaise,
    fuelAndTollPaise,
    hubHandlingCostPaise,
    paymentAndOperatingFeesPaise,
    refundsAndSubsidiesPaise,
    platformContributionPaise,
  };
}

export async function calculateAndPersistTripLedger(tripId: string) {
  if (!isValidObjectId(tripId)) {
    throw new HttpError(400, 'Invalid trip ID', 'VALIDATION_ERROR');
  }

  const trip = await Trip.findById(tripId);
  if (!trip) {
    throw new HttpError(404, 'Trip not found', 'TRIP_NOT_FOUND');
  }

  const [shipments, vehicle, refunds] = await Promise.all([
    Shipment.find({
      _id: { $in: trip.shipmentIds },
      status: { $ne: 'CANCELLED' },
    }),
    Vehicle.findById(trip.vehicleId),
    Payment.find({
      shipmentId: { $in: trip.shipmentIds },
      type: 'REFUND',
      status: 'REFUNDED',
    }),
  ]);

  let isConfirmedOrMatched = false;
  let backhaulRevenuePaise = 0;
  let repositioningCostPaise = 0;

  if (
    trip.backhaulDecision?.decision === 'MATCHED' &&
    trip.backhaulDecision.backhaulRequestId
  ) {
    const bh = await BackhaulRequest.findById(trip.backhaulDecision.backhaulRequestId);
    if (bh && (bh.status === 'CONFIRMED' || bh.status === 'MATCHED')) {
      isConfirmedOrMatched = true;
      backhaulRevenuePaise = bh.quotedRevenuePaise;
      repositioningCostPaise = trip.backhaulDecision.repositioningCostPaise ?? 0;
    }
  }

  const roadDistanceKm =
    trip.routePlan?.totalDistanceMeters && trip.routePlan.totalDistanceMeters > 0
      ? trip.routePlan.totalDistanceMeters / 1000
      : trip.allocationEconomics?.estimatedDistanceKm ?? 115;

  const tier1MinGuarantee =
    trip.allocationEconomics?.tier1MinGuaranteeIncludedPaise ??
    vehicle?.minGuaranteePaise ??
    0;
  const estVehiclePayout =
    trip.allocationEconomics?.estimatedVehiclePayoutPaise ??
    Math.max(tier1MinGuarantee, Math.round(roadDistanceKm * (vehicle?.perKmRatePaise ?? 2400)));

  const vehiclePayoutAndMinGuaranteePaise = Math.max(
    tier1MinGuarantee,
    estVehiclePayout
  );

  const refundsPaise = refunds.reduce((sum, r) => sum + r.amountPaise, 0);

  const computed = computeTripLedgerBreakdown({
    tripId: String(trip._id),
    isDemoIllustrative: true,
    outboundShipments: shipments.map((s) => ({
      finalLockedPricePaise: s.pricingSnapshot?.finalLockedPricePaise,
      projectedPricePaise: s.pricingSnapshot?.projectedPricePaise,
      subsidyPaise: s.pricingSnapshot?.subsidyPaise,
      isLocked: s.pricingSnapshot?.finalLockedPricePaise !== undefined,
    })),
    backhaul: {
      isConfirmedOrMatched,
      revenuePaise: backhaulRevenuePaise,
      repositioningCostPaise,
    },
    vehiclePayoutAndMinGuaranteePaise,
    vehiclePayoutStatus: trip.status === 'COMPLETED' ? 'ACTUAL' : 'ESTIMATED',
    roadDistanceKm,
    refundsPaise,
  });

  const ledger = await TripLedger.findOneAndUpdate(
    { tripId: trip._id },
    {
      $set: {
        tripId: trip._id,
        isDemoIllustrative: true,
        ...computed,
      },
    },
    { upsert: true, returnDocument: 'after' }
  );

  return ledger;
}
