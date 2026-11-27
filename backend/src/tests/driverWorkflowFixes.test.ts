import { Types } from 'mongoose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BackhaulRequest } from '../models/BackhaulRequest.js';
import { Corridor } from '../models/Corridor.js';
import { DriverContract } from '../models/DriverContract.js';
import { DriverProfile } from '../models/DriverProfile.js';
import { DriverSlotCommitment } from '../models/DriverSlotCommitment.js';
import { NotificationLog } from '../models/NotificationLog.js';
import { Pool } from '../models/Pool.js';
import { RouteMatrixCache } from '../models/RouteMatrixCache.js';
import { Shipment } from '../models/Shipment.js';
import { Slot } from '../models/Slot.js';
import { Trip } from '../models/Trip.js';
import { Vehicle } from '../models/Vehicle.js';
import { evaluateBackhaulForTrip } from '../services/backhaulService.js';
import { allocateAndAssignTripForPool } from '../services/driverAssignment.js';
import {
  evaluateWindowConflictsFromRecords,
  listOpenPoolingSlotsForDriver,
} from '../services/driverSlotService.js';
import { allocateVehicleForPool } from '../services/fleetAllocator.js';
import { buildLifoLoadingPlan } from '../services/loadingPlanService.js';
import { optimizeAndPlanTripRoute } from '../services/routePlanningService.js';
import {
  scanShipmentQrForPickup,
  transitionTripExecutionState,
} from '../services/tripExecutionService.js';

describe('MC-051 to MC-057: Driver Workflow Integrity, Overlaps, Loading Plan, Return Plan & Route Versioning', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('MC-051 & Journeys A/B: enforces locked commitment consistency, NOT_ALLOCATED outcomes, and blocks uncommitted/wrong-slot trips', async () => {
    const corridorId = new Types.ObjectId();
    const slot1Id = new Types.ObjectId();
    const slot2Id = new Types.ObjectId();
    const poolId = new Types.ObjectId();
    const driver1Id = new Types.ObjectId();
    const driver2Id = new Types.ObjectId();
    const vehicle1Id = new Types.ObjectId();
    const vehicle2Id = new Types.ObjectId();
    const serviceDate = new Date('2026-11-29T00:00:00.000Z');

    const slot2Obj = {
      _id: slot2Id,
      corridorId,
      slotNumber: 2 as const,
      slotCode: 'GJ-VAD-AMD-01-20261129-SLOT2',
      label: 'Pickup Slot 2 (12:30)',
      departureDate: serviceDate,
      plannedDepartureAt: new Date('2026-11-29T07:00:00.000Z'),
      estimatedArrivalEndAt: new Date('2026-11-29T11:00:00.000Z'),
      returnTimeOptions: ['16:30'],
      returnTimeLocked: true,
      lockedReturnTime: '16:30',
    };

    const corridorObj = {
      _id: corridorId,
      code: 'GJ-VAD-AMD-01',
      name: 'Vadodara - Ahmedabad',
      stops: [
        { stopCode: 'VAD', name: 'Vadodara', sequenceOrder: 0, location: { coordinates: [73.18, 22.30] } },
        { stopCode: 'AMD', name: 'Ahmedabad', sequenceOrder: 1, location: { coordinates: [72.57, 23.02] } },
      ],
      slotSchedules: [
        { slotNumber: 1, outboundPickupTime: '09:00', returnTimeOptions: ['14:00'], defaultReturnTime: '14:00', returnTimeLocked: false },
        { slotNumber: 2, outboundPickupTime: '12:30', returnTimeOptions: ['16:30'], defaultReturnTime: '16:30', returnTimeLocked: true, lockedReturnTime: '16:30' },
      ],
    };

    const tier1Vehicle = {
      _id: vehicle1Id,
      registrationNumber: 'GJ-06-MC-1001',
      vehicleClass: '14ft LCV',
      bodyType: 'CLOSED_BODY',
      ownershipType: 'DRIVER_OWNED',
      driverId: driver1Id,
      tier: 'TIER_1',
      operationalStatus: 'ACTIVE',
      isAvailable: true,
      maxWeightKg: 2500,
      maxVolumeCbm: 12.5,
      bedDimensionsCm: { length: 425, width: 195, height: 150 },
      payoutModel: { modelType: 'MIN_GUARANTEE_PLUS_KM', minGuaranteePaise: 320000, perKmRatePaise: 2400 },
      contractedCorridorIds: [corridorId],
      unavailableDates: [],
      blockedSlotIds: [],
      operatingRestrictions: [],
    };

    const shipments = [
      {
        _id: new Types.ObjectId(),
        reference: 'MC-SHP-1',
        deliveryStopCode: 'AMD',
        cargo: {
          chargeableWeightKg: 600,
          volumeCbm: 3.0,
          unitDimensionsCm: { length: 100, width: 80, height: 60 },
          handlingRestrictions: [],
        },
      },
    ];

    // Scenario 1 (Journey B): Driver 1 committed to Slot 1 only, NOT Slot 2.
    // Even if DriverSlotCommitment on Slot 2 is empty or only open COMMITTED (not LOCKED), allocation must NOT assign Slot 2 to Driver 1!
    vi.spyOn(Vehicle, 'find').mockReturnValueOnce({ session: vi.fn().mockResolvedValue([tier1Vehicle]) } as never);
    vi.spyOn(Trip, 'find').mockReturnValueOnce({
      select: vi.fn().mockReturnValue({ session: vi.fn().mockResolvedValue([]) }),
    } as never);
    vi.spyOn(DriverProfile, 'find').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue([
        { userId: driver1Id, fleetTier: 'TIER_1', availabilityStatus: 'AVAILABLE', accountStatus: 'ACTIVE' },
      ]),
    } as never);
    vi.spyOn(DriverContract, 'find').mockReturnValueOnce({
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
    } as never);
    // DB query for status: 'LOCKED' on slot2 returns [] because Driver 1 never locked Slot 2
    const lockQuerySpy = vi.spyOn(DriverSlotCommitment, 'find').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue([]),
    } as never);

    const slot2Allocation = await allocateVehicleForPool({
      pool: {} as never,
      corridor: corridorObj as never,
      slot: slot2Obj as never,
      shipments: shipments as never,
    });
    expect(lockQuerySpy).toHaveBeenCalledWith({ slotId: slot2Id, status: 'LOCKED' });
    expect(slot2Allocation.allocated).toBe(false);

    // Scenario 2 (Journey A + multiple committed drivers): Driver 1 (2500 kg) & Driver 2 (1500 kg smallest fit) both LOCKED on Slot 1.
    // Driver 2 wins -> Trip references Driver 2's commitment + scheduleSnapshot; Driver 1 gets NOT_ALLOCATED!
    const slot1Obj = {
      ...slot2Obj,
      _id: slot1Id,
      slotNumber: 1 as const,
      slotCode: 'GJ-VAD-AMD-01-20261129-SLOT1',
      label: 'Pickup Slot 1 (09:00)',
      returnTimeOptions: ['14:00', '16:30'],
      returnTimeLocked: false,
      lockedReturnTime: undefined,
    };

    const commitment1Id = new Types.ObjectId();
    const commitment2Id = new Types.ObjectId();
    const tier1SmallerVehicle = {
      ...tier1Vehicle,
      _id: vehicle2Id,
      driverId: driver2Id,
      registrationNumber: 'GJ-06-MC-1002',
      maxWeightKg: 1500,
    };

    vi.spyOn(Trip, 'findOne')
      .mockReturnValueOnce({ session: vi.fn().mockResolvedValue(null) } as never) // existing pool trip check
      .mockReturnValueOnce({ session: vi.fn().mockResolvedValue(null) } as never) // existing commitment trip check
      .mockReturnValueOnce({ select: vi.fn().mockReturnValue({ session: vi.fn().mockResolvedValue(null) }) } as never); // hasOverlappingDriverTrip

    vi.spyOn(Pool, 'findById').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue({
        _id: poolId,
        corridorId,
        slotId: slot1Id,
        status: 'LOCKED',
        shipmentIds: [shipments[0]._id],
      }),
    } as never);
    vi.spyOn(Corridor, 'findById').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue(corridorObj),
    } as never);
    vi.spyOn(Slot, 'findById').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue(slot1Obj),
    } as never);
    vi.spyOn(Shipment, 'find').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue(shipments),
    } as never);
    vi.spyOn(Vehicle, 'find').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue([tier1Vehicle, tier1SmallerVehicle]),
    } as never);
    vi.spyOn(Trip, 'find').mockReturnValueOnce({
      select: vi.fn().mockReturnValue({ session: vi.fn().mockResolvedValue([]) }),
    } as never);
    vi.spyOn(DriverProfile, 'find').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue([
        { userId: driver1Id, fleetTier: 'TIER_1', availabilityStatus: 'AVAILABLE', accountStatus: 'ACTIVE' },
        { userId: driver2Id, fleetTier: 'TIER_1', availabilityStatus: 'AVAILABLE', accountStatus: 'ACTIVE' },
      ]),
    } as never);
    vi.spyOn(DriverContract, 'find').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue([
        { driverUserId: driver1Id, status: 'ACTIVE', startDate: new Date('2026-01-01'), endDate: new Date('2027-01-01'), eligibleCorridorIds: [corridorId], minimumGuaranteeTerms: { minGuaranteePaise: 320000, perKmRatePaise: 2400 } },
        { driverUserId: driver2Id, status: 'ACTIVE', startDate: new Date('2026-01-01'), endDate: new Date('2027-01-01'), eligibleCorridorIds: [corridorId], minimumGuaranteeTerms: { minGuaranteePaise: 300000, perKmRatePaise: 2200 } },
      ]),
    } as never);
    vi.spyOn(DriverSlotCommitment, 'find').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue([
        { _id: commitment1Id, corridorId, slotId: slot1Id, driverUserId: driver1Id, vehicleId: vehicle1Id, slotNumber: 1, departureDate: serviceDate, selectedPickupTime: '09:00', selectedReturnTime: '14:00', status: 'LOCKED' },
        { _id: commitment2Id, corridorId, slotId: slot1Id, driverUserId: driver2Id, vehicleId: vehicle2Id, slotNumber: 1, departureDate: serviceDate, selectedPickupTime: '09:00', selectedReturnTime: '16:30', status: 'LOCKED' },
      ]),
    } as never);
    vi.spyOn(DriverProfile, 'findOne').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue({ userId: driver2Id, fleetTier: 'TIER_1', availabilityStatus: 'AVAILABLE', accountStatus: 'ACTIVE' }),
    } as never);

    let createdTripDoc: Record<string, unknown> | null = null;
    vi.spyOn(Trip, 'create').mockImplementation((async (docs: Array<Record<string, unknown>>) => {
      createdTripDoc = { _id: new Types.ObjectId(), assignmentHistory: [{}], ...docs[0] };
      return [createdTripDoc];
    }) as never);
    vi.spyOn(Shipment, 'updateMany').mockResolvedValueOnce({} as never);
    const updateOneSpy = vi.spyOn(DriverSlotCommitment, 'updateOne').mockResolvedValueOnce({} as never);
    const updateManySpy = vi.spyOn(DriverSlotCommitment, 'updateMany').mockResolvedValueOnce({} as never);
    vi.spyOn(NotificationLog, 'findOneAndUpdate').mockResolvedValueOnce({} as never);
    vi.spyOn(Trip, 'findById').mockRejectedValue(new Error('skip post-assignment mock'));

    const assignRes = await allocateAndAssignTripForPool({
      poolId: String(poolId),
      allowRightSizing: false,
    });

    expect(assignRes.allocated).toBe(true);
    expect(assignRes.driverAssigned).toBe(true);
    expect(String(createdTripDoc!['sourceCommitmentId'])).toBe(String(commitment2Id));
    expect((createdTripDoc!['scheduleSnapshot'] as { selectedReturnTime: string }).selectedReturnTime).toBe('16:30');
    expect((createdTripDoc!['vehicleSnapshot'] as { registrationNumber: string }).registrationNumber).toBe('GJ-06-MC-1002');
    expect(updateOneSpy).toHaveBeenCalledWith(
      { _id: commitment2Id },
      expect.objectContaining({ $set: expect.objectContaining({ status: 'ALLOCATED' }) }),
      expect.anything()
    );
    expect(updateManySpy).toHaveBeenCalledWith(
      expect.objectContaining({ slotId: slot1Id, _id: { $ne: commitment2Id } }),
      { $set: { status: 'NOT_ALLOCATED' } },
      expect.anything()
    );
  });

  it('MC-052 & Journey C: detects cross-corridor, turnaround buffer, overnight midnight & flexible return conflicts', async () => {
    const d1 = new Date(2026, 10, 29, 0, 0, 0);
    const d2 = new Date(2026, 10, 30, 0, 0, 0);

    // 1. Overlapping Slot 1 (09:00-14:00) vs Slot 2 (12:30-16:30)
    expect(
      evaluateWindowConflictsFromRecords({
        candidateDepartureDate: d1,
        candidatePickupTime: '12:30',
        candidateReturnTime: '16:30',
        turnaroundBufferMin: 30,
        conservativeMinDurationMin: 120,
        otherCommitments: [
          {
            slotId: 's1',
            corridorCode: 'GJ-VAD-AMD-01',
            slotNumber: 1,
            departureDate: d1,
            selectedPickupTime: '09:00',
            selectedReturnTime: '14:00',
            turnaroundBufferMin: 30,
          },
        ],
        activeTrips: [],
      })
    ).toMatch(/Conflicts with your committed GJ-VAD-AMD-01 Slot 1/i);

    // 2. Buffer boundary check: previous ends at 14:00 (+30m -> 14:30), candidate starts at 14:40 (-30m -> 14:10) => OVERLAP!
    expect(
      evaluateWindowConflictsFromRecords({
        candidateDepartureDate: d1,
        candidatePickupTime: '14:40',
        candidateReturnTime: '18:00',
        turnaroundBufferMin: 30,
        conservativeMinDurationMin: 120,
        otherCommitments: [
          {
            slotId: 's1',
            corridorCode: 'GJ-OTHER-02',
            slotNumber: 1,
            departureDate: d1,
            selectedPickupTime: '09:00',
            selectedReturnTime: '14:00',
            turnaroundBufferMin: 30,
          },
        ],
        activeTrips: [],
      })
    ).toMatch(/turnaround buffer/i);

    // Non-overlapping when candidate starts at 15:15 (-30m -> 14:45 > 14:30)
    expect(
      evaluateWindowConflictsFromRecords({
        candidateDepartureDate: d1,
        candidatePickupTime: '15:15',
        candidateReturnTime: '18:00',
        turnaroundBufferMin: 30,
        conservativeMinDurationMin: 120,
        otherCommitments: [
          {
            slotId: 's1',
            corridorCode: 'GJ-OTHER-02',
            slotNumber: 1,
            departureDate: d1,
            selectedPickupTime: '09:00',
            selectedReturnTime: '14:00',
            turnaroundBufferMin: 30,
          },
        ],
        activeTrips: [],
      })
    ).toBeNull();

    // 3. Cross-midnight overnight overlap: 22:00 Nov 29 -> 03:00 Nov 30 conflicts with 02:30–08:00 on Nov 30
    expect(
      evaluateWindowConflictsFromRecords({
        candidateDepartureDate: d2,
        candidatePickupTime: '02:30',
        candidateReturnTime: '08:00',
        turnaroundBufferMin: 30,
        conservativeMinDurationMin: 120,
        otherCommitments: [
          {
            slotId: 's-night',
            corridorCode: 'GJ-NIGHT-01',
            slotNumber: 2,
            departureDate: d1,
            selectedPickupTime: '22:00',
            selectedReturnTime: '03:00',
            turnaroundBufferMin: 30,
          },
        ],
        activeTrips: [],
      })
    ).toMatch(/Conflicts with your committed GJ-NIGHT-01/i);

    // 4. listOpenPoolingSlotsForDriver returns optionConflicts for Slot 1 partial overlap
    const driverId = new Types.ObjectId();
    const corId = new Types.ObjectId();
    const s1Id = new Types.ObjectId();
    const s2Id = new Types.ObjectId();
    const futureCutoff = new Date(Date.now() + 3 * 3600_000);

    vi.spyOn(DriverProfile, 'findOne').mockResolvedValueOnce({
      _id: new Types.ObjectId(),
      userId: driverId,
      fleetTier: 'TIER_1',
      accountStatus: 'ACTIVE',
      vehicleId: new Types.ObjectId(),
    } as never);
    vi.spyOn(DriverSlotCommitment, 'find')
      .mockReturnValueOnce({
        populate: vi.fn().mockReturnValue({
          populate: vi.fn().mockReturnValue({
            sort: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
          }),
        }),
      } as never)
      .mockResolvedValueOnce([
        {
          slotId: s2Id,
          corridorId: corId,
          slotNumber: 2,
          departureDate: d1,
          selectedPickupTime: '15:00',
          selectedReturnTime: '19:00',
          status: 'COMMITTED',
        },
      ] as never)
      .mockResolvedValueOnce([] as never);
    vi.spyOn(Vehicle, 'findById').mockResolvedValueOnce({
      _id: new Types.ObjectId(),
      ownershipType: 'DRIVER_OWNED',
      operationalStatus: 'ACTIVE',
      isAvailable: true,
    } as never);
    vi.spyOn(DriverContract, 'find').mockResolvedValueOnce([
      {
        status: 'ACTIVE',
        eligibleCorridorIds: [corId],
        startDate: new Date('2026-01-01'),
        endDate: new Date('2027-01-01'),
      },
    ] as never);
    vi.spyOn(Corridor, 'find')
      .mockResolvedValueOnce([
        {
          _id: corId,
          code: 'GJ-PARTIAL-01',
          name: 'Partial Overlap Corridor',
          stops: [],
          turnaroundBufferMin: 30,
          estimatedOutboundDurationMin: 120,
          slotSchedules: [
            {
              slotNumber: 1,
              outboundPickupTime: '09:00',
              returnTimeOptions: ['13:00', '16:30'], // 16:30 conflicts with 15:00-19:00, 13:00 does NOT!
              defaultReturnTime: '13:00',
              returnTimeLocked: false,
            },
          ],
        },
      ] as never)
      .mockResolvedValueOnce([
        { _id: corId, code: 'GJ-PARTIAL-01', turnaroundBufferMin: 30 },
      ] as never);
    vi.spyOn(Slot, 'find').mockReturnValueOnce({
      sort: vi.fn().mockResolvedValue([
        {
          _id: s1Id,
          corridorId: corId,
          slotNumber: 1,
          slotCode: 'GJ-PARTIAL-01-SLOT1',
          label: 'Slot 1',
          departureDate: d1,
          cutoffAt: futureCutoff,
          plannedDepartureAt: d1,
          returnTimeOptions: ['13:00', '16:30'],
          returnTimeLocked: false,
          status: 'OPEN',
        },
      ]),
    } as never);
    vi.spyOn(Pool, 'find').mockResolvedValueOnce([] as never);
    vi.spyOn(Trip, 'find').mockReturnValueOnce({
      select: vi.fn().mockResolvedValue([]),
    } as never);

    const openRes = await listOpenPoolingSlotsForDriver({ driverUserId: String(driverId) });
    expect(openRes.slots[0].availabilityState).toBe('OPEN_FOR_SELECTION');
    expect(openRes.slots[0].optionConflicts?.['13:00']).toBeNull();
    expect(openRes.slots[0].optionConflicts?.['16:30']).toMatch(/Conflicts with/i);
  });

  it('MC-053, MC-054, MC-055, MC-056 & MC-057: enforces trip start checks, return plan, bed dimensions/overflow, QR stop check & route versioning', async () => {
    const tripId = new Types.ObjectId();
    const driverId = new Types.ObjectId();
    const vehicleId = new Types.ObjectId();
    const corId = new Types.ObjectId();
    const shId = new Types.ObjectId();

    // MC-053: Quarantined trip cannot be started
    vi.spyOn(Trip, 'findOne').mockResolvedValueOnce({
      _id: tripId,
      tripCode: 'MC-Q-1',
      driverId,
      status: 'ASSIGNED',
      quarantined: true,
      quarantineReason: 'Quarantined inconsistent slot commitment',
    } as never);

    await expect(
      transitionTripExecutionState({
        tripId: String(tripId),
        driverUserId: String(driverId),
        targetStatus: 'IN_PROGRESS',
      })
    ).rejects.toThrow(/quarantined/i);

    // MC-053: Trip cannot start too early (>12h before departure)
    vi.spyOn(Trip, 'findOne').mockResolvedValueOnce({
      _id: tripId,
      tripCode: 'MC-EARLY-1',
      driverId,
      status: 'ASSIGNED',
      plannedDepartureAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    } as never);

    await expect(
      transitionTripExecutionState({
        tripId: String(tripId),
        driverUserId: String(driverId),
        targetStatus: 'IN_PROGRESS',
      })
    ).rejects.toThrow(/cannot be started more than 12 hours/i);

    // MC-056: Wrong pickup stop QR rejected cleanly
    vi.spyOn(Trip, 'findOne').mockResolvedValueOnce({
      _id: tripId,
      tripCode: 'MC-QR-1',
      driverId,
      status: 'IN_PROGRESS',
      shipmentIds: [shId],
    } as never);
    vi.spyOn(Shipment, 'findOne').mockResolvedValueOnce({
      _id: shId,
      reference: 'MC-SHP-STOP',
      tripId,
      pickupStopCode: 'VAD',
      status: 'LOCKED',
    } as never);

    await expect(
      scanShipmentQrForPickup({
        tripId: String(tripId),
        driverUserId: String(driverId),
        qrToken: 'valid-token-123',
        expectedPickupStopCode: 'ANA',
      })
    ).rejects.toThrow(/Wrong pickup stop/i);

    // MC-055: LIFO order, missing dimensions, and capacity overage detection
    const missingPlan = buildLifoLoadingPlan({
      orderedStops: [{ sequence: 0, stopCode: 'VAD' }, { sequence: 1, stopCode: 'ANA' }],
      shipments: [
        {
          _id: shId,
          reference: 'MC-1',
          deliveryStopCode: 'ANA',
          cargo: { quantity: 1, chargeableWeightKg: 100, volumeCbm: 1, stackable: true, unitDimensionsCm: { length: 50, width: 40, height: 40 } } as never,
        },
      ],
      bedDimensionsCm: { length: 0, width: 155, height: 165 },
    });
    expect(missingPlan.planStatus).toBe('UNAVAILABLE_MISSING_DIMENSIONS');
    expect(missingPlan.missingDimensions?.length).toBeGreaterThan(0);

    const overWeightPlan = buildLifoLoadingPlan({
      orderedStops: [
        { sequence: 0, stopCode: 'VAD' },
        { sequence: 1, stopCode: 'ANA' },
        { sequence: 2, stopCode: 'AMD' },
      ],
      shipments: [
        {
          _id: new Types.ObjectId(),
          reference: 'MC-ANA',
          deliveryStopCode: 'ANA',
          cargo: { quantity: 2, chargeableWeightKg: 400, volumeCbm: 1, stackable: true, unitDimensionsCm: { length: 80, width: 60, height: 50 } } as never,
        },
        {
          _id: new Types.ObjectId(),
          reference: 'MC-AMD',
          deliveryStopCode: 'AMD',
          cargo: { quantity: 2, chargeableWeightKg: 900, volumeCbm: 2, stackable: true, unitDimensionsCm: { length: 90, width: 70, height: 60 } } as never,
        },
      ],
      bedDimensionsCm: { length: 245, width: 155, height: 165 },
      vehicleLimits: { maxWeightKg: 1200, maxVolumeCbm: 6.2 },
    });
    // Farthest drop (AMD) loaded #1 (near cab), nearest drop (ANA) loaded #2 (tailgate)
    expect(overWeightPlan.sequenceItems.map((i) => i.stopCode)).toEqual(['AMD', 'ANA']);
    expect(overWeightPlan.planStatus).toBe('OVER_CAPACITY');
    expect(overWeightPlan.capacityIssues?.[0]).toMatch(/exceeds registered vehicle max/i);

    // MC-054: Return plan empty return vs matched backhaul
    const saveBackhaul = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(Trip, 'findById').mockResolvedValueOnce({
      _id: tripId,
      corridorId: corId,
      vehicleId,
      driverId,
      stopsSummary: [{ stopCode: 'VAD' }, { stopCode: 'AMD' }],
      estimatedEndAt: new Date('2026-11-29T14:00:00Z'),
      scheduleSnapshot: { selectedReturnTime: '14:00' },
      save: saveBackhaul,
    } as never);
    vi.spyOn(Vehicle, 'findById').mockResolvedValueOnce({
      _id: vehicleId,
      perKmRatePaise: 2400,
    } as never);
    vi.spyOn(BackhaulRequest, 'find').mockReturnValueOnce({
      sort: vi.fn().mockResolvedValue([]),
    } as never);

    const emptyReturnRes = await evaluateBackhaulForTrip({
      tripId: String(tripId),
      applyMatch: true,
    });
    expect(emptyReturnRes.decision.emptyReturn).toBe(true);
    expect(emptyReturnRes.decision.scheduledReturnTime).toBe('14:00');
    expect(emptyReturnRes.decision.returnShipmentCount).toBe(0);
    expect(saveBackhaul).toHaveBeenCalled();

    // MC-057: Route replanning increments routeVersion and archives superseded history
    const saveRouteTrip = vi.fn().mockResolvedValue(undefined);
    const versionedTripDoc = {
      _id: tripId,
      corridorId: corId,
      vehicleId,
      shipmentIds: [],
      stopsSummary: [{ stopCode: 'VAD', name: 'Vadodara', sequenceOrder: 0 }],
      routePlan: {
        routeVersion: 1,
        optimizationStatus: 'OPTIMAL',
        provider: 'OR_TOOLS',
        matrixProvider: 'FIXTURE',
        totalDistanceMeters: 110000,
        estimatedDurationSeconds: 7000,
        orderedStops: [
          { sequence: 0, stopCode: 'VAD', name: 'Vadodara', arrivalMin: 0, cumulativeDistanceMeters: 0, shipmentIds: [] },
        ],
        routeHistory: [],
      },
      loadingPlan: { manualOverrides: [] },
      save: saveRouteTrip,
    };

    vi.spyOn(Trip, 'findById').mockResolvedValueOnce(versionedTripDoc as never);
    vi.spyOn(Corridor, 'findById').mockResolvedValueOnce({
      _id: corId,
      stops: [
        { stopCode: 'VAD', name: 'Vadodara', sequenceOrder: 0, location: { coordinates: [73.18, 22.30] } },
        { stopCode: 'AMD', name: 'Ahmedabad', sequenceOrder: 1, location: { coordinates: [72.57, 23.02] } },
      ],
    } as never);
    vi.spyOn(Vehicle, 'findById').mockResolvedValueOnce({
      _id: vehicleId,
      registrationNumber: 'GJ-06-MC-1001',
      maxWeightKg: 2500,
      maxVolumeCbm: 12.5,
      bedDimensionsCm: { length: 425, width: 195, height: 150 },
    } as never);
    vi.spyOn(Shipment, 'find').mockResolvedValueOnce([] as never);
    vi.spyOn(RouteMatrixCache, 'findOne').mockReturnValueOnce({
      lean: vi.fn().mockResolvedValue({
        provider: 'FIXTURE',
        distanceMatrixMeters: [[0, 112000], [112000, 0]],
        durationMatrixSeconds: [[0, 7200], [7200, 0]],
      }),
    } as never);
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 'OPTIMAL',
        total_distance_meters: 112000,
        estimated_duration_seconds: 7200,
        ordered_stops: [
          { sequence: 0, stop_code: 'VAD', name: 'Vadodara', arrival_min: 0, cumulative_distance_meters: 0, shipment_ids: [] },
          { sequence: 1, stop_code: 'AMD', name: 'Ahmedabad', arrival_min: 120, cumulative_distance_meters: 112000, shipment_ids: [] },
        ],
      }),
    } as never);

    const replanRes = await optimizeAndPlanTripRoute({
      tripId: String(tripId),
      replanReason: 'ROAD_BLOCKED: NH-48 diversion',
    });
    expect(replanRes.routePlan?.routeVersion).toBe(2);
    expect(replanRes.routePlan?.routeHistory).toHaveLength(1);
    expect(replanRes.routePlan?.routeHistory?.[0].reason).toMatch(/ROAD_BLOCKED/i);
    expect(saveRouteTrip).toHaveBeenCalled();
  });
});
