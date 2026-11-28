import { Types } from 'mongoose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DriverContract } from '../models/DriverContract.js';
import { DriverProfile } from '../models/DriverProfile.js';
import { DriverSlotCommitment } from '../models/DriverSlotCommitment.js';
import { NotificationLog } from '../models/NotificationLog.js';
import { Trip } from '../models/Trip.js';
import { Vehicle } from '../models/Vehicle.js';
import { respondToTripAssignment } from '../services/driverAssignment.js';
import {
  allocateVehicleForPool,
  doesCargoFitVehicle,
  isVehicleAvailableForSlot,
} from '../services/fleetAllocator.js';

describe('Stage 5 Fleet Tiers, Automated Allocation & Driver Assignment (MC-018 to MC-020)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('validates vehicle weight, volume, bed dimensions, restrictions, and slot availability', () => {
    const vehicle = {
      _id: new Types.ObjectId(),
      maxWeightKg: 1200,
      maxVolumeCbm: 6,
      bedDimensionsCm: { length: 245, width: 155, height: 165 },
      operatingRestrictions: ['NO_FRAGILE'],
      isAvailable: true,
      unavailableDates: ['2026-12-01'],
      blockedSlotIds: [],
    };

    expect(
      doesCargoFitVehicle(
        [
          {
            cargo: {
              chargeableWeightKg: 400,
              volumeCbm: 2,
              unitDimensionsCm: { length: 120, width: 80, height: 60 },
              handlingRestrictions: [],
            },
          } as never,
        ],
        vehicle
      ).feasible
    ).toBe(true);

    // Oversized dimension fails
    expect(
      doesCargoFitVehicle(
        [
          {
            cargo: {
              chargeableWeightKg: 200,
              volumeCbm: 1,
              unitDimensionsCm: { length: 300, width: 80, height: 60 },
              handlingRestrictions: [],
            },
          } as never,
        ],
        vehicle
      ).feasible
    ).toBe(false);

    // Date restriction blocks availability
    expect(
      isVehicleAvailableForSlot(vehicle, {
        _id: new Types.ObjectId(),
        departureDate: new Date('2026-12-01T09:00:00Z'),
      })
    ).toBe(false);
  });

  it('prioritizes Tier 1 for contracted corridors, preserves Tier 1 min guarantee, and restricts Tier 3 to backhaul', async () => {
    const corridorId = new Types.ObjectId();
    const slotId = new Types.ObjectId();
    const driver1Id = new Types.ObjectId();

    const tier1 = {
      _id: new Types.ObjectId(),
      registrationNumber: 'GJ-06-MC-1001',
      driverId: driver1Id,
      tier: 'TIER_1',
      ownershipType: 'DRIVER_OWNED',
      operationalStatus: 'ACTIVE',
      maxWeightKg: 2500,
      maxVolumeCbm: 12.5,
      bedDimensionsCm: { length: 425, width: 195, height: 150 },
      minGuaranteePaise: 320000,
      perKmRatePaise: 2400,
      payoutModel: {
        modelType: 'MIN_GUARANTEE_PLUS_KM',
        minGuaranteePaise: 320000,
        perKmRatePaise: 2400,
        fixedTripPaise: 0,
      },
      contractedCorridorIds: [corridorId],
      contractedSlotLabels: ['AM'],
      unavailableDates: [],
      blockedSlotIds: [],
      operatingRestrictions: [],
      supportsBackhaul: false,
      isAvailable: true,
    };

    const tier2 = {
      _id: new Types.ObjectId(),
      registrationNumber: 'GJ-06-MK-2044',
      tier: 'TIER_2',
      maxWeightKg: 1200,
      maxVolumeCbm: 6.2,
      bedDimensionsCm: { length: 245, width: 155, height: 165 },
      minGuaranteePaise: 0,
      perKmRatePaise: 1900,
      payoutModel: {
        modelType: 'PER_KM',
        minGuaranteePaise: 0,
        perKmRatePaise: 1900,
        fixedTripPaise: 0,
      },
      contractedCorridorIds: [],
      contractedSlotLabels: [],
      unavailableDates: [],
      blockedSlotIds: [],
      operatingRestrictions: [],
      supportsBackhaul: false,
      isAvailable: true,
    };

    const tier3 = {
      _id: new Types.ObjectId(),
      registrationNumber: 'GJ-01-BH-3099',
      tier: 'TIER_3',
      maxWeightKg: 4000,
      maxVolumeCbm: 18,
      bedDimensionsCm: { length: 515, width: 205, height: 170 },
      minGuaranteePaise: 0,
      perKmRatePaise: 2200,
      payoutModel: {
        modelType: 'PER_KM',
        minGuaranteePaise: 0,
        perKmRatePaise: 2200,
        fixedTripPaise: 0,
      },
      contractedCorridorIds: [],
      contractedSlotLabels: [],
      unavailableDates: [],
      blockedSlotIds: [],
      operatingRestrictions: [],
      supportsBackhaul: true,
      isAvailable: true,
    };

    vi.spyOn(Vehicle, 'find').mockImplementation((() => ({
      session: vi.fn().mockResolvedValue([tier1, tier2, tier3]),
    })) as never);
    vi.spyOn(Trip, 'find').mockImplementation((() => ({
      select: vi.fn().mockReturnValue({
        session: vi.fn().mockResolvedValue([]),
      }),
    })) as never);
    vi.spyOn(DriverProfile, 'find').mockImplementation((() => ({
      session: vi.fn().mockResolvedValue([
        {
          userId: driver1Id,
          fleetTier: 'TIER_1',
          availabilityStatus: 'AVAILABLE',
          accountStatus: 'ACTIVE',
        },
      ]),
    })) as never);
    vi.spyOn(DriverContract, 'find').mockImplementation((() => ({
      session: vi.fn().mockResolvedValue([
        {
          driverUserId: driver1Id,
          status: 'ACTIVE',
          startDate: new Date('2026-01-01'),
          endDate: new Date('2027-01-01'),
          eligibleCorridorIds: [corridorId],
          minimumGuaranteeTerms: { minGuaranteePaise: 320000, perKmRatePaise: 2400 },
        },
      ]),
    })) as never);
    vi.spyOn(DriverSlotCommitment, 'find').mockImplementation((() => ({
      session: vi.fn().mockResolvedValue([
        {
          _id: new Types.ObjectId(),
          corridorId,
          slotId,
          driverUserId: driver1Id,
          driverProfileId: new Types.ObjectId(),
          vehicleId: tier1._id,
          slotNumber: 1,
          departureDate: new Date('2026-11-28'),
          selectedPickupTime: '09:00',
          selectedReturnTime: '14:00',
          status: 'LOCKED',
        },
      ]),
    })) as never);

    const outcome = await allocateVehicleForPool({
      pool: {} as never,
      corridor: { _id: corridorId } as never,
      slot: {
        _id: slotId,
        slotCode: 'GJ-VAD-AMD-01-AM',
        departureDate: new Date('2026-11-28'),
        plannedDepartureAt: new Date('2026-11-28T09:00:00Z'),
        estimatedArrivalEndAt: new Date('2026-11-28T13:30:00Z'),
      } as never,
      shipments: [
        {
          cargo: {
            chargeableWeightKg: 500,
            volumeCbm: 2,
            unitDimensionsCm: { length: 100, width: 60, height: 50 },
            handlingRestrictions: [],
          },
        } as never,
      ],
      estimatedDistanceKm: 115,
      allowRightSizing: true,
    });

    // Tier 1 is selected (not cannibalized by Tier 2 because Tier 1 guarantee + Tier 2 payout > Tier 1 payout)
    expect(outcome.allocated).toBe(true);
    expect(outcome.vehicle?.registrationNumber).toBe('GJ-06-MC-1001');
    expect(outcome.economics?.tier1MinGuaranteeIncludedPaise).toBe(320000);

    // Outbound heavy load (3000 kg) cannot use Tier 3 when isBackhaul=false -> fails safely
    const noImpossibleTrip = await allocateVehicleForPool({
      pool: {} as never,
      corridor: { _id: corridorId } as never,
      slot: {
        _id: slotId,
        slotCode: 'GJ-VAD-AMD-01-AM',
        departureDate: new Date('2026-11-28'),
        plannedDepartureAt: new Date('2026-11-28T09:00:00Z'),
        estimatedArrivalEndAt: new Date('2026-11-28T13:30:00Z'),
      } as never,
      shipments: [
        {
          cargo: {
            chargeableWeightKg: 3000,
            volumeCbm: 10,
            unitDimensionsCm: { length: 100, width: 60, height: 50 },
            handlingRestrictions: [],
          },
        } as never,
      ],
      isBackhaul: false,
    });
    expect(noImpossibleTrip.allocated).toBe(false);
  });

  it('prevents overlapping driver trips and audits + reassigns when driver declines', async () => {
    const tripId = new Types.ObjectId();
    const driver1Id = new Types.ObjectId();
    const driver2Id = new Types.ObjectId();
    const vehicleId = new Types.ObjectId();

    const saveMock = vi.fn().mockResolvedValue(undefined);
    const tripDoc = {
      _id: tripId,
      tripCode: 'MC-TRIP-001',
      driverId: driver1Id,
      vehicleId,
      status: 'ASSIGNED',
      plannedDepartureAt: new Date('2026-11-28T09:00:00Z'),
      estimatedEndAt: new Date('2026-11-28T13:30:00Z'),
      allocationEconomics: { allocatedTier: 'TIER_1' },
      assignmentHistory: [],
      save: saveMock,
    };

    // Case 1: Overlap detected on ACCEPT
    vi.spyOn(Trip, 'findOne')
      .mockImplementationOnce((() => ({
        session: vi.fn().mockResolvedValue(tripDoc),
      })) as never)
      .mockImplementationOnce((() => ({
        select: vi.fn().mockReturnValue({
          session: vi.fn().mockResolvedValue({ _id: new Types.ObjectId() }),
        }),
      })) as never);

    await expect(
      respondToTripAssignment({
        tripId: String(tripId),
        driverUserId: String(driver1Id),
        decision: 'ACCEPT',
      })
    ).rejects.toThrow(/overlapping active trip/i);

    // Case 2: Decline triggers auditable DECLINED + REASSIGNED to driver2
    vi.spyOn(Trip, 'findOne')
      .mockImplementationOnce((() => ({
        session: vi.fn().mockResolvedValue(tripDoc),
      })) as never)
      .mockImplementationOnce((() => ({
        select: vi.fn().mockReturnValue({
          session: vi.fn().mockResolvedValue(null),
        }),
      })) as never);

    vi.spyOn(DriverProfile, 'find').mockImplementation((() => ({
      sort: vi.fn().mockReturnValue({
        session: vi.fn().mockResolvedValue([
          {
            userId: driver2Id,
            fleetTier: 'TIER_2',
            tier2ApplicationStatus: 'APPROVED',
            accountStatus: 'ACTIVE',
            availabilityStatus: 'AVAILABLE',
          },
        ]),
      }),
    })) as never);

    vi.spyOn(NotificationLog, 'findOneAndUpdate').mockResolvedValue({} as never);

    const declined = await respondToTripAssignment({
      tripId: String(tripId),
      driverUserId: String(driver1Id),
      decision: 'REJECT',
      reason: 'Truck under repair',
    });

    expect(declined.reassigned).toBe(true);
    expect(String(tripDoc.driverId)).toBe(String(driver2Id));
    expect(tripDoc.assignmentHistory.map((h: { action: string }) => h.action)).toEqual([
      'DECLINED',
      'REASSIGNED',
    ]);
  });
});
