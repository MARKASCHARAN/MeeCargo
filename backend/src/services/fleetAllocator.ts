import type { ClientSession } from 'mongoose';
import type { ICorridor } from '../models/Corridor.js';
import type { IPool } from '../models/Pool.js';
import type { IShipment } from '../models/Shipment.js';
import type { ISlot } from '../models/Slot.js';
import { Trip, type TripAllocationEconomics } from '../models/Trip.js';
import { Vehicle, type BedDimensionsCm, type IVehicle } from '../models/Vehicle.js';

export interface VehicleFeasibilityResult {
  feasible: boolean;
  reason?: string;
}

export function doesCargoFitVehicle(
  shipments: Array<Pick<IShipment, 'cargo'>>,
  vehicle: Pick<
    IVehicle,
    'maxWeightKg' | 'maxVolumeCbm' | 'bedDimensionsCm' | 'operatingRestrictions'
  >
): VehicleFeasibilityResult {
  const totalWeight = shipments.reduce(
    (sum, s) => sum + s.cargo.chargeableWeightKg,
    0
  );
  const totalVolume = shipments.reduce((sum, s) => sum + s.cargo.volumeCbm, 0);

  if (totalWeight > vehicle.maxWeightKg) {
    return {
      feasible: false,
      reason: `Total weight (${totalWeight} kg) exceeds vehicle max (${vehicle.maxWeightKg} kg)`,
    };
  }

  if (totalVolume > vehicle.maxVolumeCbm) {
    return {
      feasible: false,
      reason: `Total volume (${totalVolume} m³) exceeds vehicle max (${vehicle.maxVolumeCbm} m³)`,
    };
  }

  const bed: BedDimensionsCm = vehicle.bedDimensionsCm;
  const bedFootprintMax = Math.max(bed.length, bed.width);
  const bedFootprintMin = Math.min(bed.length, bed.width);

  for (const s of shipments) {
    const { length, width, height } = s.cargo.unitDimensionsCm;
    const itemFootprintMax = Math.max(length, width);
    const itemFootprintMin = Math.min(length, width);

    if (
      height > bed.height ||
      itemFootprintMax > bedFootprintMax ||
      itemFootprintMin > bedFootprintMin
    ) {
      return {
        feasible: false,
        reason: `Cargo item (${length}×${width}×${height} cm) does not fit truck bed (${bed.length}×${bed.width}×${bed.height} cm)`,
      };
    }

    const blockedRestriction = (s.cargo.handlingRestrictions ?? []).find((r) =>
      (vehicle.operatingRestrictions ?? []).includes(`NO_${r.toUpperCase()}`)
    );
    if (blockedRestriction) {
      return {
        feasible: false,
        reason: `Vehicle operating restriction blocks ${blockedRestriction}`,
      };
    }
  }

  return { feasible: true };
}

export function isVehicleAvailableForSlot(
  vehicle: Pick<
    IVehicle,
    '_id' | 'isAvailable' | 'unavailableDates' | 'blockedSlotIds'
  >,
  slot: Pick<ISlot, '_id' | 'departureDate'>
): boolean {
  if (!vehicle.isAvailable) return false;
  const dateKey = new Date(slot.departureDate).toISOString().slice(0, 10);
  if (vehicle.unavailableDates?.includes(dateKey)) return false;
  if (vehicle.blockedSlotIds?.some((id) => id.equals(slot._id))) return false;
  return true;
}

export function computeVehiclePayoutPaise(
  vehicle: Pick<IVehicle, 'minGuaranteePaise' | 'perKmRatePaise' | 'payoutModel'>,
  estimatedDistanceKm: number
): number {
  const model = vehicle.payoutModel;
  const minGuarantee = model?.minGuaranteePaise ?? vehicle.minGuaranteePaise ?? 0;
  const perKm = model?.perKmRatePaise ?? vehicle.perKmRatePaise ?? 2000;
  const fixed = model?.fixedTripPaise ?? 0;

  if (model?.modelType === 'FIXED_TRIP' && fixed > 0) {
    return fixed;
  }
  const distanceCost = Math.round(perKm * estimatedDistanceKm);
  return Math.max(minGuarantee, distanceCost);
}

export interface FleetAllocationOutcome {
  allocated: boolean;
  vehicle?: IVehicle;
  economics?: TripAllocationEconomics;
  reason: string;
}

export async function allocateVehicleForPool(params: {
  pool: IPool;
  corridor: ICorridor;
  slot: ISlot;
  shipments: IShipment[];
  estimatedDistanceKm?: number;
  allowRightSizing?: boolean;
  isBackhaul?: boolean;
  session?: ClientSession | null;
}): Promise<FleetAllocationOutcome> {
  const {
    corridor,
    slot,
    shipments,
    estimatedDistanceKm = 115,
    allowRightSizing = true,
    isBackhaul = false,
    session = null,
  } = params;

  if (shipments.length === 0) {
    return {
      allocated: false,
      reason: 'Cannot allocate vehicle for an empty pool.',
    };
  }

  const allVehicles = await Vehicle.find({ isAvailable: true }).session(session);
  const busyVehicleDocs = await Trip.find({
    status: { $in: ['ASSIGNED', 'DRIVER_ACCEPTED', 'IN_PROGRESS', 'PAUSED'] },
    plannedDepartureAt: { $lt: slot.estimatedArrivalEndAt },
    estimatedEndAt: { $gt: slot.plannedDepartureAt },
  })
    .select('vehicleId')
    .session(session);

  const busyVehicleIds = new Set(busyVehicleDocs.map((t) => String(t.vehicleId)));

  const candidateVehicles = allVehicles.filter(
    (v) =>
      !busyVehicleIds.has(String(v._id)) &&
      isVehicleAvailableForSlot(v, slot) &&
      doesCargoFitVehicle(shipments, v).feasible
  );

  // 1. Tier 1 contracted vehicles for this corridor & schedule
  const contractedTier1All = allVehicles.filter(
    (v) =>
      v.tier === 'TIER_1' &&
      v.contractedCorridorIds.some((cid) => cid.equals(corridor._id))
  );
  const tier1ContractedMinGuarantee = contractedTier1All.reduce(
    (maxG, v) =>
      Math.max(maxG, v.payoutModel?.minGuaranteePaise ?? v.minGuaranteePaise ?? 0),
    0
  );

  const feasibleTier1 = candidateVehicles.filter((v) => {
    if (v.tier !== 'TIER_1') return false;
    if (!v.contractedCorridorIds.some((cid) => cid.equals(corridor._id))) return false;
    if (v.contractedSlotLabels?.length > 0) {
      return v.contractedSlotLabels.some((lbl) =>
        slot.slotCode.toUpperCase().includes(lbl.toUpperCase())
      );
    }
    return true;
  });

  // Sort Tier 1 by smallest vehicle that fits (right-sizing within Tier 1 first)
  feasibleTier1.sort((a, b) => a.maxWeightKg - b.maxWeightKg);

  const feasibleTier2 = candidateVehicles
    .filter((v) => v.tier === 'TIER_2')
    .sort((a, b) => a.maxWeightKg - b.maxWeightKg);

  // Policy: Tier 1 is considered first for its contracted corridor/slot.
  if (feasibleTier1.length > 0) {
    const bestTier1 = feasibleTier1[0];
    const tier1Payout = computeVehiclePayoutPaise(bestTier1, estimatedDistanceKm);

    // Optional right-sizing to Tier 2 ONLY when Tier 1 guarantee is still preserved
    // and total combined cost (Tier 1 min guarantee + Tier 2 payout) is strictly lower.
    if (allowRightSizing && feasibleTier2.length > 0) {
      const bestTier2 = feasibleTier2[0];
      const tier2Payout = computeVehiclePayoutPaise(bestTier2, estimatedDistanceKm);
      const combinedRightSizedCost = tier1ContractedMinGuarantee + tier2Payout;

      if (combinedRightSizedCost < tier1Payout) {
        return {
          allocated: true,
          vehicle: bestTier2,
          economics: {
            allocatedTier: 'TIER_2',
            tier1MinGuaranteeIncludedPaise: tier1ContractedMinGuarantee,
            selectedVehicleMinGuaranteePaise:
              bestTier2.payoutModel?.minGuaranteePaise ?? 0,
            estimatedDistanceKm,
            estimatedVehiclePayoutPaise: tier2Payout,
            rightSized: true,
            reason:
              'Right-sized to smaller Tier 2 vehicle while preserving Tier 1 contractual minimum guarantee in economics.',
          },
          reason: 'Allocated right-sized Tier 2 vehicle with Tier 1 guarantee preserved.',
        };
      }
    }

    return {
      allocated: true,
      vehicle: bestTier1,
      economics: {
        allocatedTier: 'TIER_1',
        tier1MinGuaranteeIncludedPaise:
          bestTier1.payoutModel?.minGuaranteePaise ?? bestTier1.minGuaranteePaise ?? 0,
        selectedVehicleMinGuaranteePaise:
          bestTier1.payoutModel?.minGuaranteePaise ?? bestTier1.minGuaranteePaise ?? 0,
        estimatedDistanceKm,
        estimatedVehiclePayoutPaise: tier1Payout,
        rightSized: false,
        reason: 'Allocated contracted Tier 1 attached vehicle.',
      },
      reason: 'Allocated contracted Tier 1 attached vehicle.',
    };
  }

  // 2. Tier 2 overflow / express when no feasible Tier 1 is available
  if (feasibleTier2.length > 0) {
    const bestTier2 = feasibleTier2[0];
    const tier2Payout = computeVehiclePayoutPaise(bestTier2, estimatedDistanceKm);
    return {
      allocated: true,
      vehicle: bestTier2,
      economics: {
        allocatedTier: 'TIER_2',
        tier1MinGuaranteeIncludedPaise: tier1ContractedMinGuarantee,
        selectedVehicleMinGuaranteePaise:
          bestTier2.payoutModel?.minGuaranteePaise ?? 0,
        estimatedDistanceKm,
        estimatedVehiclePayoutPaise: tier2Payout,
        rightSized: false,
        reason:
          'Allocated Tier 2 marketplace vehicle for overflow/non-contracted capacity; Tier 1 guarantee accounted if applicable.',
      },
      reason: 'Allocated Tier 2 marketplace vehicle.',
    };
  }

  // 3. Tier 3 is considered strictly for return/backhaul work
  if (isBackhaul) {
    const feasibleTier3 = candidateVehicles
      .filter((v) => v.tier === 'TIER_3' && v.supportsBackhaul)
      .sort((a, b) => a.maxWeightKg - b.maxWeightKg);

    if (feasibleTier3.length > 0) {
      const bestTier3 = feasibleTier3[0];
      const tier3Payout = computeVehiclePayoutPaise(bestTier3, estimatedDistanceKm);
      return {
        allocated: true,
        vehicle: bestTier3,
        economics: {
          allocatedTier: 'TIER_3',
          tier1MinGuaranteeIncludedPaise: tier1ContractedMinGuarantee,
          selectedVehicleMinGuaranteePaise: 0,
          estimatedDistanceKm,
          estimatedVehiclePayoutPaise: tier3Payout,
          rightSized: false,
          reason: 'Allocated Tier 3 empty-return partner for backhaul work.',
        },
        reason: 'Allocated Tier 3 backhaul vehicle.',
      };
    }
  }

  // Fail safely — never create an impossible trip
  return {
    allocated: false,
    reason:
      'No feasible vehicle meets weight, volume, dimension, schedule, and fleet tier requirements. Flagged for rollover or refund.',
  };
}
