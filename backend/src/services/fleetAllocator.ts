import type { ClientSession } from 'mongoose';
import type { ICorridor } from '../models/Corridor.js';
import { DriverContract } from '../models/DriverContract.js';
import { DriverProfile } from '../models/DriverProfile.js';
import {
  DriverSlotCommitment,
  type IDriverSlotCommitment,
} from '../models/DriverSlotCommitment.js';
import type { IPool, PoolAllocationCandidateAudit } from '../models/Pool.js';
import type { IShipment } from '../models/Shipment.js';
import type { ISlot } from '../models/Slot.js';
import { Trip, type TripAllocationEconomics } from '../models/Trip.js';
import { Vehicle, type BedDimensionsCm, type IVehicle } from '../models/Vehicle.js';
import {
  isContractActiveOnServiceDate,
  isSameCalendarDay,
  resolveSlotNumber,
} from './driverSlotService.js';

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
  const totalBedAreaSqCm = bed.length * bed.width;
  let nonStackableFloorAreaSqCm = 0;

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

    if (s.cargo.stackable === false) {
      const qty = Math.max(1, s.cargo.quantity ?? 1);
      nonStackableFloorAreaSqCm += length * width * qty;
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

  if (nonStackableFloorAreaSqCm > totalBedAreaSqCm) {
    return {
      feasible: false,
      reason: `Non-stackable cargo floor footprint (${nonStackableFloorAreaSqCm} cm²) exceeds vehicle bed floor area (${totalBedAreaSqCm} cm²)`,
    };
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
  candidateAudit?: PoolAllocationCandidateAudit[];
  reason: string;
}

export async function allocateVehicleForPool(params: {
  pool: IPool;
  corridor: ICorridor;
  slot: ISlot;
  shipments: IShipment[];
  estimatedDistanceKm?: number;
  allowRightSizing?: boolean;
  allowMarketplaceFallback?: boolean;
  isBackhaul?: boolean;
  session?: ClientSession | null;
}): Promise<FleetAllocationOutcome> {
  const {
    corridor,
    slot,
    shipments,
    estimatedDistanceKm = 115,
    allowRightSizing = false,
    allowMarketplaceFallback = false,
    isBackhaul = false,
    session = null,
  } = params;
  const candidateAudit: PoolAllocationCandidateAudit[] = [];
  const auditNow = new Date();
  const recordAudit = (
    v: Pick<IVehicle, '_id' | 'driverId' | 'registrationNumber' | 'tier'>,
    decision: 'ACCEPTED' | 'REJECTED',
    reason: string
  ) => {
    candidateAudit.push({
      vehicleId: v._id,
      ...(v.driverId ? { driverUserId: v.driverId } : {}),
      registrationNumber: v.registrationNumber,
      tier: v.tier,
      decision,
      reason,
      at: auditNow,
    });
  };

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

  const relevantProfiles = await DriverProfile.find({
    fleetTier: { $in: ['TIER_1', 'TIER_2'] },
  }).session(session);
  const tier1Profiles = relevantProfiles.filter((p) => p.fleetTier === 'TIER_1');
  const tier2ProfilesByDriverId = new Map(
    relevantProfiles
      .filter((p) => p.fleetTier === 'TIER_2')
      .map((p) => [String(p.userId), p])
  );
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
  const activeContractByDriverId = new Map(
    activeContracts
      .filter((c) =>
        isContractActiveOnServiceDate(
          c,
          slot.departureDate,
          corridor.timezone ?? 'Asia/Kolkata'
        )
      )
      .map((c) => [String(c.driverUserId), c])
  );

  const candidateVehicles = allVehicles.filter((v) => {
    if (busyVehicleIds.has(String(v._id))) {
      recordAudit(v, 'REJECTED', 'Vehicle already assigned to overlapping active trip');
      return false;
    }
    if (!isVehicleAvailableForSlot(v, slot)) {
      recordAudit(v, 'REJECTED', 'Vehicle unavailable or operationally inactive for slot date');
      return false;
    }
    const fit = doesCargoFitVehicle(shipments, v);
    if (!fit.feasible) {
      recordAudit(v, 'REJECTED', fit.reason ?? 'Cargo fails vehicle capacity/dimension fit');
      return false;
    }
    return true;
  });

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
    if (v.ownershipType && v.ownershipType !== 'DRIVER_OWNED') {
      recordAudit(v, 'REJECTED', 'Tier 1 vehicle is not DRIVER_OWNED');
      return false;
    }
    if (!v.driverId) {
      recordAudit(v, 'REJECTED', 'Tier 1 vehicle has no owning driverId');
      return false;
    }

    const driverIdStr = String(v.driverId);
    if (busyDriverIds.has(driverIdStr)) {
      recordAudit(v, 'REJECTED', 'Driver is already assigned to overlapping trip');
      return false;
    }

    const driverProfile = profileByDriverId.get(driverIdStr);
    if (!driverProfile) {
      recordAudit(v, 'REJECTED', 'No active Tier 1 DriverProfile found');
      return false;
    }
    if (driverProfile.accountStatus && driverProfile.accountStatus !== 'ACTIVE') {
      recordAudit(v, 'REJECTED', `Driver account status is ${driverProfile.accountStatus}`);
      return false;
    }
    if (driverProfile.availabilityStatus !== 'AVAILABLE') {
      recordAudit(v, 'REJECTED', `Driver availability status is ${driverProfile.availabilityStatus}`);
      return false;
    }

    const contract = activeContractByDriverId.get(driverIdStr);
    if (!contract || contract.status !== 'ACTIVE') {
      recordAudit(v, 'REJECTED', 'No active contract covers slot operating date');
      return false;
    }

    const corridorAllowed = contract.eligibleCorridorIds.some((cid) =>
      cid.equals(corridor._id)
    );
    if (!corridorAllowed) {
      recordAudit(v, 'REJECTED', 'Driver contract does not include this corridor');
      return false;
    }

    // MC-048/MC-049/MC-050: Tier 1 participation is derived from validated pooling-window
    // slot commitments rather than permanent contract slot assignments.
    const commitment = commitmentByDriverId.get(driverIdStr);
    if (!commitment) {
      recordAudit(v, 'REJECTED', 'No matching LOCKED slot commitment for this slot/date/corridor');
      return false;
    }
    if (commitment.vehicleId && String(commitment.vehicleId) !== String(v._id)) {
      recordAudit(v, 'REJECTED', 'Vehicle does not match vehicle recorded on LOCKED commitment');
      return false;
    }
    return true;
  });

  // Sort Tier 1 by smallest driver-owned vehicle that fits
  feasibleTier1.sort((a, b) => a.maxWeightKg - b.maxWeightKg);

  const feasibleTier2 = allowMarketplaceFallback
    ? candidateVehicles
        .filter((v) => {
          if (v.tier !== 'TIER_2') return false;
          if (v.driverId) {
            const dp = tier2ProfilesByDriverId.get(String(v.driverId));
            if (dp && (dp.accountStatus !== 'ACTIVE' || dp.tier2ApplicationStatus !== 'APPROVED')) {
              recordAudit(v, 'REJECTED', 'Tier 2 applicant is not APPROVED/ACTIVE');
              return false;
            }
          }
          return true;
        })
        .sort((a, b) => a.maxWeightKg - b.maxWeightKg)
    : [];

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

    if (allowRightSizing && allowMarketplaceFallback && feasibleTier2.length > 0) {
      const bestTier2 = feasibleTier2[0];
      const tier2Payout = computeVehiclePayoutPaise(bestTier2, estimatedDistanceKm);
      const combinedRightSizedCost = tier1ContractedMinGuarantee + tier2Payout;

      if (combinedRightSizedCost < tier1Payout) {
        recordAudit(bestTier2, 'ACCEPTED', 'Right-sized Tier 2 marketplace vehicle with Tier 1 guarantee preserved');
        return {
          allocated: true,
          vehicle: bestTier2,
          candidateAudit,
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

    recordAudit(bestTier1, 'ACCEPTED', 'Allocated Tier 1 driver-owned contract vehicle with validated LOCKED slot commitment');
    for (const runnerUp of feasibleTier1.slice(1)) {
      recordAudit(runnerUp, 'REJECTED', 'Valid candidate not selected (right-sized smaller Tier 1 vehicle selected)');
    }
    return {
      allocated: true,
      vehicle: bestTier1,
      commitment: selectedCommitment,
      candidateAudit,
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

  // 2. Tier 2 independent marketplace overflow ONLY when explicitly enabled (outside Tier 1 MVP pool phase)
  if (allowMarketplaceFallback && feasibleTier2.length > 0) {
    const bestTier2 = feasibleTier2[0];
    const tier2Payout = computeVehiclePayoutPaise(bestTier2, estimatedDistanceKm);
    recordAudit(bestTier2, 'ACCEPTED', 'Allocated Tier 2 marketplace vehicle');
    return {
      allocated: true,
      vehicle: bestTier2,
      candidateAudit,
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

  // 3. Tier 3 strictly for return/backhaul work when explicitly enabled
  if (isBackhaul && allowMarketplaceFallback) {
    const feasibleTier3 = candidateVehicles
      .filter((v) => v.tier === 'TIER_3' && v.supportsBackhaul)
      .sort((a, b) => a.maxWeightKg - b.maxWeightKg);

    if (feasibleTier3.length > 0) {
      const bestTier3 = feasibleTier3[0];
      const tier3Payout = computeVehiclePayoutPaise(bestTier3, estimatedDistanceKm);
      recordAudit(bestTier3, 'ACCEPTED', 'Allocated Tier 3 backhaul vehicle');
      return {
        allocated: true,
        vehicle: bestTier3,
        candidateAudit,
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
    candidateAudit,
    reason:
      'No feasible locked Tier 1 driver-owned vehicle meets weight, volume, dimension, contract, and schedule requirements. Flagged for rollover or refund.',
  };
}
