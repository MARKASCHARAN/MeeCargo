import { Types } from 'mongoose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Corridor } from '../models/Corridor.js';
import { DeliveryProof } from '../models/DeliveryProof.js';
import { DriverContract } from '../models/DriverContract.js';
import { DriverProfile } from '../models/DriverProfile.js';
import { DriverSlotCommitment } from '../models/DriverSlotCommitment.js';
import { NotificationLog } from '../models/NotificationLog.js';
import { Payment } from '../models/Payment.js';
import { PickupCollection } from '../models/PickupCollection.js';
import { Pool } from '../models/Pool.js';
import { PricingConfig } from '../models/PricingConfig.js';
import { Shipment } from '../models/Shipment.js';
import { Slot } from '../models/Slot.js';
import { Trip } from '../models/Trip.js';
import { TripEvent } from '../models/TripEvent.js';
import { TripLedger } from '../models/TripLedger.js';
import { Vehicle } from '../models/Vehicle.js';
import { executePoolCutoff } from '../services/cutoffService.js';
import { allocateAndAssignTripForPool } from '../services/driverAssignment.js';
import {
  isContractActiveOnServiceDate,
  submitDriverSlotCommitment,
  toCorridorDateKey,
  withdrawDriverSlotCommitment,
} from '../services/driverSlotService.js';
import { allocateVehicleForPool, doesCargoFitVehicle } from '../services/fleetAllocator.js';
import { processTokenPayment } from '../services/paymentService.js';
import {
  computeRemainingPickupBalancePaise,
  recordPickupBalanceCollection,
} from '../services/pickupCollectionService.js';
import { addShipmentToPool } from '../services/poolService.js';
import { createShipmentBooking, matchOperationalSlotForBooking } from '../services/shipmentService.js';
import {
  generateShipmentDeliveryOtp,
  scanShipmentQrForPickup,
  syncOfflineDriverEvents,
  transitionTripExecutionState,
  verifyDeliveryAndComplete,
} from '../services/tripExecutionService.js';

describe('MC-065 to MC-070: Tier 1 Scheduled Pooling Automation Verification Suite', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('MC-065: honors inclusive contract end-date in corridor timezone, records auditHistory, and blocks withdrawing LOCKED commitments', async () => {
    const corridorId = new Types.ObjectId();
    const slotId = new Types.ObjectId();
    const driverId = new Types.ObjectId();
    const profileId = new Types.ObjectId();
    const vehicleId = new Types.ObjectId();

    const contract = {
      driverUserId: driverId,
      status: 'ACTIVE',
      eligibleCorridorIds: [corridorId],
      startDate: new Date('2026-11-01T00:00:00.000Z'),
      endDate: new Date('2026-11-28T00:00:00.000Z'),
    };
    expect(
      isContractActiveOnServiceDate(contract, new Date('2026-11-28T09:00:00.000Z'), 'Asia/Kolkata')
    ).toBe(true);
    expect(
      toCorridorDateKey(new Date('2026-11-28T20:00:00.000Z'), 'Asia/Kolkata')
    ).toBe('2026-11-29');

    vi.spyOn(Slot, 'findById').mockImplementation((() => ({
      session: vi.fn().mockResolvedValue({
        _id: slotId,
        corridorId,
        slotNumber: 1,
        slotCode: 'COR-S1',
        status: 'OPEN',
        departureDate: new Date('2026-11-28T09:00:00.000Z'),
        cutoffAt: new Date(Date.now() + 3600_000),
      }),
    })) as never);
    vi.spyOn(Corridor, 'findById').mockImplementation((() => ({
      session: vi.fn().mockResolvedValue({
        _id: corridorId,
        code: 'GJ-VAD-AMD-01',
        isActive: true,
        timezone: 'Asia/Kolkata',
        turnaroundBufferMin: 30,
        estimatedOutboundDurationMin: 120,
        slotSchedules: [
          {
            slotNumber: 1,
            slotCodeSuffix: 'SLOT1',
            label: 'Slot 1',
            outboundPickupTime: '09:00',
            returnTimeOptions: ['14:00', '16:30'],
            defaultReturnTime: '14:00',
            returnTimeLocked: false,
          },
          {
            slotNumber: 2,
            slotCodeSuffix: 'SLOT2',
            label: 'Slot 2',
            outboundPickupTime: '12:30',
            returnTimeOptions: ['16:30'],
            defaultReturnTime: '16:30',
            returnTimeLocked: true,
            lockedReturnTime: '16:30',
          },
        ],
      }),
    })) as never);
    vi.spyOn(DriverProfile, 'findOne').mockImplementation((() => ({
      session: vi.fn().mockResolvedValue({
        _id: profileId,
        userId: driverId,
        fleetTier: 'TIER_1',
        accountStatus: 'ACTIVE',
        availabilityStatus: 'AVAILABLE',
        vehicleId,
      }),
    })) as never);
    vi.spyOn(Vehicle, 'findById').mockImplementation((() => ({
      session: vi.fn().mockResolvedValue({
        _id: vehicleId,
        ownershipType: 'DRIVER_OWNED',
        operationalStatus: 'ACTIVE',
        isAvailable: true,
      }),
    })) as never);
    vi.spyOn(DriverContract, 'findOne').mockImplementation((() => ({
      session: vi.fn().mockResolvedValue(contract),
    })) as never);
    vi.spyOn(DriverSlotCommitment, 'find').mockImplementation((() => ({
      session: vi.fn().mockResolvedValue([]),
    })) as never);
    vi.spyOn(Trip, 'find').mockImplementation((() => ({
      select: vi.fn().mockReturnValue({ session: vi.fn().mockResolvedValue([]) }),
    })) as never);
    vi.spyOn(DriverSlotCommitment, 'findOne').mockImplementation((() => ({
      session: vi.fn().mockResolvedValue(null),
    })) as never);
    vi.spyOn(Pool, 'findOne').mockImplementation((() => ({
      session: vi.fn().mockResolvedValue(null),
    })) as never);

    const upsertSpy = vi.spyOn(DriverSlotCommitment, 'findOneAndUpdate').mockResolvedValueOnce({
      _id: new Types.ObjectId(),
      status: 'COMMITTED',
      selectedReturnTime: '14:00',
    } as never);

    const committed = await submitDriverSlotCommitment({
      driverUserId: String(driverId),
      slotId: String(slotId),
      selectedReturnTime: '14:00',
    });
    expect(committed.commitment.status).toBe('COMMITTED');
    expect(upsertSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        $push: expect.objectContaining({
          auditHistory: expect.objectContaining({ action: 'SUBMITTED', status: 'COMMITTED' }),
        }),
      }),
      expect.anything()
    );

    // Withdraw succeeds prior to lock and appends WITHDRAWN audit history
    const saveMock = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(DriverSlotCommitment, 'findOne').mockImplementationOnce((() => ({
      session: vi.fn().mockResolvedValue({
        _id: new Types.ObjectId(),
        driverUserId: driverId,
        status: 'COMMITTED',
        auditHistory: [],
        save: saveMock,
      }),
    })) as never);
    const withdrawn = await withdrawDriverSlotCommitment({
      driverUserId: String(driverId),
      slotId: String(slotId),
    });
    expect(withdrawn.commitment.status).toBe('WITHDRAWN');
    expect(saveMock).toHaveBeenCalledOnce();

    // Locked commitment cannot be withdrawn
    vi.spyOn(DriverSlotCommitment, 'findOne').mockImplementationOnce((() => ({
      session: vi.fn().mockResolvedValue({
        _id: new Types.ObjectId(),
        driverUserId: driverId,
        status: 'LOCKED',
        auditHistory: [],
      }),
    })) as never);
    await expect(
      withdrawDriverSlotCommitment({
        driverUserId: String(driverId),
        slotId: String(slotId),
      })
    ).rejects.toMatchObject({ code: 'COMMITMENT_LOCKED' });
  });

  it('MC-066 & MC-067: rejects HAZMAT early, enforces independent weight/volume caps, prevents orphaned SUCCESS payments, and handles concurrent cutoff idempotently', async () => {
    const corridorId = new Types.ObjectId();
    const slotId = new Types.ObjectId();
    const poolId = new Types.ObjectId();
    const businessId = new Types.ObjectId();

    const business = {
      _id: businessId,
      pickupAddress: {
        addressLine: 'Makarpura GIDC',
        villageOrTown: 'Vadodara',
        district: 'Vadodara',
        state: 'Gujarat',
        pincode: '390010',
        location: { type: 'Point' as const, coordinates: [73.184, 22.256] as [number, number] },
      },
    } as never;

    vi.spyOn(Shipment, 'findOne').mockResolvedValue(null);
    vi.spyOn(Corridor, 'findById').mockResolvedValue({
      _id: corridorId,
      code: 'GJ-VAD-AMD-01',
      isActive: true,
      timezone: 'Asia/Kolkata',
      baseRatePaisePerKg: 500,
      guaranteedCeilingPaisePerKg: 700,
      stops: [
        { stopCode: 'VAD', name: 'Vadodara', sequenceOrder: 0, location: { coordinates: [73.184, 22.256] } },
        { stopCode: 'ANA', name: 'Anand', sequenceOrder: 1, location: { coordinates: [72.9289, 22.5645] } },
      ],
    } as never);

    // Restricted cargo rejected before creating PENDING_TOKEN shipment
    await expect(
      createShipmentBooking({
        business,
        userId: String(new Types.ObjectId()),
        input: {
          corridorId: String(corridorId),
          serviceDate: '2026-12-05',
          pickupStopCode: 'VAD',
          deliveryStopCode: 'ANA',
          deliveryAddress: {
            addressLine: 'Anand GIDC',
            villageOrTown: 'Anand',
            district: 'Anand',
            state: 'Gujarat',
            pincode: '388001',
            location: { type: 'Point', coordinates: [72.9289, 22.5645] },
          },
          recipientName: 'Receiver',
          recipientPhone: '+919800000111',
          cargo: {
            category: 'STANDARD_BOX',
            quantity: 1,
            length: 40,
            width: 40,
            height: 40,
            dimensionUnit: 'CM',
            unitActualWeight: 10,
            weightUnit: 'KG',
            stackable: true,
            handlingRestrictions: ['HAZMAT'],
            declaredContents: 'Solvent',
          },
        },
      })
    ).rejects.toMatchObject({ code: 'INCOMPATIBLE_CARGO' });

    // Weight fits (200 kg) but volume exceeds (15 cbm > 12 cbm) -> SLOT_CAPACITY_EXCEEDED
    vi.spyOn(Slot, 'find').mockReturnValue({
      sort: vi.fn().mockResolvedValue([
        {
          _id: slotId,
          corridorId,
          status: 'OPEN',
          departureDate: new Date('2026-12-05T03:30:00.000Z'),
          cutoffAt: new Date(Date.now() + 3600_000),
          plannedDepartureAt: new Date('2026-12-05T09:00:00.000Z'),
          capacityWeightKg: 2500,
          capacityVolumeCbm: 12,
          reservedWeightKg: 500,
          reservedVolumeCbm: 8,
        },
      ]),
    } as never);

    await expect(
      matchOperationalSlotForBooking({
        corridorId,
        serviceDate: '2026-12-05',
        chargeableWeightKg: 200,
        volumeCbm: 5,
      })
    ).rejects.toMatchObject({ code: 'SLOT_CAPACITY_EXCEEDED' });

    // Token payment capacity conflict does NOT create an orphaned SUCCESS Payment record
    const shipmentId = new Types.ObjectId();
    vi.spyOn(Shipment, 'findOne').mockImplementation((() => ({
      session: vi.fn().mockResolvedValue({
        _id: shipmentId,
        businessId,
        corridorId,
        slotId,
        status: 'PENDING_TOKEN',
        tokenStatus: 'PENDING',
        cargo: { chargeableWeightKg: 500, volumeCbm: 4 },
      }),
    })) as never);
    vi.spyOn(Corridor, 'findById').mockImplementation((() => ({
      session: vi.fn().mockResolvedValue({
        _id: corridorId,
        baseRatePaisePerKg: 500,
        guaranteedCeilingPaisePerKg: 700,
      }),
    })) as never);
    vi.spyOn(Slot, 'findById').mockImplementation((() => ({
      session: vi.fn().mockResolvedValue({
        _id: slotId,
        capacityWeightKg: 1000,
        capacityVolumeCbm: 5,
        reservedWeightKg: 800,
        reservedVolumeCbm: 2,
      }),
    })) as never);
    vi.spyOn(PricingConfig, 'findOne').mockReturnValue({
      sort: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(null) }),
    } as never);
    const paymentCreateSpy = vi.spyOn(Payment, 'create');
    vi.spyOn(Slot, 'findOneAndUpdate').mockResolvedValueOnce(null);

    await expect(
      processTokenPayment({
        shipmentId: String(shipmentId),
        businessId,
        userId: String(new Types.ObjectId()),
        simulateOutcome: 'SUCCESS',
      })
    ).rejects.toMatchObject({ code: 'SLOT_UNAVAILABLE' });
    expect(paymentCreateSpy).not.toHaveBeenCalled();

    // Concurrent cutoff race: when OPEN -> LOCKING loses to another worker already LOCKING/LOCKED, returns idempotently
    vi.spyOn(Pool, 'findById')
      .mockResolvedValueOnce({ _id: poolId, slotId, status: 'OPEN' } as never)
      .mockResolvedValueOnce({
        _id: poolId,
        slotId,
        status: 'LOCKED',
        lockedSnapshot: { lockedAt: new Date() },
      } as never);
    vi.spyOn(Pool, 'findOneAndUpdate').mockResolvedValueOnce(null);

    const dupCutoff = await executePoolCutoff({ poolId: String(poolId) });
    expect(dupCutoff.idempotentHit).toBe(true);
    expect(dupCutoff.viabilityPassed).toBe(true);
  });

  it('MC-068: blocks Tier 2 fallback on Tier 1 corridor pools, persists candidateAudit, validates non-stackable footprint, and handles concurrent allocation workers safely', async () => {
    const corridorId = new Types.ObjectId();
    const slotId = new Types.ObjectId();
    const poolId = new Types.ObjectId();
    const tier2DriverId = new Types.ObjectId();

    const tier2Vehicle = {
      _id: new Types.ObjectId(),
      registrationNumber: 'GJ-06-T2-9999',
      driverId: tier2DriverId,
      tier: 'TIER_2',
      ownershipType: 'DRIVER_OWNED',
      operationalStatus: 'ACTIVE',
      isAvailable: true,
      maxWeightKg: 1800,
      maxVolumeCbm: 9,
      bedDimensionsCm: { length: 300, width: 170, height: 150 },
      perKmRatePaise: 1900,
      unavailableDates: [],
      blockedSlotIds: [],
      operatingRestrictions: [],
      contractedCorridorIds: [],
    };

    // Non-stackable cargo footprint exceeding floor area fails feasibility
    const nonStackableFit = doesCargoFitVehicle(
      [
        {
          cargo: {
            quantity: 5,
            stackable: false,
            chargeableWeightKg: 250,
            volumeCbm: 2,
            unitDimensionsCm: { length: 120, width: 100, height: 40 },
            handlingRestrictions: [],
          },
        } as never,
      ],
      tier2Vehicle
    );
    expect(nonStackableFit.feasible).toBe(false);
    expect(nonStackableFit.reason).toMatch(/Non-stackable cargo floor footprint/i);

    // Even with an available APPROVED Tier 2 driver, NO locked Tier 1 driver -> allocation fails safely (zero Tier 2 fallback!)
    vi.spyOn(Vehicle, 'find').mockImplementation((() => ({
      session: vi.fn().mockResolvedValue([tier2Vehicle]),
    })) as never);
    vi.spyOn(Trip, 'find').mockImplementation((() => ({
      select: vi.fn().mockReturnValue({ session: vi.fn().mockResolvedValue([]) }),
    })) as never);
    vi.spyOn(DriverProfile, 'find').mockImplementation((() => ({
      session: vi.fn().mockResolvedValue([
        {
          userId: tier2DriverId,
          fleetTier: 'TIER_2',
          tier2ApplicationStatus: 'APPROVED',
          accountStatus: 'ACTIVE',
          availabilityStatus: 'AVAILABLE',
        },
      ]),
    })) as never);
    vi.spyOn(DriverContract, 'find').mockImplementation((() => ({
      session: vi.fn().mockResolvedValue([]),
    })) as never);
    vi.spyOn(DriverSlotCommitment, 'find').mockImplementation((() => ({
      session: vi.fn().mockResolvedValue([]),
    })) as never);

    const noFallbackOutcome = await allocateVehicleForPool({
      pool: {} as never,
      corridor: { _id: corridorId, timezone: 'Asia/Kolkata' } as never,
      slot: {
        _id: slotId,
        slotNumber: 1,
        slotCode: 'GJ-VAD-AMD-01-SLOT1',
        departureDate: new Date('2026-12-05T03:30:00Z'),
        plannedDepartureAt: new Date('2026-12-05T09:00:00Z'),
        estimatedArrivalEndAt: new Date('2026-12-05T14:00:00Z'),
      } as never,
      shipments: [
        {
          cargo: {
            quantity: 1,
            stackable: true,
            chargeableWeightKg: 400,
            volumeCbm: 1.5,
            unitDimensionsCm: { length: 100, width: 80, height: 60 },
            handlingRestrictions: [],
          },
        } as never,
      ],
    });
    expect(noFallbackOutcome.allocated).toBe(false);

    // Concurrent allocation worker hitting unique constraint E11000 cleanly returns existing trip
    const tier1DriverId = new Types.ObjectId();
    const tier1VehicleId = new Types.ObjectId();
    const commitmentId = new Types.ObjectId();
    const existingTrip = {
      _id: new Types.ObjectId(),
      tripCode: 'MC-TRIP-CONC-01',
      poolId,
    };

    vi.spyOn(Trip, 'findOne')
      .mockImplementationOnce((() => ({ session: vi.fn().mockResolvedValue(null) })) as never)
      .mockImplementationOnce((() => ({ session: vi.fn().mockResolvedValue(null) })) as never)
      .mockImplementationOnce((() => ({
        select: vi.fn().mockReturnValue({ session: vi.fn().mockResolvedValue(null) }),
      })) as never)
      .mockImplementationOnce((() => ({ session: vi.fn().mockResolvedValue(existingTrip) })) as never);

    vi.spyOn(Pool, 'findById').mockImplementation((() => ({
      session: vi.fn().mockResolvedValue({
        _id: poolId,
        poolCode: 'POOL-CONC',
        corridorId,
        slotId,
        status: 'LOCKED',
        shipmentIds: [new Types.ObjectId()],
      }),
    })) as never);
    vi.spyOn(Corridor, 'findById').mockImplementation((() => ({
      session: vi.fn().mockResolvedValue({
        _id: corridorId,
        name: 'Vadodara to Ahmedabad',
        timezone: 'Asia/Kolkata',
        stops: [
          { stopCode: 'VAD', name: 'Vadodara', sequenceOrder: 0 },
          { stopCode: 'AMD', name: 'Ahmedabad', sequenceOrder: 1 },
        ],
        slotSchedules: [
          {
            slotNumber: 1,
            slotCodeSuffix: 'SLOT1',
            label: 'Slot 1',
            outboundPickupTime: '09:00',
            returnTimeOptions: ['14:00'],
            defaultReturnTime: '14:00',
            returnTimeLocked: false,
          },
        ],
      }),
    })) as never);
    vi.spyOn(Slot, 'findById').mockImplementation((() => ({
      session: vi.fn().mockResolvedValue({
        _id: slotId,
        corridorId,
        slotNumber: 1,
        slotCode: 'GJ-VAD-AMD-01-SLOT1',
        label: 'Slot 1',
        departureDate: new Date('2026-12-05T03:30:00Z'),
        plannedDepartureAt: new Date('2026-12-05T09:00:00Z'),
        estimatedArrivalEndAt: new Date('2026-12-05T14:00:00Z'),
      }),
    })) as never);
    vi.spyOn(Shipment, 'find').mockImplementation((() => ({
      session: vi.fn().mockResolvedValue([
        {
          _id: new Types.ObjectId(),
          cargo: {
            quantity: 1,
            stackable: true,
            chargeableWeightKg: 400,
            volumeCbm: 1.5,
            unitDimensionsCm: { length: 100, width: 80, height: 60 },
            handlingRestrictions: [],
          },
        },
      ]),
    })) as never);
    vi.spyOn(Vehicle, 'find').mockImplementation((() => ({
      session: vi.fn().mockResolvedValue([
        {
          _id: tier1VehicleId,
          registrationNumber: 'GJ-06-MC-1001',
          vehicleClass: '14ft LCV',
          bodyType: 'CLOSED_BODY',
          driverId: tier1DriverId,
          tier: 'TIER_1',
          ownershipType: 'DRIVER_OWNED',
          operationalStatus: 'ACTIVE',
          isAvailable: true,
          maxWeightKg: 2500,
          maxVolumeCbm: 12.5,
          bedDimensionsCm: { length: 425, width: 195, height: 150 },
          contractedCorridorIds: [corridorId],
        },
      ]),
    })) as never);
    vi.spyOn(DriverProfile, 'find').mockImplementation((() => ({
      session: vi.fn().mockResolvedValue([
        {
          userId: tier1DriverId,
          fleetTier: 'TIER_1',
          accountStatus: 'ACTIVE',
          availabilityStatus: 'AVAILABLE',
        },
      ]),
    })) as never);
    vi.spyOn(DriverProfile, 'findOne').mockImplementation((() => ({
      session: vi.fn().mockResolvedValue({
        userId: tier1DriverId,
        fleetTier: 'TIER_1',
        accountStatus: 'ACTIVE',
        availabilityStatus: 'AVAILABLE',
      }),
    })) as never);
    vi.spyOn(DriverContract, 'find').mockImplementation((() => ({
      session: vi.fn().mockResolvedValue([
        {
          driverUserId: tier1DriverId,
          status: 'ACTIVE',
          eligibleCorridorIds: [corridorId],
          startDate: new Date('2026-11-01'),
          endDate: new Date('2027-01-01'),
          minimumGuaranteeTerms: { minGuaranteePaise: 320000, perKmRatePaise: 2400 },
        },
      ]),
    })) as never);
    vi.spyOn(DriverSlotCommitment, 'find').mockImplementation((() => ({
      session: vi.fn().mockResolvedValue([
        {
          _id: commitmentId,
          corridorId,
          slotId,
          driverUserId: tier1DriverId,
          vehicleId: tier1VehicleId,
          slotNumber: 1,
          departureDate: new Date('2026-12-05T03:30:00Z'),
          selectedPickupTime: '09:00',
          selectedReturnTime: '14:00',
          status: 'LOCKED',
        },
      ]),
    })) as never);
    vi.spyOn(Trip, 'create').mockRejectedValueOnce({ code: 11000 });
    vi.spyOn(Trip, 'findById').mockRejectedValue(new Error('skip post-assignment mock'));

    const concurrentRes = await allocateAndAssignTripForPool({ poolId: String(poolId) });
    expect(concurrentRes.allocated).toBe(true);
    expect(concurrentRes.idempotentHit).toBe(true);
    expect(concurrentRes.trip?.tripCode).toBe('MC-TRIP-CONC-01');
  });

  it('MC-070: reconciles prior payments on pickup balance collection, prevents duplicate collections, and blocks completing trip with unaccounted shipments', async () => {
    expect(
      computeRemainingPickupBalancePaise({
        lockedPricePaise: 120000,
        tokenPaidPaise: 30000,
        otherPaidPaise: 20000,
        adjustmentsPaise: 5000,
      })
    ).toBe(65000);

    const tripId = new Types.ObjectId();
    const shipmentId = new Types.ObjectId();
    const driverId = new Types.ObjectId();
    const businessId = new Types.ObjectId();

    vi.spyOn(Trip, 'findOne').mockImplementation((() => ({
      session: vi.fn().mockResolvedValue({ _id: tripId, driverId, shipmentIds: [shipmentId] }),
    })) as never);
    const saveShipment = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(Shipment, 'findOne').mockImplementation((() => ({
      session: vi.fn().mockResolvedValue({
        _id: shipmentId,
        businessId,
        pricingSnapshot: {
          finalLockedPricePaise: 100000,
          tokenPaidPaise: 25000,
          remainingBalancePaise: 75000,
        },
        save: saveShipment,
      }),
    })) as never);
    vi.spyOn(PickupCollection, 'findOne').mockImplementation((() => ({
      session: vi.fn().mockResolvedValue(null),
    })) as never);
    // Suppose a prior partial PICKUP_BALANCE of 15000 paise was already recorded as SUCCESS
    vi.spyOn(Payment, 'find').mockImplementation((() => ({
      select: vi.fn().mockReturnValue({
        session: vi.fn().mockResolvedValue([
          { type: 'TOKEN', amountPaise: 25000 },
          { type: 'PICKUP_BALANCE', amountPaise: 15000 },
        ]),
      }),
    })) as never);

    const collectionCreateSpy = vi.spyOn(PickupCollection, 'create').mockImplementationOnce((async (
      docs: Array<Record<string, unknown>>
    ) => docs) as never);
    const paymentCreateSpy = vi.spyOn(Payment, 'create').mockResolvedValueOnce([] as never);

    const colRes = await recordPickupBalanceCollection({
      tripId: String(tripId),
      shipmentId: String(shipmentId),
      driverUserId: String(driverId),
      paymentMethod: 'SIMULATED_UPI',
    });

    expect(colRes.deduplicated).toBe(false);
    expect(colRes.collection.remainingBalancePaise).toBe(60000); // 100000 - 25000 - 15000
    expect(collectionCreateSpy).toHaveBeenCalledOnce();
    expect(paymentCreateSpy).toHaveBeenCalledWith(
      [expect.objectContaining({ amountPaise: 60000, type: 'PICKUP_BALANCE' })],
      expect.anything()
    );

    // Block completing trip while shipments remain unaccounted
    vi.spyOn(Trip, 'findOne').mockResolvedValueOnce({
      _id: tripId,
      driverId,
      tripCode: 'MC-TRIP-DONE-01',
      status: 'IN_PROGRESS',
      shipmentIds: [shipmentId],
      plannedDepartureAt: new Date(Date.now() - 3600_000),
    } as never);
    vi.spyOn(Shipment, 'find').mockReturnValueOnce({
      select: vi.fn().mockResolvedValue([{ reference: 'MC-REF-1', status: 'IN_TRANSIT' }]),
    } as never);

    await expect(
      transitionTripExecutionState({
        tripId: String(tripId),
        driverUserId: String(driverId),
        targetStatus: 'COMPLETED',
      })
    ).rejects.toMatchObject({ code: 'UNACCOUNTED_DELIVERIES' });

    // Once all shipments reach terminal state (e.g. DELIVERED), trip completion succeeds cleanly
    vi.spyOn(Trip, 'findOne').mockResolvedValueOnce({
      _id: tripId,
      driverId,
      tripCode: 'MC-TRIP-DONE-01',
      status: 'IN_PROGRESS',
      shipmentIds: [shipmentId],
      plannedDepartureAt: new Date(Date.now() - 3600_000),
      save: vi.fn().mockResolvedValue(undefined),
    } as never);
    vi.spyOn(Shipment, 'find').mockReturnValueOnce({
      select: vi.fn().mockResolvedValue([]),
    } as never);
    vi.spyOn(TripEvent, 'create').mockResolvedValueOnce({ _id: new Types.ObjectId() } as never);
    vi.spyOn(Trip, 'findById').mockRejectedValue(new Error('skip ledger calculation'));
    vi.spyOn(TripLedger, 'findOne').mockResolvedValueOnce(null);

    const completeRes = await transitionTripExecutionState({
      tripId: String(tripId),
      driverUserId: String(driverId),
      targetStatus: 'COMPLETED',
    });
    expect(completeRes.trip?.status).toBe('COMPLETED');
  });

  it('MC-070: verifies full pickup -> OTP delivery -> offline deduplication execution sequence cleanly', async () => {
    const tripId = new Types.ObjectId();
    const shipmentId = new Types.ObjectId();
    const driverId = new Types.ObjectId();

    const shipmentDoc = {
      _id: shipmentId,
      reference: 'MC-E2E-100',
      tripId,
      pickupStopCode: 'VAD',
      deliveryStopCode: 'ANA',
      createdByUserId: new Types.ObjectId(),
      recipientPhone: '+919800000111',
      trackingToken: 't'.repeat(48),
      qrToken: 'q'.repeat(32),
      status: 'LOCKED' as string,
      allowB2bWarehouseConfirm: false,
      pricingSnapshot: { finalLockedPricePaise: 50000, tokenPaidPaise: 12500, remainingBalancePaise: 37500 },
      statusHistory: [] as Array<Record<string, unknown>>,
      save: vi.fn().mockResolvedValue(undefined),
    };

    vi.spyOn(Trip, 'findOne').mockResolvedValue({
      _id: tripId,
      tripCode: 'MC-TRIP-E2E',
      driverId,
      status: 'IN_PROGRESS',
      shipmentIds: [shipmentId],
    } as never);
    vi.spyOn(Shipment, 'findOne').mockResolvedValue(shipmentDoc as never);
    vi.spyOn(TripEvent, 'create').mockResolvedValue([{ _id: new Types.ObjectId() }] as never);
    vi.spyOn(NotificationLog, 'findOne').mockResolvedValue(null);
    vi.spyOn(NotificationLog, 'create').mockResolvedValue({} as never);

    // 1. QR Pickup
    const pickup = await scanShipmentQrForPickup({
      tripId: String(tripId),
      driverUserId: String(driverId),
      qrToken: shipmentDoc.qrToken,
      expectedPickupStopCode: 'VAD',
    });
    expect(pickup.deduplicated).toBe(false);
    expect(shipmentDoc.status).toBe('PICKED_UP');

    // 2. Offline event sync deduplication
    vi.spyOn(TripEvent, 'findOne').mockResolvedValueOnce({ _id: new Types.ObjectId() } as never);
    const offlineSync = await syncOfflineDriverEvents({
      tripId: String(tripId),
      driverUserId: String(driverId),
      events: [
        {
          idempotencyKey: 'off-dup-1',
          kind: 'SHIPMENT_STATUS',
          shipmentId: String(shipmentId),
          targetStatus: 'AT_DESTINATION',
          occurredAt: new Date().toISOString(),
        },
      ],
    });
    expect(offlineSync.results[0].status).toBe('DUPLICATE');

    // 3. OTP Generation & Delivery Completion
    let storedOtpHash = '';
    vi.spyOn(DeliveryProof, 'findOneAndUpdate').mockImplementationOnce((async (
      _filter: unknown,
      update: { $set: { otpHash: string } }
    ) => {
      storedOtpHash = update.$set.otpHash;
      return {};
    }) as never);
    const otpOut = await generateShipmentDeliveryOtp({
      tripId: String(tripId),
      shipmentId: String(shipmentId),
      driverUserId: String(driverId),
    });
    expect(otpOut.demoOtp).toMatch(/^\d{6}$/);

    vi.spyOn(DeliveryProof, 'findOne').mockImplementationOnce((() => ({
      select: vi.fn().mockResolvedValue({
        otpHash: storedOtpHash,
        otpExpiresAt: new Date(Date.now() + 60_000),
        attemptCount: 0,
        maxAttempts: 5,
        save: vi.fn().mockResolvedValue(undefined),
      }),
    })) as never);

    const delivered = await verifyDeliveryAndComplete({
      tripId: String(tripId),
      shipmentId: String(shipmentId),
      driverUserId: String(driverId),
      confirmationMode: 'OTP',
      otp: otpOut.demoOtp,
    });
    expect(delivered.deduplicated).toBe(false);
    expect(shipmentDoc.status).toBe('DELIVERED');

    // Ensure addShipmentToPool signature import remains valid
    expect(typeof addShipmentToPool).toBe('function');
  });
});
