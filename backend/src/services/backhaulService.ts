import { isValidObjectId } from 'mongoose';
import { BackhaulRequest, type IBackhaulRequest } from '../models/BackhaulRequest.js';
import { Trip } from '../models/Trip.js';
import { Vehicle } from '../models/Vehicle.js';
import { HttpError } from '../utils/errors.js';
import { getFixtureRoadLeg } from './distanceMatrixService.js';
import { hasOverlappingDriverTrip } from './driverAssignment.js';
import { doesCargoFitVehicle } from './fleetAllocator.js';

export interface BackhaulEvaluationCandidate {
  request: IBackhaulRequest;
  repositioningDistanceKm: number;
  haulDistanceKm: number;
  repositioningCostPaise: number;
  returnOperatingCostPaise: number;
  expectedRevenuePaise: number;
  netContributionPaise: number;
  feasible: boolean;
  rejectionReason?: string;
}

export async function evaluateBackhaulForTrip(params: {
  tripId: string;
  applyMatch?: boolean;
}) {
  const { tripId, applyMatch = true } = params;
  if (!isValidObjectId(tripId)) {
    throw new HttpError(400, 'Invalid trip ID', 'VALIDATION_ERROR');
  }

  const trip = await Trip.findById(tripId);
  if (!trip) {
    throw new HttpError(404, 'Trip not found', 'TRIP_NOT_FOUND');
  }

  const vehicle = await Vehicle.findById(trip.vehicleId);
  if (!vehicle) {
    throw new HttpError(404, 'Vehicle not found for trip', 'NOT_FOUND');
  }

  const tier1MinGuarantee =
    trip.allocationEconomics?.tier1MinGuaranteeIncludedPaise ??
    vehicle.minGuaranteePaise ??
    0;

  // Strictly query CONFIRMED requests — never count PENDING/unconfirmed requests as revenue
  const confirmedRequests = await BackhaulRequest.find({
    corridorId: trip.corridorId,
    status: 'CONFIRMED',
  }).sort({ quotedRevenuePaise: -1 });

  const lastOutboundStop =
    trip.stopsSummary[trip.stopsSummary.length - 1]?.stopCode ?? 'AMD';

  const candidates: BackhaulEvaluationCandidate[] = [];

  for (const req of confirmedRequests) {
    // 1. Capacity & cargo dimensions check
    const fit = doesCargoFitVehicle(
      [
        {
          cargo: {
            chargeableWeightKg: req.cargo.chargeableWeightKg,
            volumeCbm: req.cargo.volumeCbm,
            unitDimensionsCm: req.cargo.unitDimensionsCm,
            handlingRestrictions: [],
          },
        } as never,
      ],
      vehicle
    );

    if (!fit.feasible) {
      candidates.push({
        request: req,
        repositioningDistanceKm: 0,
        haulDistanceKm: 0,
        repositioningCostPaise: 0,
        returnOperatingCostPaise: 0,
        expectedRevenuePaise: req.quotedRevenuePaise,
        netContributionPaise: -1,
        feasible: false,
        rejectionReason: fit.reason,
      });
      continue;
    }

    // 2. Road-distance repositioning & return haul calculations
    let repoMeters = 0;
    let haulMeters = 0;
    let haulSeconds = 7200;
    try {
      const repoLeg = getFixtureRoadLeg(lastOutboundStop, req.originStopCode);
      const haulLeg = getFixtureRoadLeg(req.originStopCode, req.destinationStopCode);
      repoMeters = repoLeg.meters;
      haulMeters = haulLeg.meters;
      haulSeconds = repoLeg.seconds + haulLeg.seconds;
    } catch (err) {
      candidates.push({
        request: req,
        repositioningDistanceKm: 0,
        haulDistanceKm: 0,
        repositioningCostPaise: 0,
        returnOperatingCostPaise: 0,
        expectedRevenuePaise: req.quotedRevenuePaise,
        netContributionPaise: -1,
        feasible: false,
        rejectionReason: err instanceof Error ? err.message : 'Missing road leg',
      });
      continue;
    }

    // 3. Driver schedule & next-commitment conflict check
    const returnWindowStart = new Date(trip.estimatedEndAt);
    const returnWindowEnd = new Date(
      returnWindowStart.getTime() + haulSeconds * 1000 + 30 * 60 * 1000
    );

    const scheduleConflict = await hasOverlappingDriverTrip({
      driverId: trip.driverId,
      windowStart: returnWindowStart,
      windowEnd: returnWindowEnd,
      excludeTripId: trip._id,
    });

    if (scheduleConflict) {
      candidates.push({
        request: req,
        repositioningDistanceKm: Number((repoMeters / 1000).toFixed(1)),
        haulDistanceKm: Number((haulMeters / 1000).toFixed(1)),
        repositioningCostPaise: 0,
        returnOperatingCostPaise: 0,
        expectedRevenuePaise: req.quotedRevenuePaise,
        netContributionPaise: -1,
        feasible: false,
        rejectionReason: 'Conflicts with driver next scheduled trip commitment.',
      });
      continue;
    }

    const repositioningDistanceKm = Number((repoMeters / 1000).toFixed(1));
    const haulDistanceKm = Number((haulMeters / 1000).toFixed(1));
    const perKm = vehicle.payoutModel?.perKmRatePaise ?? vehicle.perKmRatePaise;
    const repositioningCostPaise = Math.round(repositioningDistanceKm * perKm);
    const returnOperatingCostPaise = Math.round(haulDistanceKm * perKm);
    const netContributionPaise =
      req.quotedRevenuePaise - repositioningCostPaise - returnOperatingCostPaise;

    candidates.push({
      request: req,
      repositioningDistanceKm,
      haulDistanceKm,
      repositioningCostPaise,
      returnOperatingCostPaise,
      expectedRevenuePaise: req.quotedRevenuePaise,
      netContributionPaise,
      feasible: netContributionPaise > 0,
      ...(netContributionPaise <= 0
        ? {
            rejectionReason: `Negative net contribution (${netContributionPaise} paise) after repositioning & return haul costs.`,
          }
        : {}),
    });
  }

  const best = candidates
    .filter((c) => c.feasible)
    .sort((a, b) => b.netContributionPaise - a.netContributionPaise)[0];

  const scheduledReturnTime =
    trip.scheduleSnapshot?.selectedReturnTime ??
    (trip.estimatedEndAt
      ? new Date(trip.estimatedEndAt).toTimeString().slice(0, 5)
      : undefined);

  if (!best) {
    const decision = {
      decision: 'EARLY_TURNAROUND' as const,
      repositioningDistanceKm: 0,
      repositioningCostPaise: 0,
      expectedReturnRevenuePaise: 0,
      netContributionPaise: 0,
      tier1MinGuaranteeIncludedPaise: tier1MinGuarantee,
      scheduledReturnTime,
      returnStops: [],
      returnShipmentCount: 0,
      emptyReturn: true,
      reason:
        confirmedRequests.length === 0
          ? 'Scheduled empty return — no return backhaul cargo allocated.'
          : 'Scheduled empty return — no confirmed backhaul met capacity, schedule, and contribution rules.',
      evaluatedAt: new Date(),
    };

    if (applyMatch) {
      trip.backhaulDecision = decision;
      await trip.save();
    }
    return { matched: false, decision, candidates };
  }

  const decision = {
    decision: 'MATCHED' as const,
    backhaulRequestId: best.request._id,
    requestCode: best.request.requestCode,
    repositioningDistanceKm: best.repositioningDistanceKm,
    repositioningCostPaise: best.repositioningCostPaise,
    expectedReturnRevenuePaise: best.expectedRevenuePaise,
    netContributionPaise: best.netContributionPaise,
    tier1MinGuaranteeIncludedPaise: tier1MinGuarantee,
    scheduledReturnTime,
    returnStops: [
      {
        stopCode: best.request.originStopCode,
        name: best.request.originStopCode,
        action: 'PICKUP_BACKHAUL',
      },
      {
        stopCode: best.request.destinationStopCode,
        name: best.request.destinationStopCode,
        action: 'DROP_BACKHAUL',
      },
    ],
    returnShipmentCount: 1,
    returnCargoSummary: `${best.request.cargo.chargeableWeightKg} kg • ${best.request.cargo.declaredContents}`,
    emptyReturn: false,
    reason: `Matched confirmed backhaul ${best.request.requestCode} (+₹${(
      best.netContributionPaise / 100
    ).toFixed(2)} net contribution; Tier 1 min guarantee preserved).`,
    evaluatedAt: new Date(),
  };

  if (applyMatch) {
    trip.backhaulDecision = decision;
    await trip.save();
    await BackhaulRequest.updateOne(
      { _id: best.request._id },
      { $set: { status: 'MATCHED', matchedTripId: trip._id } }
    );
  }

  return { matched: true, decision, candidates };
}
