import { Types } from 'mongoose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Corridor,
  validateCorridorSlotSchedules,
  type CorridorSlotSchedule,
} from '../models/Corridor.js';
import { DriverContract } from '../models/DriverContract.js';
import { DriverProfile } from '../models/DriverProfile.js';
import { DriverSlotCommitment } from '../models/DriverSlotCommitment.js';
import { NotificationLog } from '../models/NotificationLog.js';
import { Pool } from '../models/Pool.js';
import { Slot } from '../models/Slot.js';
import { Trip } from '../models/Trip.js';
import { User } from '../models/User.js';
import { Vehicle } from '../models/Vehicle.js';
import {
  listOpenPoolingSlotsForDriver,
  notifyEligibleTier1DriversForSlot,
  submitDriverSlotCommitment,
  validateCommitmentsAtWindowClose,
  withdrawDriverSlotCommitment,
} from '../services/driverSlotService.js';
import { allocateVehicleForPool } from '../services/fleetAllocator.js';
import {
  createCorridorForOwner,
  listCorridorsForOwner,
  toggleCorridorActiveStatus,
  updateCorridorForOwner,
} from '../services/platformOwnerService.js';
import { createShipmentBooking } from '../services/shipmentService.js';

describe('MC-045 to MC-050: Corridor Lifecycle, Slot Templates, Filters & Driver Slot Participation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockSingletonOwner(ownerId: Types.ObjectId) {
    vi.spyOn(User, 'find').mockReturnValueOnce({
      sort: vi.fn().mockResolvedValue([{ _id: ownerId, role: 'PLATFORM_OWNER', isActive: true }]),
    } as never);
  }

  it('MC-047: validates custom corridor slot templates, 24h HH:mm formats, duplicate returns & locked Slot 2 rules without global hardcoding', () => {
    const customValid: CorridorSlotSchedule[] = [
      {
        slotNumber: 1,
        slotCodeSuffix: 'SLOT1',
        label: 'Morning Wave',
        outboundPickupTime: '07:15',
        returnTimeOptions: ['11:45', '15:30'],
        defaultReturnTime: '11:45',
        returnTimeLocked: false,
      },
      {
        slotNumber: 2,
        slotCodeSuffix: 'SLOT2',
        label: 'Midday Wave',
        outboundPickupTime: '11:30',
        returnTimeOptions: ['18:45'],
        defaultReturnTime: '18:45',
        returnTimeLocked: true,
        lockedReturnTime: '18:45',
      },
    ];
    expect(validateCorridorSlotSchedules(customValid)).toBeNull();

    // Duplicate return option on Slot 1 rejected
    const duplicateReturn = structuredClone(customValid);
    duplicateReturn[0].returnTimeOptions = ['11:45', '11:45'];
    expect(validateCorridorSlotSchedules(duplicateReturn)).toMatch(/Duplicate returnTimeOption/i);

    // Invalid HH:mm rejected
    const badTime = structuredClone(customValid);
    badTime[0].outboundPickupTime = '25:99';
    expect(validateCorridorSlotSchedules(badTime)).toMatch(/24-hour HH:mm/i);

    // Locked Slot 1 rejected
    const lockedS1 = structuredClone(customValid);
    lockedS1[0].returnTimeLocked = true;
    expect(validateCorridorSlotSchedules(lockedS1)).toMatch(/Slot 1 must remain flexible/i);

    // Unlocked or multi-option Slot 2 rejected
    const multiS2 = structuredClone(customValid);
    multiS2[1].returnTimeOptions = ['17:00', '18:45'];
    expect(validateCorridorSlotSchedules(multiS2)).toMatch(/strictly locked to lockedReturnTime/i);
  });

  it('MC-045 & MC-046: filters/sorts corridors, preserves history on deactivation, and edits only OPEN slots', async () => {
    const ownerId = new Types.ObjectId();

    const corridorA = {
      _id: new Types.ObjectId(),
      code: 'GJ-AMD-SUR-01',
      name: 'Ahmedabad to Surat Express',
      isActive: true,
      operatingDays: ['MON', 'WED', 'FRI'],
      stops: [
        { stopCode: 'AMD', name: 'Ahmedabad', district: 'Ahmedabad', sequenceOrder: 0 },
        { stopCode: 'BHA', name: 'Bharuch', district: 'Bharuch', sequenceOrder: 1 },
        { stopCode: 'SUR', name: 'Surat', district: 'Surat', sequenceOrder: 2 },
      ],
      slotSchedules: [
        {
          slotNumber: 1,
          slotCodeSuffix: 'SLOT1',
          label: 'Wave 1',
          outboundPickupTime: '08:00',
          returnTimeOptions: ['13:00', '17:00'],
          defaultReturnTime: '13:00',
          returnTimeLocked: false,
        },
        {
          slotNumber: 2,
          slotCodeSuffix: 'SLOT2',
          label: 'Wave 2',
          outboundPickupTime: '13:00',
          returnTimeOptions: ['18:30'],
          defaultReturnTime: '18:30',
          returnTimeLocked: true,
          lockedReturnTime: '18:30',
        },
      ],
      guaranteedCeilingPaisePerKg: 700,
      baseRatePaisePerKg: 500,
      updatedAt: new Date('2026-11-26T10:00:00Z'),
      save: vi.fn().mockResolvedValue(undefined),
    };

    const corridorB = {
      _id: new Types.ObjectId(),
      code: 'GJ-RJT-JAM-01',
      name: 'Rajkot to Jamnagar Feeder',
      isActive: false,
      operatingDays: ['TUE', 'THU', 'SAT'],
      stops: [
        { stopCode: 'RJT', name: 'Rajkot', district: 'Rajkot', sequenceOrder: 0 },
        { stopCode: 'JAM', name: 'Jamnagar', district: 'Jamnagar', sequenceOrder: 1 },
      ],
      slotSchedules: corridorA.slotSchedules,
      updatedAt: new Date('2026-11-27T12:00:00Z'),
    };

    mockSingletonOwner(ownerId);
    vi.spyOn(Corridor, 'find').mockResolvedValueOnce([corridorA, corridorB] as never);

    // Search + combined filter
    const filtered = await listCorridorsForOwner(String(ownerId), {
      status: 'ACTIVE',
      origin: 'Ahmedabad',
      destination: 'Surat',
      operatingDay: 'WED',
      q: 'Bharuch',
      sortBy: 'name',
    });
    expect(filtered.corridors).toHaveLength(1);
    expect(filtered.corridors[0].code).toBe('GJ-AMD-SUR-01');
    expect(filtered.facets.activeCount).toBe(1);
    expect(filtered.facets.inactiveCount).toBe(1);

    // Sort by updatedAt descending puts Rajkot (Nov 27) before Ahmedabad (Nov 26)
    mockSingletonOwner(ownerId);
    vi.spyOn(Corridor, 'find').mockResolvedValueOnce([corridorA, corridorB] as never);
    const sorted = await listCorridorsForOwner(String(ownerId), {
      status: 'ALL',
      sortBy: 'updatedAt',
      sortOrder: 'desc',
    });
    expect(sorted.corridors.map((c) => c.code)).toEqual(['GJ-RJT-JAM-01', 'GJ-AMD-SUR-01']);

    // Duplicate corridor code rejected
    mockSingletonOwner(ownerId);
    vi.spyOn(Corridor, 'findOne').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue(corridorA),
    } as never);
    await expect(
      createCorridorForOwner({
        platformOwnerId: String(ownerId),
        input: {
          code: 'gj-amd-sur-01',
          name: 'Duplicate',
          stops: [
            {
              stopCode: 'AMD',
              name: 'Ahmedabad',
              district: 'Ahmedabad',
              state: 'Gujarat',
              sequenceOrder: 0,
              location: { type: 'Point', coordinates: [72.57, 23.02] },
            },
            {
              stopCode: 'SUR',
              name: 'Surat',
              district: 'Surat',
              state: 'Gujarat',
              sequenceOrder: 1,
              location: { type: 'Point', coordinates: [72.83, 21.17] },
            },
          ],
          operatingDays: ['MON'],
          slotSchedules: corridorA.slotSchedules as CorridorSlotSchedule[],
          guaranteedCeilingPaisePerKg: 700,
          baseRatePaisePerKg: 500,
        },
      })
    ).rejects.toThrow(/already exists/i);

    // Update corridor touches ONLY OPEN slots (Slot.find queried with status: 'OPEN')
    const saveOpenSlot = vi.fn().mockResolvedValue(undefined);
    const openSlot = {
      _id: new Types.ObjectId(),
      slotNumber: 1,
      slotCode: 'GJ-AMD-SUR-01-SLOT1',
      departureDate: new Date('2026-12-01'),
      status: 'OPEN',
      save: saveOpenSlot,
    };
    mockSingletonOwner(ownerId);
    vi.spyOn(Corridor, 'findById').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue(corridorA),
    } as never);
    const slotFindSpy = vi.spyOn(Slot, 'find').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue([openSlot]),
    } as never);

    const upd = await updateCorridorForOwner({
      platformOwnerId: String(ownerId),
      corridorId: String(corridorA._id),
      input: {
        name: 'Ahmedabad to Surat Direct',
      },
    });
    expect(upd.syncedOpenSlotsCount).toBe(1);
    expect(slotFindSpy).toHaveBeenCalledWith({ corridorId: corridorA._id, status: 'OPEN' });
    expect(saveOpenSlot).toHaveBeenCalled();

    // Deactivating corridor preserves historical records and blocks new bookings
    mockSingletonOwner(ownerId);
    vi.spyOn(Corridor, 'findById').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue(corridorA),
    } as never);
    const deactivated = await toggleCorridorActiveStatus({
      platformOwnerId: String(ownerId),
      corridorId: String(corridorA._id),
      isActive: false,
    });
    expect(deactivated.corridor.isActive).toBe(false);

    vi.spyOn(Corridor, 'findById').mockResolvedValueOnce(corridorA as never);
    vi.spyOn(Slot, 'findById').mockResolvedValueOnce(openSlot as never);
    await expect(
      createShipmentBooking({
        business: { _id: new Types.ObjectId(), primaryPickupAddress: {} as never } as never,
        userId: String(new Types.ObjectId()),
        input: {
          corridorId: String(corridorA._id),
          slotId: String(openSlot._id),
          pickupStopCode: 'AMD',
          deliveryStopCode: 'SUR',
          deliveryAddress: {
            addressLine: 'Textile Market',
            villageOrTown: 'Surat',
            district: 'Surat',
            state: 'Gujarat',
            pincode: '395002',
            location: { type: 'Point', coordinates: [72.83, 21.17] },
          },
          recipientName: 'Suresh',
          recipientPhone: '+919900001122',
          cargo: {
            category: 'STANDARD_BOX',
            quantity: 2,
            length: 50,
            width: 40,
            height: 40,
            dimensionUnit: 'CM',
            unitActualWeight: 25,
            weightUnit: 'KG',
            stackable: true,
            handlingRestrictions: [],
            declaredContents: 'Cotton boxes',
          },
          paymentChoice: 'TOKEN_PLUS_PICKUP_BALANCE',
        },
      })
    ).rejects.toThrow(/inactive and cannot open new bookings/i);
  });

  it('MC-049: driver notifies on open window, chooses Slot 1 return, locks Slot 2 return, blocks overlapping commitments & deadline edits', async () => {
    const corridorId = new Types.ObjectId();
    const driverUserId = new Types.ObjectId();
    const driverProfileId = new Types.ObjectId();
    const vehicleId = new Types.ObjectId();
    const slot1Id = new Types.ObjectId();
    const slot2Id = new Types.ObjectId();
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const futureCutoff = new Date(Date.now() + 4 * 60 * 60 * 1000);

    const corridorDoc = {
      _id: corridorId,
      code: 'GJ-TEST-01',
      name: 'Test Corridor',
      isActive: true,
      stops: [],
      slotSchedules: [
        {
          slotNumber: 1,
          slotCodeSuffix: 'SLOT1',
          label: 'Slot 1 (08:30)',
          outboundPickupTime: '08:30',
          returnTimeOptions: ['13:30', '16:00'],
          defaultReturnTime: '13:30',
          returnTimeLocked: false,
        },
        {
          slotNumber: 2,
          slotCodeSuffix: 'SLOT2',
          label: 'Slot 2 (12:00 Locked 17:30)',
          outboundPickupTime: '12:00',
          returnTimeOptions: ['17:30'],
          defaultReturnTime: '17:30',
          returnTimeLocked: true,
          lockedReturnTime: '17:30',
        },
      ],
    };

    const slot1Doc = {
      _id: slot1Id,
      corridorId,
      slotNumber: 1 as const,
      slotCode: 'GJ-TEST-01-SLOT1',
      label: 'Slot 1',
      departureDate: tomorrow,
      cutoffAt: futureCutoff,
      plannedDepartureAt: new Date(tomorrow),
      returnTimeOptions: ['13:30', '16:00'],
      returnTimeLocked: false,
      status: 'OPEN',
    };

    const slot2Doc = {
      _id: slot2Id,
      corridorId,
      slotNumber: 2 as const,
      slotCode: 'GJ-TEST-01-SLOT2',
      label: 'Slot 2',
      departureDate: tomorrow,
      cutoffAt: futureCutoff,
      plannedDepartureAt: new Date(tomorrow),
      returnTimeOptions: ['17:30'],
      returnTimeLocked: true,
      lockedReturnTime: '17:30',
      status: 'OPEN',
    };

    const driverProfileDoc = {
      _id: driverProfileId,
      userId: driverUserId,
      fleetTier: 'TIER_1',
      accountStatus: 'ACTIVE',
      availabilityStatus: 'AVAILABLE',
      vehicleId,
    };
    const vehicleDoc = {
      _id: vehicleId,
      ownershipType: 'DRIVER_OWNED',
      operationalStatus: 'ACTIVE',
      isAvailable: true,
      registrationNumber: 'GJ-06-TR-7777',
      vehicleClass: '14ft LCV',
      maxWeightKg: 2500,
      maxVolumeCbm: 12,
    };
    const contractDoc = {
      driverUserId,
      driverProfileId,
      status: 'ACTIVE',
      eligibleCorridorIds: [corridorId],
      startDate: new Date(Date.now() - 86400_000),
      endDate: new Date(Date.now() + 86400_000 * 30),
    };

    // 1. Notification when window opens
    vi.spyOn(DriverContract, 'find').mockResolvedValueOnce([contractDoc] as never);
    vi.spyOn(DriverProfile, 'findOne').mockResolvedValueOnce(driverProfileDoc as never);
    vi.spyOn(Vehicle, 'findById').mockResolvedValueOnce(vehicleDoc as never);
    vi.spyOn(NotificationLog, 'findOne').mockResolvedValueOnce(null as never);
    const notifSpy = vi.spyOn(NotificationLog, 'create').mockResolvedValueOnce({} as never);
    const sentCount = await notifyEligibleTier1DriversForSlot({
      corridor: corridorDoc as never,
      slot: slot1Doc as never,
    });
    expect(sentCount).toBe(1);
    expect(notifSpy).toHaveBeenCalled();

    // 2. Listing open slots shows eligible templates & non-fixed eligibility
    vi.spyOn(DriverProfile, 'findOne').mockResolvedValueOnce(driverProfileDoc as never);
    vi.spyOn(DriverSlotCommitment, 'find')
      .mockReturnValueOnce({
        populate: vi.fn().mockReturnValue({
          populate: vi.fn().mockReturnValue({
            sort: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      } as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never);
    vi.spyOn(Vehicle, 'findById').mockResolvedValueOnce(vehicleDoc as never);
    vi.spyOn(DriverContract, 'find').mockResolvedValueOnce([contractDoc] as never);
    vi.spyOn(Corridor, 'find').mockResolvedValueOnce([corridorDoc] as never);
    vi.spyOn(Slot, 'find').mockReturnValueOnce({
      sort: vi.fn().mockResolvedValue([slot1Doc, slot2Doc]),
    } as never);
    vi.spyOn(Pool, 'find').mockResolvedValueOnce([] as never);
    vi.spyOn(Trip, 'find').mockReturnValueOnce({
      select: vi.fn().mockResolvedValue([]),
    } as never);

    const openList = await listOpenPoolingSlotsForDriver({
      driverUserId: String(driverUserId),
    });
    expect(openList.eligible).toBe(true);
    expect(openList.slots).toHaveLength(2);
    expect(openList.slots[1].template.returnTimeLocked).toBe(true);

    // 3. Reject overriding locked Slot 2 return option
    vi.spyOn(Slot, 'findById').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue(slot2Doc),
    } as never);
    vi.spyOn(Corridor, 'findById').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue(corridorDoc),
    } as never);
    vi.spyOn(DriverProfile, 'findOne').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue(driverProfileDoc),
    } as never);
    vi.spyOn(Vehicle, 'findById').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue(vehicleDoc),
    } as never);
    vi.spyOn(DriverContract, 'findOne').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue(contractDoc),
    } as never);

    await expect(
      submitDriverSlotCommitment({
        driverUserId: String(driverUserId),
        slotId: String(slot2Id),
        selectedReturnTime: '14:00',
      })
    ).rejects.toThrow(/locked to 17:30/i);

    // 4. Reject invalid return option on Slot 1
    vi.spyOn(Slot, 'findById').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue(slot1Doc),
    } as never);
    vi.spyOn(Corridor, 'findById').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue(corridorDoc),
    } as never);
    vi.spyOn(DriverProfile, 'findOne').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue(driverProfileDoc),
    } as never);
    vi.spyOn(Vehicle, 'findById').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue(vehicleDoc),
    } as never);
    vi.spyOn(DriverContract, 'findOne').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue(contractDoc),
    } as never);

    await expect(
      submitDriverSlotCommitment({
        driverUserId: String(driverUserId),
        slotId: String(slot1Id),
        selectedReturnTime: '21:00',
      })
    ).rejects.toThrow(/not permitted/i);

    // 5. Reject conflicting same-day commitment (e.g. already committed to Slot 1 08:30-16:00 overlaps Slot 2 12:00-17:30)
    vi.spyOn(Slot, 'findById').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue(slot2Doc),
    } as never);
    vi.spyOn(Corridor, 'findById').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue(corridorDoc),
    } as never);
    vi.spyOn(DriverProfile, 'findOne').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue(driverProfileDoc),
    } as never);
    vi.spyOn(Vehicle, 'findById').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue(vehicleDoc),
    } as never);
    vi.spyOn(DriverContract, 'findOne').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue(contractDoc),
    } as never);
    vi.spyOn(DriverSlotCommitment, 'find').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue([
        {
          slotId: slot1Id,
          corridorId,
          slotNumber: 1,
          departureDate: tomorrow,
          selectedPickupTime: '08:30',
          selectedReturnTime: '16:00',
          status: 'COMMITTED',
        },
      ]),
    } as never);
    vi.spyOn(Corridor, 'find').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue([corridorDoc]),
    } as never);
    vi.spyOn(Trip, 'find').mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        session: vi.fn().mockResolvedValue([]),
      }),
    } as never);

    await expect(
      submitDriverSlotCommitment({
        driverUserId: String(driverUserId),
        slotId: String(slot2Id),
      })
    ).rejects.toThrow(/Conflicts with your committed/i);

    // 6. Reject withdrawal after cutoff deadline passes
    const expiredSlot = { ...slot1Doc, cutoffAt: new Date(Date.now() - 1000) };
    vi.spyOn(Slot, 'findById').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue(expiredSlot),
    } as never);
    await expect(
      withdrawDriverSlotCommitment({
        driverUserId: String(driverUserId),
        slotId: String(slot1Id),
      })
    ).rejects.toThrow(/has closed or locked/i);
  });

  it('MC-050: invalidates stale commitments on window close and prevents allocating uncommitted Tier 1 drivers', async () => {
    const corridorId = new Types.ObjectId();
    const slotId = new Types.ObjectId();
    const driver1Id = new Types.ObjectId();
    const profile1Id = new Types.ObjectId();
    const vehicle1Id = new Types.ObjectId();

    const saveInvalidated = vi.fn().mockResolvedValue(undefined);
    const commitmentDoc: {
      _id: Types.ObjectId;
      corridorId: Types.ObjectId;
      slotId: Types.ObjectId;
      driverUserId: Types.ObjectId;
      driverProfileId: Types.ObjectId;
      vehicleId: Types.ObjectId;
      slotNumber: number;
      departureDate: Date;
      selectedPickupTime: string;
      selectedReturnTime: string;
      status: string;
      invalidationReason?: string;
      save: typeof saveInvalidated;
    } = {
      _id: new Types.ObjectId(),
      corridorId,
      slotId,
      driverUserId: driver1Id,
      driverProfileId: profile1Id,
      vehicleId: vehicle1Id,
      slotNumber: 1,
      departureDate: new Date('2026-12-01'),
      selectedPickupTime: '09:00',
      selectedReturnTime: '14:00',
      status: 'COMMITTED',
      save: saveInvalidated,
    };

    vi.spyOn(DriverSlotCommitment, 'find').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue([commitmentDoc]),
    } as never);
    // Suppose driver became SUSPENDED before cutoff closed
    vi.spyOn(DriverProfile, 'findOne').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue({
        _id: profile1Id,
        userId: driver1Id,
        fleetTier: 'TIER_1',
        accountStatus: 'SUSPENDED',
        availabilityStatus: 'AVAILABLE',
      }),
    } as never);

    const validation = await validateCommitmentsAtWindowClose({
      slot: { _id: slotId, departureDate: new Date('2026-12-01') } as never,
      corridor: { _id: corridorId, isActive: true } as never,
      session: null,
    });

    expect(validation.validCommitments).toHaveLength(0);
    expect(validation.invalidatedCount).toBe(1);
    expect(commitmentDoc.status).toBe('INVALIDATED');
    expect(commitmentDoc.invalidationReason).toBe('DRIVER_UNAVAILABLE_OR_INACTIVE');
    expect(saveInvalidated).toHaveBeenCalled();

    // Now test allocateVehicleForPool when NO Tier 1 commitment exists and no Tier 2 fallback fits
    vi.spyOn(Vehicle, 'find').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue([
        {
          _id: vehicle1Id,
          registrationNumber: 'GJ-06-MC-1001',
          driverId: driver1Id,
          tier: 'TIER_1',
          ownershipType: 'DRIVER_OWNED',
          operationalStatus: 'ACTIVE',
          isAvailable: true,
          maxWeightKg: 2500,
          maxVolumeCbm: 12,
          bedDimensionsCm: { length: 425, width: 195, height: 150 },
          payoutModel: { modelType: 'MIN_GUARANTEE_PLUS_KM', minGuaranteePaise: 320000, perKmRatePaise: 2400 },
          contractedCorridorIds: [corridorId],
          unavailableDates: [],
          blockedSlotIds: [],
          operatingRestrictions: [],
        },
      ]),
    } as never);
    vi.spyOn(Trip, 'find').mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        session: vi.fn().mockResolvedValue([]),
      }),
    } as never);
    vi.spyOn(DriverProfile, 'find').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue([
        {
          userId: driver1Id,
          fleetTier: 'TIER_1',
          availabilityStatus: 'AVAILABLE',
          accountStatus: 'ACTIVE',
        },
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
    // Zero valid commitments for this slot -> uncommitted Tier 1 driver must NOT be allocated!
    vi.spyOn(DriverSlotCommitment, 'find').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue([]),
    } as never);

    const outcome = await allocateVehicleForPool({
      pool: {} as never,
      corridor: {
        _id: corridorId,
        slotSchedules: [{ slotNumber: 1, outboundPickupTime: '09:00', returnTimeOptions: ['14:00'], defaultReturnTime: '14:00', returnTimeLocked: false }],
      } as never,
      slot: {
        _id: slotId,
        slotNumber: 1,
        slotCode: 'GJ-VAD-AMD-01-SLOT1',
        departureDate: new Date('2026-12-01'),
        plannedDepartureAt: new Date('2026-12-01T09:00:00Z'),
        estimatedArrivalEndAt: new Date('2026-12-01T14:00:00Z'),
      } as never,
      shipments: [
        {
          cargo: {
            chargeableWeightKg: 600,
            volumeCbm: 3,
            unitDimensionsCm: { length: 100, width: 60, height: 50 },
            handlingRestrictions: [],
          },
        } as never,
      ],
    });

    expect(outcome.allocated).toBe(false);
    expect(outcome.reason).toMatch(/No feasible .*driver-owned vehicle/i);
  });
});
