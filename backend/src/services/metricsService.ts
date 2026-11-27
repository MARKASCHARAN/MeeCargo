import type { Types } from 'mongoose';
import { env } from '../config/env.js';
import { Pool } from '../models/Pool.js';
import { Shipment } from '../models/Shipment.js';
import { Trip } from '../models/Trip.js';

export interface OperationalImpactMetrics {
  shipperScoped: {
    totalBookings: number;
    deliveredCount: number;
    activeCount: number;
    failedCount: number;
    cancelledCount: number;
    totalActualOrProjectedSpendPaise: number;
    totalCeilingBaselinePaise: number;
    estimatedSavingsPaise: number;
    estimatedSavingsPct: number;
    baselineMethodology: string;
    isEstimated: true;
  };
  platformUtilization: {
    tripsCount: number;
    avgVehicleWeightUtilizationPct: number;
    avgVehicleVolumeUtilizationPct: number;
    avgPoolFillLevelPct: number;
    totalRoadDistanceKm: number;
    emptyReturnDistanceKm: number;
    costPerSuccessfulShipmentPaise: number | null;
    onTimeDeliveryRatePct: number | null;
    failedDeliveryRatePct: number;
    estimatedCo2ImpactKg: number | null;
    co2Methodology: string;
    isIllustrativeDemoData: true;
  };
}

export async function getOperationalAndShipperMetrics(params: {
  businessId: Types.ObjectId;
}): Promise<OperationalImpactMetrics> {
  const { businessId } = params;

  const [myShipments, pools, trips] = await Promise.all([
    Shipment.find({ businessId }).lean(),
    Pool.find({ status: { $in: ['OPEN', 'LOCKED'] } }).lean(),
    Trip.find({}).populate('vehicleId', 'maxWeightKg maxVolumeCbm').lean(),
  ]);

  let totalActualOrProjectedSpendPaise = 0;
  let totalCeilingBaselinePaise = 0;

  for (const s of myShipments) {
    if (s.status === 'CANCELLED') continue;
    const charge =
      s.pricingSnapshot?.finalLockedPricePaise ??
      s.pricingSnapshot?.projectedPricePaise ??
      0;
    const ceiling = s.pricingSnapshot?.ceilingPricePaise ?? charge;
    totalActualOrProjectedSpendPaise += charge;
    totalCeilingBaselinePaise += ceiling;
  }

  const estimatedSavingsPaise = Math.max(
    0,
    totalCeilingBaselinePaise - totalActualOrProjectedSpendPaise
  );
  const estimatedSavingsPct =
    totalCeilingBaselinePaise > 0
      ? Number(((estimatedSavingsPaise / totalCeilingBaselinePaise) * 100).toFixed(1))
      : 0;

  const deliveredCount = myShipments.filter((s) => s.status === 'DELIVERED').length;
  const failedCount = myShipments.filter((s) => s.status === 'FAILED').length;
  const cancelledCount = myShipments.filter((s) => s.status === 'CANCELLED').length;
  const activeCount = myShipments.filter((s) =>
    ['CONFIRMED', 'POOLED', 'LOCKED', 'PICKED_UP', 'IN_TRANSIT', 'AT_DESTINATION'].includes(
      s.status
    )
  ).length;

  // Separate weight & volume utilization across pools
  let sumWeightPct = 0;
  let sumVolPct = 0;
  for (const p of pools) {
    sumWeightPct +=
      p.capacityWeightKg > 0 ? (p.reservedWeightKg / p.capacityWeightKg) * 100 : 0;
    sumVolPct +=
      p.capacityVolumeCbm > 0 ? (p.reservedVolumeCbm / p.capacityVolumeCbm) * 100 : 0;
  }

  const avgVehicleWeightUtilizationPct =
    pools.length > 0 ? Number((sumWeightPct / pools.length).toFixed(1)) : 0;
  const avgVehicleVolumeUtilizationPct =
    pools.length > 0 ? Number((sumVolPct / pools.length).toFixed(1)) : 0;
  const avgPoolFillLevelPct = Number(
    ((avgVehicleWeightUtilizationPct + avgVehicleVolumeUtilizationPct) / 2).toFixed(1)
  );

  let totalRoadDistanceKm = 0;
  let emptyReturnDistanceKm = 0;
  let totalVehiclePayoutPaise = 0;
  let completedTrips = 0;
  let onTimeCompletedTrips = 0;

  for (const t of trips) {
    const distKm =
      t.routePlan?.totalDistanceMeters && t.routePlan.totalDistanceMeters > 0
        ? t.routePlan.totalDistanceMeters / 1000
        : t.allocationEconomics?.estimatedDistanceKm ?? 0;
    totalRoadDistanceKm += distKm;
    totalVehiclePayoutPaise += t.allocationEconomics?.estimatedVehiclePayoutPaise ?? 0;

    if (t.backhaulDecision?.decision !== 'MATCHED') {
      emptyReturnDistanceKm += distKm;
    } else {
      emptyReturnDistanceKm += t.backhaulDecision.repositioningDistanceKm ?? 0;
    }

    if (t.status === 'COMPLETED') {
      completedTrips += 1;
      if (!t.actualCompletedAt || new Date(t.actualCompletedAt) <= new Date(t.estimatedEndAt)) {
        onTimeCompletedTrips += 1;
      }
    }
  }

  const deliveredOrFailed = deliveredCount + failedCount;
  const failedDeliveryRatePct =
    deliveredOrFailed > 0
      ? Number(((failedCount / deliveredOrFailed) * 100).toFixed(1))
      : 0;

  const onTimeDeliveryRatePct =
    completedTrips > 0
      ? Number(((onTimeCompletedTrips / completedTrips) * 100).toFixed(1))
      : null;

  const costPerSuccessfulShipmentPaise =
    deliveredCount > 0 ? Math.round(totalVehiclePayoutPaise / deliveredCount) : null;

  // Only calculate CO2 if an explicit emissions factor is configured in env
  const co2Factor = env.CO2_EMISSIONS_FACTOR_KG_PER_TON_KM;
  let estimatedCo2ImpactKg: number | null = null;
  let co2Methodology =
    'CO₂ impact disabled: no CO2_EMISSIONS_FACTOR_KG_PER_TON_KM configured.';

  if (co2Factor && co2Factor > 0) {
    const totalChargeableTons =
      myShipments.reduce((sum, s) => sum + s.cargo.chargeableWeightKg, 0) / 1000;
    estimatedCo2ImpactKg = Number(
      (totalChargeableTons * totalRoadDistanceKm * co2Factor).toFixed(2)
    );
    co2Methodology = `Estimated via chargeable_tons × road_km × ${co2Factor} kg CO₂/ton-km (explicitly configured factor).`;
  }

  return {
    shipperScoped: {
      totalBookings: myShipments.length,
      deliveredCount,
      activeCount,
      failedCount,
      cancelledCount,
      totalActualOrProjectedSpendPaise,
      totalCeilingBaselinePaise,
      estimatedSavingsPaise,
      estimatedSavingsPct,
      baselineMethodology:
        'Estimated savings = Guaranteed single-shipment rate ceiling minus locked/projected pooled charges (never a hardcoded percentage claim).',
      isEstimated: true,
    },
    platformUtilization: {
      tripsCount: trips.length,
      avgVehicleWeightUtilizationPct,
      avgVehicleVolumeUtilizationPct,
      avgPoolFillLevelPct,
      totalRoadDistanceKm: Number(totalRoadDistanceKm.toFixed(1)),
      emptyReturnDistanceKm: Number(emptyReturnDistanceKm.toFixed(1)),
      costPerSuccessfulShipmentPaise,
      onTimeDeliveryRatePct,
      failedDeliveryRatePct,
      estimatedCo2ImpactKg,
      co2Methodology,
      isIllustrativeDemoData: true,
    },
  };
}
