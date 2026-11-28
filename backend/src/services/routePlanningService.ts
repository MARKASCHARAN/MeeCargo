import { isValidObjectId } from 'mongoose';
import { env } from '../config/env.js';
import { Corridor } from '../models/Corridor.js';
import { Shipment } from '../models/Shipment.js';
import { Trip } from '../models/Trip.js';
import { Vehicle } from '../models/Vehicle.js';
import { HttpError } from '../utils/errors.js';
import { getRoadDistanceMatrix, type MatrixPoint } from './distanceMatrixService.js';
import { buildLifoLoadingPlan } from './loadingPlanService.js';
import { callRouteOptimizer } from './optimizerClient.js';

export async function optimizeAndPlanTripRoute(params: {
  tripId: string;
  actorUserId?: string;
  replanReason?: string;
}) {
  const { tripId, replanReason } = params;
  if (!isValidObjectId(tripId)) {
    throw new HttpError(400, 'Invalid trip ID', 'VALIDATION_ERROR');
  }

  const trip = await Trip.findById(tripId);
  if (!trip) {
    throw new HttpError(404, 'Trip not found', 'TRIP_NOT_FOUND');
  }

  const [corridor, vehicle, shipments] = await Promise.all([
    trip.corridorId ? Corridor.findById(trip.corridorId) : Promise.resolve(null),
    Vehicle.findById(trip.vehicleId),
    Shipment.find({ _id: { $in: trip.shipmentIds } }),
  ]);

  if (!vehicle) {
    throw new HttpError(404, 'Vehicle not found for trip', 'NOT_FOUND');
  }
  if (trip.corridorId && !corridor) {
    throw new HttpError(404, 'Corridor not found for trip', 'NOT_FOUND');
  }

  let activeStops: Array<{
    stopCode: string;
    name: string;
    location: { type: 'Point'; coordinates: [number, number] };
  }> = [];

  if (corridor) {
    const originStop =
      corridor.stops.find((s) => s.sequenceOrder === 0) ?? corridor.stops[0];

    // Collect active drop stops present in this trip's shipments (or all corridor drops if empty demo trip)
    const shipmentStopCodes = new Set(
      shipments.map((s) => s.deliveryStopCode.toUpperCase())
    );

    const dropStops = corridor.stops
      .filter((s) => s.sequenceOrder > 0)
      .filter((s) => shipmentStopCodes.size === 0 || shipmentStopCodes.has(s.stopCode.toUpperCase()))
      .sort((a, b) => a.sequenceOrder - b.sequenceOrder);

    activeStops = [originStop, ...dropStops];
  } else {
    // Non-corridor Tier 2 Express / New-Route trip: derive origin & delivery waypoints directly from shipments
    const firstShipment = shipments[0];
    if (!firstShipment) {
      throw new HttpError(404, 'Shipments missing for non-corridor trip route optimization', 'NOT_FOUND');
    }
    const originPoint = {
      stopCode: firstShipment.pickupStopCode || 'EXP-PKP',
      name: `${firstShipment.pickupAddress.villageOrTown} Pickup`,
      location: firstShipment.pickupAddress.location,
    };
    const seenDropCodes = new Set<string>();
    const dynamicDrops: typeof activeStops = [];
    for (const s of shipments) {
      const code = (s.deliveryStopCode || `DROP-${dynamicDrops.length + 1}`).toUpperCase();
      if (!seenDropCodes.has(code)) {
        seenDropCodes.add(code);
        dynamicDrops.push({
          stopCode: code,
          name: `${s.deliveryAddress.villageOrTown} Drop`,
          location: s.deliveryAddress.location,
        });
      }
    }
    activeStops = [originPoint, ...dynamicDrops];
  }

  const points: MatrixPoint[] = activeStops.map((s) => ({
    code: s.stopCode,
    coordinates: s.location.coordinates,
  }));

  const matrix = await getRoadDistanceMatrix(points, {
    allowCoordinateEstimate: !corridor,
  });

  const optimizerStops = activeStops.map((stop, idx) => {
    const stopShipments = shipments.filter(
      (sh) => sh.deliveryStopCode.toUpperCase() === stop.stopCode.toUpperCase()
    );
    return {
      stop_index: idx,
      stop_code: stop.stopCode,
      name: stop.name,
      demand_weight_kg:
        idx === 0
          ? 0
          : Number(
              stopShipments
                .reduce((sum, sh) => sum + sh.cargo.chargeableWeightKg, 0)
                .toFixed(2)
            ),
      demand_volume_cbm:
        idx === 0
          ? 0
          : Number(
              stopShipments
                .reduce((sum, sh) => sum + sh.cargo.volumeCbm, 0)
                .toFixed(4)
            ),
      time_window_min: null,
      shipment_ids: stopShipments.map((sh) => String(sh._id)),
    };
  });

  const solverTimeLimitSec = Math.max(
    1,
    Math.min(3, Math.floor((env.OPTIMIZER_TIMEOUT_MS - 1000) / 1000))
  );
  const optResult = await callRouteOptimizer({
    vehicles: [
      {
        id: vehicle.registrationNumber,
        max_weight_kg: vehicle.maxWeightKg,
        max_volume_cbm: vehicle.maxVolumeCbm,
      },
    ],
    stops: optimizerStops,
    distance_matrix_meters: matrix.distanceMatrixMeters,
    duration_matrix_seconds: matrix.durationMatrixSeconds,
    open_ended_outbound: true,
    time_limit_seconds: solverTimeLimitSec,
  });

  const previousPlan = trip.routePlan;
  const nextVersion = (previousPlan?.routeVersion ?? (previousPlan ? 1 : 0)) + 1;
  const nextHistory = [...(previousPlan?.routeHistory ?? [])];
  if (previousPlan && previousPlan.orderedStops?.length > 0) {
    nextHistory.push({
      version: previousPlan.routeVersion ?? 1,
      optimizationStatus: previousPlan.optimizationStatus,
      totalDistanceMeters: previousPlan.totalDistanceMeters,
      estimatedDurationSeconds: previousPlan.estimatedDurationSeconds,
      orderedStops: previousPlan.orderedStops,
      reason: replanReason ?? 'Superseded by backend replanning',
      supersededAt: new Date(),
    });
  }

  if (optResult.status !== 'OPTIMAL') {
    trip.routePlan = {
      routeVersion: nextVersion,
      optimizationStatus: optResult.status,
      provider: 'OR_TOOLS',
      matrixProvider: matrix.provider,
      totalDistanceMeters: 0,
      estimatedDurationSeconds: 0,
      orderedStops: [],
      failureReason: optResult.reason ?? 'Optimization did not return a valid solution.',
      routeHistory: nextHistory,
    };
    await trip.save();
    return { trip, optimized: false, routePlan: trip.routePlan };
  }

  trip.routePlan = {
    routeVersion: nextVersion,
    optimizationStatus: 'OPTIMAL',
    provider: 'OR_TOOLS',
    matrixProvider: matrix.provider,
    totalDistanceMeters: optResult.total_distance_meters,
    estimatedDurationSeconds: optResult.estimated_duration_seconds,
    orderedStops: optResult.ordered_stops.map((s) => ({
      sequence: s.sequence,
      stopCode: s.stop_code,
      name: s.name,
      arrivalMin: s.arrival_min,
      cumulativeDistanceMeters: s.cumulative_distance_meters,
      shipmentIds: s.shipment_ids,
    })),
    optimizedAt: new Date(),
    routeHistory: nextHistory,
  };

  trip.stopsSummary = optResult.ordered_stops.map((s) => ({
    stopCode: s.stop_code,
    name: s.name,
    sequenceOrder: s.sequence,
  }));

  trip.loadingPlan = buildLifoLoadingPlan({
    orderedStops: optResult.ordered_stops.map((s) => ({
      sequence: s.sequence,
      stopCode: s.stop_code,
    })),
    shipments,
    bedDimensionsCm: trip.vehicleSnapshot?.bedDimensionsCm ?? vehicle.bedDimensionsCm,
    vehicleLimits: {
      maxWeightKg: trip.vehicleSnapshot?.maxWeightKg ?? vehicle.maxWeightKg,
      maxVolumeCbm: trip.vehicleSnapshot?.maxVolumeCbm ?? vehicle.maxVolumeCbm,
    },
    existingManualOverrides: trip.loadingPlan?.manualOverrides ?? [],
  });

  await trip.save();
  return {
    trip,
    optimized: true,
    routePlan: trip.routePlan,
    loadingPlan: trip.loadingPlan,
  };
}
