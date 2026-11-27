import { isValidObjectId } from 'mongoose';
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
}) {
  const { tripId } = params;
  if (!isValidObjectId(tripId)) {
    throw new HttpError(400, 'Invalid trip ID', 'VALIDATION_ERROR');
  }

  const trip = await Trip.findById(tripId);
  if (!trip) {
    throw new HttpError(404, 'Trip not found', 'TRIP_NOT_FOUND');
  }

  const [corridor, vehicle, shipments] = await Promise.all([
    Corridor.findById(trip.corridorId),
    Vehicle.findById(trip.vehicleId),
    Shipment.find({ _id: { $in: trip.shipmentIds } }),
  ]);

  if (!corridor || !vehicle) {
    throw new HttpError(404, 'Corridor or vehicle not found for trip', 'NOT_FOUND');
  }

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

  const activeStops = [originStop, ...dropStops];
  const points: MatrixPoint[] = activeStops.map((s) => ({
    code: s.stopCode,
    coordinates: s.location.coordinates,
  }));

  const matrix = await getRoadDistanceMatrix(points);

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
    time_limit_seconds: 5,
  });

  if (optResult.status !== 'OPTIMAL') {
    trip.routePlan = {
      optimizationStatus: optResult.status,
      provider: 'OR_TOOLS',
      matrixProvider: matrix.provider,
      totalDistanceMeters: 0,
      estimatedDurationSeconds: 0,
      orderedStops: [],
      failureReason: optResult.reason ?? 'Optimization did not return a valid solution.',
    };
    await trip.save();
    return { trip, optimized: false, routePlan: trip.routePlan };
  }

  trip.routePlan = {
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
    bedDimensionsCm: vehicle.bedDimensionsCm,
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
