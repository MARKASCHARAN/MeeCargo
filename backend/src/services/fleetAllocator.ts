import type { ClientSession } from 'mongoose';
import type { ICorridor } from '../models/Corridor.js';
import { DriverContract } from '../models/DriverContract.js';
import { DriverProfile } from '../models/DriverProfile.js';
import {
  DriverSlotCommitment,
  type IDriverSlotCommitment,
} from '../models/DriverSlotCommitment.js';
import type { IPool } from '../models/Pool.js';
import type { IShipment } from '../models/Shipment.js';
import type { ISlot } from '../models/Slot.js';
import { Trip, type TripAllocationEconomics } from '../models/Trip.js';
import { Vehicle, type BedDimensionsCm, type IVehicle } from '../models/Vehicle.js';
import { isSameCalendarDay, resolveSlotNumber } from './driverSlotService.js';

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
  > & { operationalStatus?: IVehicle['operationalStatus'] },
  slot: Pick<ISlot, '_id' | 'departureDate'>
): boolean {
  if (!vehicle.isAvailable) return false;
  if (vehicle.operationalStatus && vehicle.operationalStatus !== 'ACTIVE') return false;
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

function matchesCorridorSlotSchedule(
  corridor: Pick<ICorridor, 'slotSchedules'>,
  slot: Pick<ISlot, 'slotNumber' | 'slotCode'>
): boolean {
  if (!corridor.slotSchedules || corridor.slotSchedules.length === 0) {
    return true;
  }
  if (slot.slotNumber === 1 || slot.slotNumber === 2) {
    return corridor.slotSchedules.some((s) => s.slotNumber === slot.slotNumber);
  }
  const codeUpper = slot.slotCode.toUpperCase();
  if (codeUpper.endsWith('-AM') || codeUpper.includes('SLOT1')) {
    return corridor.slotSchedules.some((s) => s.slotNumber === 1);
  }
  if (codeUpper.endsWith('-PM') || codeUpper.includes('SLOT2')) {
    return corridor.slotSchedules.some((s) => s.slotNumber === 2);
  }
  return true;
}

export interface FleetAllocationOutcome {
  allocated: boolean;
  vehicle?: IVehicle;
  commitment?: IDriverSlotCommitment;
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

  // Validate configured central corridor slot schedule relationship
  if (!matchesCorridorSlotSchedule(corridor, slot)) {
    return {
      allocated: false,
      reason: 'Selected slot does not match configured corridor pickup and return schedule.',
    };
  }

  // Sequential queries when inside MongoDB transaction session
  const allVehicles = await Vehicle.find({ isAvailable: true }).session(session);
  const busyTrips = await Trip.find({
    status: { $in: ['ASSIGNED', 'DRIVER_ACCEPTED', 'IN_PROGRESS', 'PAUSED'] },
    plannedDepartureAt: { $lt: slot.estimatedArrivalEndAt },
    estimatedEndAt: { $gt: slot.plannedDepartureAt },
  })
    .select('vehicleId driverId')
    .session(session);

  const tier1Profiles = await DriverProfile.find({ fleetTier: 'TIER_1' }).session(session);
  const activeContracts = await DriverContract.find({ status: 'ACTIVE' }).session(session);
  // MC-051: Allocation consumes ONLY valid LOCKED slot commitments for this exact corridor/slot/date.
  const slotCommitments = await DriverSlotCommitment.find({
    slotId: slot._id,
    status: 'LOCKED',
  }).session(session);

  const busyVehicleIds = new Set(busyTrips.map((t) => String(t.vehicleId)));
  const busyDriverIds = new Set(busyTrips.map((t) => String(t.driverId)));

  const profileByDriverId = new Map(tier1Profiles.map((p) => [String(p.userId), p]));
  const slotNum = resolveSlotNumber(slot);
  const commitmentByDriverId = new Map(
    slotCommitments
      .filter((c) => {
        if (String(c.corridorId) !== String(corridor._id)) return false;
        if (String(c.slotId) !== String(slot._id)) return false;
        if (!isSameCalendarDay(new Date(c.departureDate), new Date(slot.departureDate))) {
          return false;
        }
        if (slotNum && c.slotNumber !== slotNum) return false;
        return true;
      })
      .map((c) => [String(c.driverUserId), c])
  );
  const slotDateMs = new Date(slot.departureDate).getTime();

  const activeContractByDriverId = new Map(
    activeContracts
      .filter((c) => {
        const startMs = new Date(c.startDate).getTime();
        const endMs = new Date(c.endDate).getTime();
        return slotDateMs >= startMs && slotDateMs <= endMs;
      })
      .map((c) => [String(c.driverUserId), c])
  );

  const candidateVehicles = allVehicles.filter(
    (v) =>
      !busyVehicleIds.has(String(v._id)) &&
      isVehicleAvailableForSlot(v, slot) &&
      doesCargoFitVehicle(shipments, v).feasible
  );

  // Determine contractual Tier 1 min guarantee baseline across active corridor-eligible Tier 1 contracts
  const contractedTier1All = allVehicles.filter((v) => {
    if (v.tier !== 'TIER_1') return false;
    const contract = v.driverId ? activeContractByDriverId.get(String(v.driverId)) : undefined;
    if (contract) {
      return contract.eligibleCorridorIds.some((cid) => cid.equals(corridor._id));
    }
    return v.contractedCorridorIds.some((cid) => cid.equals(corridor._id));
  });

  const tier1ContractedMinGuarantee = contractedTier1All.reduce((maxG, v) => {
    const contract = v.driverId ? activeContractByDriverId.get(String(v.driverId)) : undefined;
    const guarantee =
      contract?.minimumGuaranteeTerms?.minGuaranteePaise ??
      v.payoutModel?.minGuaranteePaise ??
      v.minGuaranteePaise ??
      0;
    return Math.max(maxG, guarantee);
  }, 0);

  // 1. Tier 1 driver-owned contract vehicles eligible for this corridor & slot schedule
  const feasibleTier1 = candidateVehicles.filter((v) => {
    if (v.tier !== 'TIER_1') return false;
    if (v.ownershipType && v.ownershipType !== 'DRIVER_OWNED') return false;
    if (!v.driverId) return false;

    const driverIdStr = String(v.driverId);
    if (busyDriverIds.has(driverIdStr)) return false;

    const driverProfile = profileByDriverId.get(driverIdStr);
    if (!driverProfile) return false;
    if (driverProfile.accountStatus && driverProfile.accountStatus !== 'ACTIVE') return false;
    if (driverProfile.availabilityStatus !== 'AVAILABLE') return false;

    const contract = activeContractByDriverId.get(driverIdStr);
    if (!contract || contract.status !== 'ACTIVE') return false;

    const corridorAllowed = contract.eligibleCorridorIds.some((cid) =>
      cid.equals(corridor._id)
    );
    if (!corridorAllowed) return false;

    // MC-048/MC-049/MC-050: Tier 1 participation is derived from validated pooling-window
    // slot commitments rather than permanent contract slot assignments.
    const commitment = commitmentByDriverId.get(driverIdStr);
    if (!commitment) return false;
    if (commitment.vehicleId && String(commitment.vehicleId) !== String(v._id)) {
      return false;
    }
    return true;
  });

  // Sort Tier 1 by smallest driver-owned vehicle that fits
  feasibleTier1.sort((a, b) => a.maxWeightKg - b.maxWeightKg);

  const feasibleTier2 = candidateVehicles
    .filter((v) => v.tier === 'TIER_2')
    .sort((a, b) => a.maxWeightKg - b.maxWeightKg);

  // Policy: Tier 1 driver-owned contracted capacity with valid slot commitment is evaluated first
  if (feasibleTier1.length > 0) {
    const bestTier1 = feasibleTier1[0];
    const selectedCommitment = commitmentByDriverId.get(String(bestTier1.driverId));
    const contract = activeContractByDriverId.get(String(bestTier1.driverId));
    const minG =
      contract?.minimumGuaranteeTerms?.minGuaranteePaise ??
      bestTier1.payoutModel?.minGuaranteePaise ??
      bestTier1.minGuaranteePaise ??
      0;
    const perKm =
      contract?.minimumGuaranteeTerms?.perKmRatePaise ??
      bestTier1.payoutModel?.perKmRatePaise ??
      bestTier1.perKmRatePaise ??
      2400;
    const tier1Payout = Math.max(minG, Math.round(perKm * estimatedDistanceKm));

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
              'Right-sized to smaller Tier 2 marketplace vehicle while preserving Tier 1 contractual minimum guarantee in economics.',
          },
          reason: 'Allocated right-sized Tier 2 vehicle with Tier 1 guarantee preserved.',
        };
      }
    }

    return {
      allocated: true,
      vehicle: bestTier1,
      commitment: selectedCommitment,
      economics: {
        allocatedTier: 'TIER_1',
        tier1MinGuaranteeIncludedPaise: minG,
        selectedVehicleMinGuaranteePaise: minG,
        estimatedDistanceKm,
        estimatedVehiclePayoutPaise: tier1Payout,
        rightSized: false,
        reason: 'Allocated Tier 1 driver-owned contract vehicle with validated slot commitment.',
      },
      reason: 'Allocated Tier 1 driver-owned contract vehicle with validated slot commitment.',
    };
  }

  // 2. Tier 2 independent marketplace overflow / non-contracted capacity
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

  // 3. Tier 3 strictly for return/backhaul work
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
      'No feasible driver-owned or marketplace vehicle meets weight, volume, dimension, contract, schedule, and fleet tier requirements. Flagged for rollover or refund.',
  };
}
