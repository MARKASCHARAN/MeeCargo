import { Types } from 'mongoose';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import {
  Corridor,
  DEFAULT_CORRIDOR_SLOT_SCHEDULES,
  validateCorridorSlotSchedules,
} from '../models/Corridor.js';
import { DriverContract } from '../models/DriverContract.js';
import { DriverProfile } from '../models/DriverProfile.js';
import { Slot } from '../models/Slot.js';
import { User } from '../models/User.js';
import { Vehicle } from '../models/Vehicle.js';
import { signAccessToken } from '../services/authService.js';
import {
  assertSinglePlatformOwnerActor,
  createOrUpdateDriverContract,
  getTier1DriverByIdForOwner,
  listAllTier1DriversForOwner,
  migrateToSinglePlatformOwner,
  provisionSinglePlatformOwner,
  registerTier1ContractDriver,
  resetTier1DriverPassword,
  updateCentralCorridorSchedule,
  updateTier1DriverStatus,
  upsertDriverOwnedVehicle,
} from '../services/platformOwnerService.js';

describe('Single Platform Owner, Driver-Owned Vehicles, Centralized Corridor Schedules & Contracts', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('forbids public registration of PLATFORM_OWNER and blocks non-owner roles from /api/v1/platform-owner', async () => {
    const app = createApp();

    const regAttempt = await request(app).post('/api/v1/auth/register').send({
      name: 'Rogue Owner',
      email: 'rogue@meecargo.demo',
      password: 'Password123',
      role: 'PLATFORM_OWNER',
    });
    expect(regAttempt.status).toBe(403);
    expect(regAttempt.body.code).toBe('PLATFORM_OWNER_REGISTRATION_FORBIDDEN');

    const dispAttempt = await request(app).post('/api/v1/auth/register').send({
      name: 'Dispatcher Attempt',
      email: 'disp@meecargo.demo',
      password: 'Password123',
      role: 'DISPATCHER',
    });
    expect(dispAttempt.status).toBe(400);

    const shipperId = new Types.ObjectId();
    const shipperToken = signAccessToken({ _id: shipperId, role: 'SHIPPER' });
    vi.spyOn(User, 'findById').mockReturnValueOnce({
      select: vi.fn().mockResolvedValue({ _id: shipperId, role: 'SHIPPER', isActive: true }),
    } as never);

    const blocked = await request(app)
      .get('/api/v1/platform-owner/drivers')
      .set('Authorization', `Bearer ${shipperToken}`);

    expect(blocked.status).toBe(403);

    // PLATFORM_OWNER token passes verifyAccessToken on /api/v1/auth/me
    const ownerId = new Types.ObjectId();
    const ownerToken = signAccessToken({ _id: ownerId, role: 'PLATFORM_OWNER' });
    vi.spyOn(User, 'findById')
      .mockReturnValueOnce({
        select: vi.fn().mockResolvedValue({
          _id: ownerId,
          role: 'PLATFORM_OWNER',
          isActive: true,
        }),
      } as never)
      .mockResolvedValueOnce({
        _id: ownerId,
        name: 'MeeCargo Platform Owner',
        email: 'owner@meecargo.demo',
        role: 'PLATFORM_OWNER',
        isActive: true,
      } as never);

    const meRes = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(meRes.status).toBe(200);
    expect(meRes.body.user.role).toBe('PLATFORM_OWNER');
  });

  it('enforces the single Platform Owner invariant in assertSinglePlatformOwnerActor & provisionSinglePlatformOwner', async () => {
    const owner1 = new Types.ObjectId();
    const owner2 = new Types.ObjectId();

    vi.spyOn(User, 'find').mockReturnValueOnce({
      sort: vi.fn().mockResolvedValue([
        { _id: owner1, role: 'PLATFORM_OWNER', isActive: true },
        { _id: owner2, role: 'PLATFORM_OWNER', isActive: true },
      ]),
    } as never);
    await expect(assertSinglePlatformOwnerActor(String(owner1))).rejects.toThrow(
      /Single Platform Owner invariant violated/
    );

    vi.spyOn(User, 'find').mockReturnValueOnce({
      sort: vi.fn().mockResolvedValue([{ _id: owner1, role: 'PLATFORM_OWNER', isActive: true }]),
    } as never);
    await expect(assertSinglePlatformOwnerActor(String(owner2))).rejects.toThrow(
      /Only the active single Platform Owner account/
    );

    const saveOwner = vi.fn().mockResolvedValue(undefined);
    const deleteOwner = vi.spyOn(User, 'deleteOne').mockResolvedValue({ deletedCount: 1 } as never);
    vi.spyOn(User, 'syncIndexes').mockResolvedValueOnce([]);
    vi.spyOn(User, 'find').mockReturnValueOnce({
      sort: vi.fn().mockResolvedValue([
        { _id: owner1, email: 'owner@meecargo.demo', role: 'PLATFORM_OWNER', save: saveOwner },
        { _id: owner2, email: 'old-owner2@meecargo.demo', role: 'PLATFORM_OWNER', save: vi.fn() },
      ]),
    } as never);

    const provisioned = await provisionSinglePlatformOwner({
      email: 'owner@meecargo.demo',
      password: 'Password123',
      name: 'Singleton Owner',
    });

    expect(provisioned.demotedDuplicateOwnersCount).toBe(1);
    expect(deleteOwner).toHaveBeenCalledWith({ _id: owner2 });
    expect(saveOwner).toHaveBeenCalled();
  });

  it('registers Tier 1 driver with DRIVER_OWNED vehicle and updates driver-owned vehicle specs cleanly', async () => {
    const ownerId = new Types.ObjectId();
    const driverProfileId = new Types.ObjectId();
    const driverUserId = new Types.ObjectId();
    const vehicleId = new Types.ObjectId();
    const corridorId = new Types.ObjectId();

    vi.spyOn(User, 'find').mockReturnValueOnce({
      sort: vi.fn().mockResolvedValue([{ _id: ownerId, role: 'PLATFORM_OWNER', isActive: true }]),
    } as never);
    vi.spyOn(User, 'findOne').mockResolvedValueOnce(null);
    vi.spyOn(Vehicle, 'findOne').mockResolvedValueOnce(null);

    vi.spyOn(User, 'create').mockResolvedValueOnce([
      {
        _id: driverUserId,
        name: 'Vikram T1',
        email: 'vikram.t1@meecargo.demo',
        phone: '+919800000299',
        role: 'DRIVER',
        isActive: true,
      },
    ] as never);

    const createVehicleSpy = vi.spyOn(Vehicle, 'create').mockResolvedValueOnce([
      {
        _id: vehicleId,
        registrationNumber: 'GJ-06-TV-4001',
        tier: 'TIER_1',
        ownershipType: 'DRIVER_OWNED',
        bodyType: 'CLOSED_BODY',
        operationalStatus: 'ACTIVE',
      },
    ] as never);

    vi.spyOn(DriverProfile, 'create').mockResolvedValueOnce([
      {
        _id: driverProfileId,
        userId: driverUserId,
        name: 'Vikram T1',
        fleetTier: 'TIER_1',
        platformOwnerId: ownerId,
        vehicleId,
        accountStatus: 'ACTIVE',
      },
    ] as never);
    vi.spyOn(DriverContract, 'create').mockResolvedValueOnce([
      {
        _id: new Types.ObjectId(),
        contractCode: 'MC-CNT-SING01',
        platformOwnerId: ownerId,
        driverProfileId,
        driverUserId,
        assignedVehicleId: vehicleId,
        status: 'ACTIVE',
      },
    ] as never);

    const reg = await registerTier1ContractDriver({
      platformOwnerId: String(ownerId),
      name: 'Vikram T1',
      email: 'vikram.t1@meecargo.demo',
      phone: '+919800000299',
      password: 'Password123',
      vehicle: {
        registrationNumber: 'GJ-06-TV-4001',
        vehicleCategory: '14ft Closed Body LCV',
        bodyType: 'CLOSED_BODY',
        maxWeightKg: 2500,
        bedLengthCm: 425,
        bedWidthCm: 195,
        bedHeightCm: 150,
        rcNumber: 'GJ06TV4001',
        insurancePolicyNumber: 'INS-TV-4001',
        verificationStatus: 'VERIFIED',
      },
      contract: {
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
        minGuaranteePaise: 320000,
        perKmRatePaise: 2400,
        eligibleCorridorIds: [String(corridorId)],
      },
    });

    expect(reg.driverOwnedVehicle.ownershipType).toBe('DRIVER_OWNED');
    expect(createVehicleSpy).toHaveBeenCalled();

    // Update driver-owned vehicle operational status & dimensions
    vi.spyOn(User, 'find').mockReturnValueOnce({
      sort: vi.fn().mockResolvedValue([{ _id: ownerId, role: 'PLATFORM_OWNER', isActive: true }]),
    } as never);
    vi.spyOn(DriverProfile, 'findOne').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue({
        _id: driverProfileId,
        userId: driverUserId,
        name: 'Vikram T1',
        fleetTier: 'TIER_1',
        vehicleId,
        save: vi.fn().mockResolvedValue(undefined),
      }),
    } as never);
    vi.spyOn(Vehicle, 'findOne').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue(null),
    } as never);
    vi.spyOn(DriverContract, 'findOne').mockReturnValueOnce({
      sort: vi.fn().mockReturnValue({
        session: vi.fn().mockResolvedValue(null),
      }),
    } as never);

    const saveVeh = vi.fn().mockResolvedValue(undefined);
    const vehDoc = {
      _id: vehicleId,
      registrationNumber: 'GJ-06-TV-4001',
      tier: 'TIER_1',
      ownershipType: 'DRIVER_OWNED',
      operationalStatus: 'ACTIVE',
      isAvailable: true,
      documents: { verificationStatus: 'PENDING' },
      save: saveVeh,
    };
    vi.spyOn(Vehicle, 'findById').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue(vehDoc),
    } as never);

    const updatedVeh = await upsertDriverOwnedVehicle({
      platformOwnerId: String(ownerId),
      driverProfileId: String(driverProfileId),
      vehicle: {
        registrationNumber: 'GJ-06-TV-4001',
        vehicleCategory: '14ft Container',
        bodyType: 'CONTAINER',
        maxWeightKg: 2600,
        bedLengthCm: 430,
        bedWidthCm: 200,
        bedHeightCm: 160,
        operationalStatus: 'MAINTENANCE',
        verificationStatus: 'VERIFIED',
      },
    });
    expect(updatedVeh.driverOwnedVehicle.operationalStatus).toBe('MAINTENANCE');
    expect(updatedVeh.driverOwnedVehicle.isAvailable).toBe(false);
    expect(saveVeh).toHaveBeenCalled();

    // Listing queries fleetTier: 'TIER_1' globally & inherits central corridor schedules
    vi.spyOn(User, 'find').mockReturnValueOnce({
      sort: vi.fn().mockResolvedValue([{ _id: ownerId, role: 'PLATFORM_OWNER', isActive: true }]),
    } as never);
    const findDriversSpy = vi.spyOn(DriverProfile, 'find').mockReturnValueOnce({
      populate: vi.fn().mockReturnValue({
        populate: vi.fn().mockReturnValue({
          sort: vi.fn().mockResolvedValue([{ _id: driverProfileId, fleetTier: 'TIER_1' }]),
        }),
      }),
    } as never);
    vi.spyOn(DriverContract, 'find').mockReturnValueOnce({
      populate: vi.fn().mockReturnValue({
        populate: vi.fn().mockReturnValue({
          sort: vi.fn().mockResolvedValue([]),
        }),
      }),
    } as never);

    const listed = await listAllTier1DriversForOwner({ platformOwnerId: String(ownerId) });
    expect(listed).toHaveLength(1);
    expect(findDriversSpy).toHaveBeenCalledWith({ fleetTier: 'TIER_1' });

    // Tier 2/3 drivers cannot be accessed via Tier 1 routes
    vi.spyOn(User, 'find').mockReturnValueOnce({
      sort: vi.fn().mockResolvedValue([{ _id: ownerId, role: 'PLATFORM_OWNER', isActive: true }]),
    } as never);
    vi.spyOn(DriverProfile, 'findOne').mockReturnValueOnce({
      populate: vi.fn().mockReturnValue({
        populate: vi.fn().mockResolvedValue(null),
      }),
    } as never);

    await expect(
      getTier1DriverByIdForOwner({
        platformOwnerId: String(ownerId),
        driverProfileId: String(new Types.ObjectId()),
      })
    ).rejects.toThrow(/Tier 1 contract driver not found/);
  });

  it('validates coupled 2-slot corridor schedules (Slot 2 return mandatory & locked) and propagates updates to OPEN slots', async () => {
    // Reject unlocked Slot 2 in schema validator helper
    const invalidErr = validateCorridorSlotSchedules([
      DEFAULT_CORRIDOR_SLOT_SCHEDULES[0],
      {
        ...DEFAULT_CORRIDOR_SLOT_SCHEDULES[1],
        returnTimeLocked: false,
      },
    ]);
    expect(invalidErr).toMatch(/mandatory and locked/i);

    const ownerId = new Types.ObjectId();
    const corridorId = new Types.ObjectId();
    const saveCorridor = vi.fn().mockResolvedValue(undefined);
    const saveSlot1 = vi.fn().mockResolvedValue(undefined);
    const saveSlot2 = vi.fn().mockResolvedValue(undefined);

    vi.spyOn(User, 'find').mockReturnValueOnce({
      sort: vi.fn().mockResolvedValue([{ _id: ownerId, role: 'PLATFORM_OWNER', isActive: true }]),
    } as never);

    const corridorDoc = {
      _id: corridorId,
      code: 'GJ-VAD-AMD-01',
      operatingDays: ['MON', 'TUE'],
      slotSchedules: DEFAULT_CORRIDOR_SLOT_SCHEDULES,
      save: saveCorridor,
    };
    vi.spyOn(Corridor, 'findById').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue(corridorDoc),
    } as never);

    const slot1Doc = {
      _id: new Types.ObjectId(),
      slotNumber: 1,
      slotCode: 'GJ-VAD-AMD-01-SLOT1',
      departureDate: new Date('2026-12-01'),
      save: saveSlot1,
    };
    const slot2Doc = {
      _id: new Types.ObjectId(),
      slotNumber: 2,
      slotCode: 'GJ-VAD-AMD-01-SLOT2',
      departureDate: new Date('2026-12-01'),
      save: saveSlot2,
    };
    vi.spyOn(Slot, 'find').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue([slot1Doc, slot2Doc]),
    } as never);

    const updated = await updateCentralCorridorSchedule({
      platformOwnerId: String(ownerId),
      corridorId: String(corridorId),
      operatingDays: ['MON', 'TUE', 'WED'],
      slotSchedules: [
        {
          slotNumber: 1,
          slotCodeSuffix: 'SLOT1',
          label: 'Pickup Slot 1 (08:30)',
          outboundPickupTime: '08:30',
          returnTimeOptions: ['14:00', '16:30'],
          defaultReturnTime: '14:00',
          returnTimeLocked: false,
        },
        {
          slotNumber: 2,
          slotCodeSuffix: 'SLOT2',
          label: 'Pickup Slot 2 (12:30)',
          outboundPickupTime: '12:30',
          returnTimeOptions: ['14:00', '16:30'], // service locks strictly to mandatory 16:30!
          defaultReturnTime: '16:30',
          returnTimeLocked: false,
          lockedReturnTime: '16:30',
        },
      ],
    });

    expect(updated.syncedOpenSlotsCount).toBe(2);
    expect(corridorDoc.slotSchedules[1].returnTimeLocked).toBe(true);
    expect(corridorDoc.slotSchedules[1].returnTimeOptions).toEqual(['16:30']);
    expect(saveCorridor).toHaveBeenCalled();
    expect(saveSlot1).toHaveBeenCalled();
    expect(saveSlot2).toHaveBeenCalled();
  });

  it('activates, suspends, amends contracts, and safely migrates legacy vehicles/corridors/owners', async () => {
    const ownerId = new Types.ObjectId();
    const oldOwnerId = new Types.ObjectId();
    const driverProfileId = new Types.ObjectId();
    const driverUserId = new Types.ObjectId();
    const contractId = new Types.ObjectId();
    const vehicleId = new Types.ObjectId();
    const corridorId = new Types.ObjectId();

    const saveProfile = vi.fn().mockResolvedValue(undefined);
    const saveContract = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(User, 'updateOne').mockResolvedValue({ modifiedCount: 1 } as never);

    const profileDoc = {
      _id: driverProfileId,
      userId: driverUserId,
      fleetTier: 'TIER_1',
      platformOwnerId: ownerId,
      availabilityStatus: 'AVAILABLE',
      accountStatus: 'ACTIVE',
      vehicleId,
      save: saveProfile,
    };

    const contractDoc = {
      _id: contractId,
      contractCode: 'MC-CNT-009',
      platformOwnerId: ownerId,
      driverProfileId,
      driverUserId,
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-12-31'),
      minimumGuaranteeTerms: { minGuaranteePaise: 320000, perKmRatePaise: 2400 },
      eligibleCorridorIds: [] as Types.ObjectId[],
      status: 'ACTIVE',
      history: [] as Array<Record<string, unknown>>,
      save: saveContract,
    };

    vi.spyOn(User, 'find').mockReturnValueOnce({
      sort: vi.fn().mockResolvedValue([{ _id: ownerId, role: 'PLATFORM_OWNER', isActive: true }]),
    } as never);
    vi.spyOn(DriverProfile, 'findOne').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue(profileDoc),
    } as never);
    vi.spyOn(DriverContract, 'findOne').mockReturnValueOnce({
      sort: vi.fn().mockReturnValue({
        session: vi.fn().mockResolvedValue(contractDoc),
      }),
    } as never);

    const suspended = await updateTier1DriverStatus({
      platformOwnerId: String(ownerId),
      driverProfileId: String(driverProfileId),
      accountStatus: 'SUSPENDED',
      reason: 'Safety audit',
    });
    expect(suspended.driverProfile.accountStatus).toBe('SUSPENDED');
    expect(contractDoc.history[0].action).toBe('DRIVER_STATUS_SUSPENDED');

    // Contract update syncs driver-owned vehicle guarantees & corridors
    vi.spyOn(User, 'find').mockReturnValueOnce({
      sort: vi.fn().mockResolvedValue([{ _id: ownerId, role: 'PLATFORM_OWNER', isActive: true }]),
    } as never);
    vi.spyOn(Corridor, 'countDocuments').mockResolvedValueOnce(1);
    vi.spyOn(DriverProfile, 'findOne').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue(profileDoc),
    } as never);
    vi.spyOn(Vehicle, 'findById').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue({
        _id: vehicleId,
        tier: 'TIER_1',
        ownershipType: 'DRIVER_OWNED',
        save: vi.fn().mockResolvedValue(undefined),
      }),
    } as never);
    vi.spyOn(DriverContract, 'findOne').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue(contractDoc),
    } as never);

    const updated = await createOrUpdateDriverContract({
      platformOwnerId: String(ownerId),
      driverProfileId: String(driverProfileId),
      contractId: String(contractId),
      startDate: new Date('2026-02-01'),
      endDate: new Date('2027-01-31'),
      minGuaranteePaise: 350000,
      perKmRatePaise: 2500,
      eligibleCorridorIds: [String(corridorId)],
      status: 'ACTIVE',
      changeNote: 'Renewed rate',
    });
    expect(updated.contract.minimumGuaranteeTerms.minGuaranteePaise).toBe(350000);

    // Migration handles corridors, vehicles, drivers & contracts safely
    const saveCorMig = vi.fn().mockResolvedValue(undefined);
    const saveVehMig = vi.fn().mockResolvedValue(undefined);
    const saveMigrated = vi.fn().mockResolvedValue(undefined);

    vi.spyOn(Corridor, 'find').mockResolvedValueOnce([
      { _id: corridorId, slotSchedules: [], save: saveCorMig },
    ] as never);
    vi.spyOn(Vehicle, 'find').mockResolvedValueOnce([
      {
        _id: vehicleId,
        tier: 'TIER_1',
        operatorName: 'MeeCargo Attached Partner (Vadodara)',
        isAvailable: true,
        save: saveVehMig,
      },
    ] as never);
    vi.spyOn(DriverProfile, 'find').mockResolvedValueOnce([
      {
        _id: driverProfileId,
        userId: driverUserId,
        fleetTier: 'TIER_1',
        platformOwnerId: oldOwnerId,
        accountStatus: 'ACTIVE',
        save: saveMigrated,
      },
    ] as never);
    vi.spyOn(DriverContract, 'findOne').mockResolvedValueOnce({ _id: contractId } as never);
    vi.spyOn(DriverContract, 'updateMany').mockResolvedValueOnce({ modifiedCount: 1 } as never);

    const mig = await migrateToSinglePlatformOwner({ canonicalOwnerId: ownerId });
    expect(mig.migratedCorridorsCount).toBe(1);
    expect(mig.migratedVehiclesCount).toBe(1);
    expect(mig.reassignedTier1DriversCount).toBe(1);
    expect(mig.reassignedContractsCount).toBe(1);
    expect(saveCorMig).toHaveBeenCalled();
    expect(saveVehMig).toHaveBeenCalled();
    expect(saveMigrated).toHaveBeenCalled();
  });

  it('allows the singleton Platform Owner to reset a Tier 1 driver password cleanly', async () => {
    const ownerId = new Types.ObjectId();
    const driverProfileId = new Types.ObjectId();
    const driverUserId = new Types.ObjectId();
    const saveContract = vi.fn().mockResolvedValue(undefined);
    const contractDoc = {
      status: 'ACTIVE',
      history: [] as Array<Record<string, unknown>>,
      save: saveContract,
    };

    vi.spyOn(User, 'find').mockReturnValueOnce({
      sort: vi.fn().mockResolvedValue([{ _id: ownerId, role: 'PLATFORM_OWNER', isActive: true }]),
    } as never);
    vi.spyOn(DriverProfile, 'findOne').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue({
        _id: driverProfileId,
        userId: driverUserId,
        fleetTier: 'TIER_1',
      }),
    } as never);
    const userUpdateSpy = vi.spyOn(User, 'updateOne').mockResolvedValueOnce({
      modifiedCount: 1,
    } as never);
    vi.spyOn(DriverContract, 'findOne').mockReturnValueOnce({
      sort: vi.fn().mockReturnValue({
        session: vi.fn().mockResolvedValue(contractDoc),
      }),
    } as never);

    const res = await resetTier1DriverPassword({
      platformOwnerId: String(ownerId),
      driverProfileId: String(driverProfileId),
      newPassword: 'NewPassword@2026',
    });

    expect(res.driverProfileId).toBe(String(driverProfileId));
    expect(userUpdateSpy).toHaveBeenCalled();
    expect(contractDoc.history[0].action).toBe('DRIVER_PASSWORD_RESET');
    expect(saveContract).toHaveBeenCalled();
  });
});
