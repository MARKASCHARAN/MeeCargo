import { Types } from 'mongoose';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { BusinessProfile } from '../models/BusinessProfile.js';
import { Corridor } from '../models/Corridor.js';
import { DriverSlotCommitment } from '../models/DriverSlotCommitment.js';
import { Pool } from '../models/Pool.js';
import { PricingConfig } from '../models/PricingConfig.js';
import { Shipment } from '../models/Shipment.js';
import { Slot } from '../models/Slot.js';
import { User } from '../models/User.js';
import { signAccessToken } from '../services/authService.js';
import * as cutoffService from '../services/cutoffService.js';
import {
  createShipmentBooking,
  matchOperationalSlotForBooking,
} from '../services/shipmentService.js';

describe('MC-058: Shipper Scheduled Corridors & Live Pools Cleanup + Automated Cutoff Enforcement', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sanitizes shipper corridor slots (no driver return timing choice) and strips internal fields on shipper /pools', async () => {
    const app = createApp();
    const corridorId = new Types.ObjectId();
    const slotId = new Types.ObjectId();
    const poolId = new Types.ObjectId();
    const shipperId = new Types.ObjectId();

    const shipperToken = signAccessToken({
      _id: shipperId,
      role: 'SHIPPER',
      businessId: new Types.ObjectId(),
    });

    // 1. /api/v1/corridors omits return timing choices and exposes bookable/full flags cleanly
    vi.spyOn(Corridor, 'find').mockReturnValueOnce({
      sort: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue([
          {
            _id: corridorId,
            code: 'GJ-VAD-AMD-01',
            name: 'Vadodara - Ahmedabad Corridor',
            stops: [],
            operatingDays: ['MON', 'TUE'],
            guaranteedCeilingPaisePerKg: 650,
            baseRatePaisePerKg: 450,
            isActive: true,
            isDemoData: true,
            isEstablishedRoute: true,
          },
        ]),
      }),
    } as never);

    vi.spyOn(Slot, 'find').mockReturnValueOnce({
      sort: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue([
          {
            _id: slotId,
            corridorId,
            slotNumber: 2,
            slotCode: 'GJ-VAD-AMD-01-SLOT2',
            label: 'Pickup Slot 2 (12:30 Outbound • Mandatory 16:30 Return)',
            departureDate: new Date('2026-11-30T00:00:00Z'),
            cutoffAt: new Date(Date.now() + 3600_000),
            plannedDepartureAt: new Date(Date.now() + 7200_000),
            capacityWeightKg: 2500,
            capacityVolumeCbm: 12,
            reservedWeightKg: 500,
            reservedVolumeCbm: 2,
            status: 'OPEN',
            returnTimeOptions: ['16:30'],
            returnTimeLocked: true,
            lockedReturnTime: '16:30',
          },
        ]),
      }),
    } as never);

    vi.spyOn(Pool, 'find').mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue([
          {
            _id: poolId,
            slotId,
            status: 'OPEN',
            shipmentIds: [new Types.ObjectId()],
          },
        ]),
      }),
    } as never);

    vi.spyOn(PricingConfig, 'findOne').mockReturnValueOnce({
      sort: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(null) }),
    } as never);

    const corRes = await request(app).get('/api/v1/corridors');
    expect(corRes.status).toBe(200);
    const slot = corRes.body.corridors[0].slots[0];
    expect(slot.label).toBe('Pickup Slot 2 (12:30 Outbound)');
    expect(slot.returnTimeOptions).toBeUndefined();
    expect(slot.returnTimeLocked).toBeUndefined();
    expect(slot.lockedReturnTime).toBeUndefined();
    expect(slot.isFull).toBe(false);
    expect(corRes.body.corridors[0].isDemoData).toBeUndefined();
    expect(corRes.body.corridors[0].isEstablishedRoute).toBeUndefined();
    expect(corRes.body.corridors[0].serviceDates).toHaveLength(1);
    expect(corRes.body.corridors[0].serviceDates[0]).toMatchObject({
      serviceDate: '2026-11-30',
      status: 'OPEN',
      bookable: true,
      pooledShipmentCount: 1,
      availableWeightKg: 2000,
      availableVolumeCbm: 10,
    });

    // 2. /api/v1/pools omits pricingVersion, poolCode, trip, and Base Pool label for SHIPPER
    vi.spyOn(User, 'findById').mockReturnValueOnce({
      select: vi.fn().mockResolvedValue({ _id: shipperId, role: 'SHIPPER', isActive: true }),
    } as never);
    vi.spyOn(Pool, 'find').mockReturnValueOnce({
      populate: vi.fn().mockReturnValue({
        populate: vi.fn().mockReturnValue({
          sort: vi.fn().mockResolvedValue([
            {
              _id: poolId,
              poolCode: 'POOL-INTERNAL-01',
              status: 'OPEN',
              viabilityStatus: 'PENDING',
              corridorId: {
                _id: corridorId,
                code: 'GJ-VAD-AMD-01',
                name: 'Vadodara - Ahmedabad',
                baseRatePaisePerKg: 450,
                guaranteedCeilingPaisePerKg: 650,
              },
              slotId: {
                _id: slotId,
                slotCode: 'GJ-VAD-AMD-01-SLOT2',
                slotNumber: 2,
                label: 'Pickup Slot 2 (12:30 Outbound • Mandatory 16:30 Return)',
                departureDate: new Date('2026-11-30T00:00:00Z'),
                cutoffAt: new Date(Date.now() + 3600_000),
                plannedDepartureAt: new Date(Date.now() + 7200_000),
              },
              capacityWeightKg: 2500,
              capacityVolumeCbm: 12,
              reservedWeightKg: 250,
              reservedVolumeCbm: 1,
              shipmentIds: [new Types.ObjectId()],
              toObject() {
                return this;
              },
            },
          ]),
        }),
      }),
    } as never);
    vi.spyOn(PricingConfig, 'findOne').mockReturnValueOnce({
      sort: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(null) }),
    } as never);

    const poolsRes = await request(app)
      .get('/api/v1/pools')
      .set('Authorization', `Bearer ${shipperToken}`);

    expect(poolsRes.status).toBe(200);
    expect(poolsRes.body.pricingVersion).toBeUndefined();
    expect(poolsRes.body.pools[0].poolCode).toBeUndefined();
    expect(poolsRes.body.pools[0].trip).toBeUndefined();
    expect(poolsRes.body.pools[0].liveMetrics.appliedTierLabel).toBeUndefined();
    expect(poolsRes.body.pools[0].slotId.label).toBe('Pickup Slot 2 (12:30 Outbound)');
  });

  it('blocks SHIPPER from triggering manual pool cutoff or allocation and runs automated cutoff sweep for expired slots', async () => {
    const app = createApp();
    const shipperId = new Types.ObjectId();
    const poolId = new Types.ObjectId();
    const shipperToken = signAccessToken({
      _id: shipperId,
      role: 'SHIPPER',
      businessId: new Types.ObjectId(),
    });

    vi.spyOn(User, 'findById').mockReturnValue({
      select: vi.fn().mockResolvedValue({ _id: shipperId, role: 'SHIPPER', isActive: true }),
    } as never);

    const cutoffAttempt = await request(app)
      .post(`/api/v1/pools/${poolId}/cutoff`)
      .set('Authorization', `Bearer ${shipperToken}`)
      .send({});
    expect(cutoffAttempt.status).toBe(403);

    const allocateAttempt = await request(app)
      .post(`/api/v1/pools/${poolId}/allocate`)
      .set('Authorization', `Bearer ${shipperToken}`)
      .send({});
    expect(allocateAttempt.status).toBe(403);

    // Automated sweep processes expired open pool and cancels empty expired slot
    const expiredSlotWithPool = { _id: new Types.ObjectId(), status: 'OPEN', cutoffAt: new Date(Date.now() - 1000) };
    const expiredEmptySlot = { _id: new Types.ObjectId(), status: 'OPEN', cutoffAt: new Date(Date.now() - 1000) };
    vi.spyOn(Slot, 'find').mockReturnValueOnce({
      sort: vi.fn().mockResolvedValue([expiredSlotWithPool, expiredEmptySlot]),
    } as never);
    vi.spyOn(Pool, 'findOne')
      .mockResolvedValueOnce({ _id: poolId, slotId: expiredSlotWithPool._id, status: 'OPEN' } as never)
      .mockResolvedValueOnce(null);
    // Short-circuit executePoolCutoff idempotently when queried inside sweep or spy Pool.findById
    vi.spyOn(Pool, 'findById').mockResolvedValueOnce({
      _id: poolId,
      status: 'LOCKED',
      lockedSnapshot: { lockedAt: new Date() },
    } as never);
    const cancelSpy = vi.spyOn(Slot, 'updateOne').mockResolvedValueOnce({ modifiedCount: 1 } as never);

    const sweepRes = await cutoffService.processExpiredOpenPools(new Date());
    expect(sweepRes.processedCount).toBe(1);
    expect(sweepRes.expiredEmptySlotsCount).toBe(1);
    expect(cancelSpy).toHaveBeenCalledWith(
      { _id: expiredEmptySlot._id, status: 'OPEN' },
      { $set: { status: 'CANCELLED' } }
    );
  });

  it('books and previews quotes by serviceDate without shipper slot selection, prioritizing committed pools and enforcing weight/volume caps', async () => {
    const app = createApp();
    const corridorId = new Types.ObjectId();
    const slot1Id = new Types.ObjectId();
    const slot2Id = new Types.ObjectId();
    const businessId = new Types.ObjectId();
    const userId = String(new Types.ObjectId());
    const serviceDateStr = '2026-12-05';
    const serviceDate = new Date(`${serviceDateStr}T00:00:00Z`);

    const slot1 = {
      _id: slot1Id,
      corridorId,
      slotNumber: 1,
      slotCode: 'COR-DEC05-S1',
      label: 'Pickup Slot 1',
      departureDate: serviceDate,
      cutoffAt: new Date(Date.now() + 3600_000),
      plannedDepartureAt: new Date(Date.now() + 7200_000),
      capacityWeightKg: 2000,
      capacityVolumeCbm: 10,
      reservedWeightKg: 200,
      reservedVolumeCbm: 1,
      status: 'OPEN',
    };
    const slot2 = {
      _id: slot2Id,
      corridorId,
      slotNumber: 2,
      slotCode: 'COR-DEC05-S2',
      label: 'Pickup Slot 2',
      departureDate: serviceDate,
      cutoffAt: new Date(Date.now() + 7200_000),
      plannedDepartureAt: new Date(Date.now() + 10800_000),
      capacityWeightKg: 2000,
      capacityVolumeCbm: 10,
      reservedWeightKg: 400,
      reservedVolumeCbm: 2,
      status: 'OPEN',
    };

    // 1. Matcher prefers Slot 2 when a Tier 1 driver commitment exists on Slot 2
    vi.spyOn(Slot, 'find').mockReturnValueOnce({
      sort: vi.fn().mockResolvedValue([slot1, slot2]),
    } as never);
    vi.spyOn(DriverSlotCommitment, 'find').mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue([{ slotId: slot2Id }]),
      }),
    } as never);
    vi.spyOn(Pool, 'find').mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue([]),
      }),
    } as never);

    const matched = await matchOperationalSlotForBooking({
      corridorId,
      serviceDate: serviceDateStr,
      chargeableWeightKg: 120,
      volumeCbm: 0.8,
    });
    expect(String(matched._id)).toBe(String(slot2Id));

    // 2. Booking succeeds strictly with serviceDate (NO slotId in payload)
    vi.spyOn(Corridor, 'findOne').mockResolvedValueOnce({
      _id: corridorId,
      code: 'GJ-VAD-AMD-01',
      isActive: true,
      stops: [
        { stopCode: 'VAD', sequenceOrder: 0 },
        { stopCode: 'ANA', sequenceOrder: 1 },
      ],
    } as never);
    vi.spyOn(Slot, 'find').mockReturnValueOnce({
      sort: vi.fn().mockResolvedValue([slot1, slot2]),
    } as never);
    vi.spyOn(DriverSlotCommitment, 'find').mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue([{ slotId: slot2Id }]),
      }),
    } as never);
    vi.spyOn(Pool, 'find').mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue([]),
      }),
    } as never);
    const createSpy = vi.spyOn(Shipment, 'create').mockImplementationOnce(
      ((doc: Record<string, unknown>) =>
        Promise.resolve({ _id: new Types.ObjectId(), ...doc })) as never
    );

    const booking = await createShipmentBooking({
      business: {
        _id: businessId,
        pickupAddress: {
          addressLine: 'Plot 1',
          villageOrTown: 'Vadodara',
          district: 'Vadodara',
          state: 'Gujarat',
          pincode: '390001',
          location: { type: 'Point', coordinates: [73.18, 22.3] },
        },
      } as never,
      userId,
      input: {
        corridorId: String(corridorId),
        serviceDate: serviceDateStr,
        pickupStopCode: 'VAD',
        deliveryStopCode: 'ANA',
        deliveryAddress: {
          addressLine: 'Plot 5',
          villageOrTown: 'Anand',
          district: 'Anand',
          state: 'Gujarat',
          pincode: '388001',
          location: { type: 'Point', coordinates: [72.92, 22.56] },
        },
        recipientName: 'Anand Depot',
        recipientPhone: '+919825000111',
        cargo: {
          category: 'STANDARD_BOX',
          quantity: 2,
          length: 50,
          width: 40,
          height: 40,
          dimensionUnit: 'CM',
          unitActualWeight: 20,
          weightUnit: 'KG',
          stackable: true,
          handlingRestrictions: [],
          declaredContents: 'Cartons',
        },
        paymentChoice: 'TOKEN_PLUS_PICKUP_BALANCE',
      },
    });
    expect(createSpy).toHaveBeenCalledOnce();
    expect(String(booking.shipment.slotId)).toBe(String(slot2Id));

    // 3. Rejects oversized cargo exceeding remaining volume on that serviceDate
    vi.spyOn(Slot, 'find').mockReturnValueOnce({
      sort: vi.fn().mockResolvedValue([slot1, slot2]),
    } as never);
    await expect(
      matchOperationalSlotForBooking({
        corridorId,
        serviceDate: serviceDateStr,
        chargeableWeightKg: 100,
        volumeCbm: 9.5,
      })
    ).rejects.toThrow(/Insufficient remaining capacity/i);

    // 4. Quote preview endpoint accepts serviceDate without slotId
    vi.spyOn(User, 'findById').mockReturnValueOnce({
      select: vi.fn().mockResolvedValue({ _id: userId, role: 'SHIPPER', isActive: true }),
    } as never);
    vi.spyOn(Corridor, 'findOne').mockResolvedValueOnce({
      _id: corridorId,
      baseRatePaisePerKg: 450,
      guaranteedCeilingPaisePerKg: 650,
    } as never);
    vi.spyOn(PricingConfig, 'findOne').mockReturnValueOnce({
      sort: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(null) }),
    } as never);
    vi.spyOn(Slot, 'find').mockReturnValueOnce({
      sort: vi.fn().mockResolvedValue([slot1]),
    } as never);

    const token = signAccessToken({
      _id: new Types.ObjectId(userId),
      role: 'SHIPPER',
      businessId,
    });
    const quoteRes = await request(app)
      .post('/api/v1/shipments/quote-preview')
      .set('Authorization', `Bearer ${token}`)
      .send({
        corridorId: String(corridorId),
        serviceDate: serviceDateStr,
        chargeableWeightKg: 100,
        volumeCbm: 1,
      });
    expect(quoteRes.status).toBe(200);
    expect(quoteRes.body.breakdown.ceilingPricePaise).toBe(70000);
    expect(quoteRes.body.breakdown.effectiveRatePaisePerKg).toBeLessThanOrEqual(650);
    expect(quoteRes.body.breakdown.remainingBalancePaise).toBe(
      Math.max(
        0,
        quoteRes.body.breakdown.computedPricePaise - quoteRes.body.breakdown.tokenAmountPaise
      )
    );
  });

  it('MC-062: enforces corridor origin hub, drop-zone geo radius, token-only payment, and blocks HTTP slotId manipulation', async () => {
    const app = createApp();
    const shipperId = new Types.ObjectId();
    const businessId = new Types.ObjectId();
    const corridorId = new Types.ObjectId();
    const slotId = new Types.ObjectId();
    const shipperToken = signAccessToken({
      _id: shipperId,
      role: 'SHIPPER',
      businessId,
    });

    vi.spyOn(User, 'findById').mockReturnValue({
      select: vi.fn().mockResolvedValue({ _id: shipperId, role: 'SHIPPER', isActive: true }),
    } as never);
    vi.spyOn(BusinessProfile, 'findOne').mockResolvedValue({
      _id: businessId,
      isActive: true,
      pickupAddress: {
        addressLine: 'Plot 1',
        villageOrTown: 'Vadodara',
        district: 'Vadodara',
        state: 'Gujarat',
        pincode: '390010',
        location: { type: 'Point', coordinates: [73.1812, 22.3072] },
      },
    } as never);

    const validDeliveryAddress = {
      addressLine: 'Plot 12, GIDC',
      villageOrTown: 'Anand',
      district: 'Anand',
      state: 'Gujarat',
      pincode: '388001',
      location: { type: 'Point' as const, coordinates: [72.9289, 22.5645] as [number, number] },
    };
    const validCargo = {
      category: 'STANDARD_BOX' as const,
      quantity: 2,
      length: 50,
      width: 40,
      height: 40,
      dimensionUnit: 'CM' as const,
      unitActualWeight: 18,
      weightUnit: 'KG' as const,
      stackable: true,
      handlingRestrictions: [],
      declaredContents: 'Cartons',
    };

    // 1. Blocks shipper-supplied slotId in HTTP POST /api/v1/shipments
    const slotTamperRes = await request(app)
      .post('/api/v1/shipments')
      .set('Authorization', `Bearer ${shipperToken}`)
      .send({
        corridorId: String(corridorId),
        serviceDate: '2026-12-05',
        slotId: String(slotId),
        pickupStopCode: 'VAD',
        deliveryStopCode: 'ANA',
        deliveryAddress: validDeliveryAddress,
        recipientName: 'Anand Buyer',
        recipientPhone: '+919825000111',
        cargo: validCargo,
      });
    expect(slotTamperRes.status).toBe(400);
    expect(slotTamperRes.body.code).toBe('DRIVER_SLOT_SELECTION_FORBIDDEN');

    // 2. Rejects unsupported FULL_PREPAID payment option on HTTP booking
    const prepaidRes = await request(app)
      .post('/api/v1/shipments')
      .set('Authorization', `Bearer ${shipperToken}`)
      .send({
        corridorId: String(corridorId),
        serviceDate: '2026-12-05',
        pickupStopCode: 'VAD',
        deliveryStopCode: 'ANA',
        deliveryAddress: validDeliveryAddress,
        recipientName: 'Anand Buyer',
        recipientPhone: '+919825000111',
        cargo: validCargo,
        paymentChoice: 'FULL_PREPAID',
      });
    expect(prepaidRes.status).toBe(400);

    // 3. Rejects intermediate stop as origin hub (INVALID_ORIGIN_STOP)
    vi.spyOn(Corridor, 'findOne').mockResolvedValueOnce({
      _id: corridorId,
      code: 'GJ-VAD-AMD-01',
      isActive: true,
      stops: [
        { stopCode: 'VAD', name: 'Vadodara Hub', sequenceOrder: 0, location: { coordinates: [73.1812, 22.3072] } },
        { stopCode: 'ANA', name: 'Anand Drop Zone', sequenceOrder: 1, location: { coordinates: [72.9289, 22.5645] } },
        { stopCode: 'AMD', name: 'Ahmedabad Destination', sequenceOrder: 2, location: { coordinates: [72.5714, 23.0225] } },
      ],
    } as never);
    await expect(
      createShipmentBooking({
        business: { _id: businessId, pickupAddress: { location: { coordinates: [73.1812, 22.3072] } } } as never,
        userId: String(shipperId),
        input: {
          corridorId: String(corridorId),
          serviceType: 'STANDARD_SCHEDULED_SHARED_POOL',
          serviceDate: '2026-12-05',
          pickupStopCode: 'ANA',
          deliveryStopCode: 'AMD',
          deliveryAddress: validDeliveryAddress,
          recipientName: 'Buyer',
          recipientPhone: '+919825000111',
          cargo: validCargo,
          paymentChoice: 'TOKEN_PLUS_PICKUP_BALANCE',
        },
      })
    ).rejects.toMatchObject({ code: 'INVALID_ORIGIN_STOP' });

    // 4. Rejects delivery pin outside destination drop zone radius (DELIVERY_OUT_OF_DROP_ZONE)
    vi.spyOn(Corridor, 'findOne').mockResolvedValueOnce({
      _id: corridorId,
      code: 'GJ-VAD-AMD-01',
      isActive: true,
      stops: [
        { stopCode: 'VAD', name: 'Vadodara Hub', sequenceOrder: 0, location: { coordinates: [73.1812, 22.3072] } },
        { stopCode: 'ANA', name: 'Anand Drop Zone', sequenceOrder: 1, location: { coordinates: [72.9289, 22.5645] } },
        { stopCode: 'AMD', name: 'Ahmedabad Destination', sequenceOrder: 2, location: { coordinates: [72.5714, 23.0225] } },
      ],
    } as never);
    await expect(
      createShipmentBooking({
        business: { _id: businessId, pickupAddress: { location: { coordinates: [73.1812, 22.3072] } } } as never,
        userId: String(shipperId),
        input: {
          corridorId: String(corridorId),
          serviceType: 'STANDARD_SCHEDULED_SHARED_POOL',
          serviceDate: '2026-12-05',
          pickupStopCode: 'VAD',
          deliveryStopCode: 'ANA',
          deliveryAddress: {
            ...validDeliveryAddress,
            location: { type: 'Point', coordinates: [72.5714, 23.0225] }, // ~63 km away (Ahmedabad vs Anand)
          },
          recipientName: 'Buyer',
          recipientPhone: '+919825000111',
          cargo: validCargo,
          paymentChoice: 'TOKEN_PLUS_PICKUP_BALANCE',
        },
      })
    ).rejects.toMatchObject({ code: 'DELIVERY_OUT_OF_DROP_ZONE' });
  });
});
