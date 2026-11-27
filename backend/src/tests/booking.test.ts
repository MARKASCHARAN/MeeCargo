import { Types } from 'mongoose';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { BusinessProfile } from '../models/BusinessProfile.js';
import { Corridor } from '../models/Corridor.js';
import { isValidShipmentTransition, Shipment } from '../models/Shipment.js';
import { Slot } from '../models/Slot.js';
import { User } from '../models/User.js';
import { signAccessToken } from '../services/authService.js';
import { calculateCargoMetrics } from '../services/cargoCalculator.js';
import { importShipmentsFromCsv } from '../services/csvImportService.js';
import { geocodeAddress } from '../services/geocodingService.js';
import {
  assertValidBookingCoordinates,
  createShipmentBooking,
} from '../services/shipmentService.js';
import { parseCsv } from '../utils/csv.js';

describe('Stage 3 Corridors, Cargo, Geocoding, Booking & CSV (MC-007 to MC-011)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calculates volumetric weight, chargeable weight, unit conversions, and volume separately', () => {
    // Bulky textile rolls: 120x30x30 = 108,000 cm3 / 5000 = 21.6 kg volumetric vs 15 kg actual
    const volumetricWins = calculateCargoMetrics({
      category: 'TEXTILE_ROLL',
      quantity: 2,
      length: 120,
      width: 30,
      height: 30,
      dimensionUnit: 'CM',
      unitActualWeight: 15,
      weightUnit: 'KG',
      volumetricDivisor: 5000,
    });

    expect(volumetricWins.totalActualWeightKg).toBe(30);
    expect(volumetricWins.totalVolumetricWeightKg).toBe(43.2);
    expect(volumetricWins.chargeableWeightKg).toBe(43.2);
    expect(volumetricWins.billingBasis).toBe('VOLUMETRIC');
    expect(volumetricWins.totalVolumeCbm).toBe(0.216);

    // Unit conversion: 10 in = 25.4 cm, 5000 g = 5 kg
    const heavySack = calculateCargoMetrics({
      category: 'SACK_BAG',
      quantity: 1,
      length: 10,
      width: 10,
      height: 10,
      dimensionUnit: 'IN',
      unitActualWeight: 5000,
      weightUnit: 'G',
      volumetricDivisor: 5000,
    });
    expect(heavySack.unitDimensionsCm.length).toBe(25.4);
    expect(heavySack.totalActualWeightKg).toBe(5);
    expect(heavySack.billingBasis).toBe('ACTUAL');
    expect(heavySack.chargeableWeightKg).toBe(5);
  });

  it('geocodes semi-urban Gujarat places in fixture mode and rejects missing coordinates', async () => {
    const match = await geocodeAddress({
      villageOrTown: 'Anand',
      district: 'Anand',
      pincode: '388001',
    });
    expect(match.provider).toBe('FIXTURE');
    expect(match.coordinates).toEqual([72.9289, 22.5645]);

    expect(() =>
      assertValidBookingCoordinates(
        {
          addressLine: 'Test',
          villageOrTown: 'Anand',
          district: 'Anand',
          state: 'Gujarat',
          pincode: '388001',
          location: { type: 'Point', coordinates: [0, 0] },
        },
        'Delivery'
      )
    ).toThrow(/coordinates are missing or invalid/);
  });

  it('validates explicit shipment lifecycle transitions', () => {
    expect(isValidShipmentTransition('PENDING_TOKEN', 'CONFIRMED')).toBe(true);
    expect(isValidShipmentTransition('CONFIRMED', 'POOLED')).toBe(true);
    expect(isValidShipmentTransition('PENDING_TOKEN', 'DELIVERED')).toBe(false);
    expect(isValidShipmentTransition('CANCELLED', 'CONFIRMED')).toBe(false);
  });

  it('blocks booking after slot cutoff and deduplicates idempotent submissions', async () => {
    const businessId = new Types.ObjectId();
    const corridorId = new Types.ObjectId();
    const slotId = new Types.ObjectId();

    const business = {
      _id: businessId,
      pickupAddress: {
        addressLine: 'Plot 1',
        villageOrTown: 'Vadodara',
        district: 'Vadodara',
        state: 'Gujarat',
        pincode: '390010',
        location: { type: 'Point', coordinates: [73.1812, 22.3072] },
      },
    } as never;

    const baseInput = {
      corridorId: String(corridorId),
      slotId: String(slotId),
      pickupStopCode: 'VAD',
      deliveryStopCode: 'ANA',
      deliveryAddress: {
        addressLine: 'Plot 12, GIDC',
        villageOrTown: 'Anand',
        district: 'Anand',
        state: 'Gujarat',
        pincode: '388001',
        location: { type: 'Point' as const, coordinates: [72.9289, 22.5645] as [number, number] },
      },
      recipientName: 'Anand Yarn',
      recipientPhone: '+919800000001',
      cargo: {
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
        declaredContents: 'Cotton cartons',
      },
      paymentChoice: 'TOKEN_PLUS_PICKUP_BALANCE' as const,
      idempotencyKey: 'idem-key-001',
    };

    // Case 1: Idempotency returns existing shipment
    vi.spyOn(Shipment, 'findOne').mockResolvedValueOnce({
      _id: new Types.ObjectId(),
      reference: 'MC-20261127-EXIST1',
    } as never);

    const deduped = await createShipmentBooking({
      business,
      userId: String(new Types.ObjectId()),
      input: baseInput,
    });
    expect(deduped.deduplicated).toBe(true);
    expect(deduped.shipment.reference).toBe('MC-20261127-EXIST1');

    // Case 2: Past cutoff throws CUTOFF_PASSED
    vi.spyOn(Shipment, 'findOne').mockResolvedValue(null);
    vi.spyOn(Corridor, 'findOne').mockResolvedValue({
      _id: corridorId,
      stops: [
        { stopCode: 'VAD', sequenceOrder: 0 },
        { stopCode: 'ANA', sequenceOrder: 1 },
      ],
    } as never);
    vi.spyOn(Slot, 'findById').mockResolvedValue({
      _id: slotId,
      corridorId,
      slotCode: 'SLOT-PAST',
      status: 'OPEN',
      cutoffAt: new Date(Date.now() - 60_000),
      capacityWeightKg: 2500,
      capacityVolumeCbm: 12,
      reservedWeightKg: 0,
      reservedVolumeCbm: 0,
    } as never);

    await expect(
      createShipmentBooking({
        business,
        userId: String(new Types.ObjectId()),
        input: baseInput,
      })
    ).rejects.toThrow(/cutoff has passed/i);
  });

  it('prevents a shipper from accessing another business shipment', async () => {
    const shipperId = new Types.ObjectId();
    const businessId = new Types.ObjectId();
    const otherShipmentId = new Types.ObjectId();

    vi.spyOn(User, 'findById').mockImplementation((() => ({
      select: vi.fn().mockResolvedValue({
        _id: shipperId,
        role: 'SHIPPER',
        businessId,
        isActive: true,
      }),
    })) as never);
    vi.spyOn(BusinessProfile, 'findOne').mockResolvedValue({
      _id: businessId,
      isActive: true,
    } as never);

    const populateChain = {
      populate: vi.fn().mockReturnThis(),
      then: (resolve: (val: unknown) => void) => resolve(null),
    };
    vi.spyOn(Shipment, 'findOne').mockReturnValue(populateChain as never);

    const token = signAccessToken({ _id: shipperId, role: 'SHIPPER', businessId });
    const app = createApp();
    const res = await request(app)
      .get(`/api/v1/shipments/${otherShipmentId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('validates CSV rows individually, flags duplicates, and does not drop valid rows', async () => {
    const corridorId = new Types.ObjectId();
    const slotId = new Types.ObjectId();
    const businessId = new Types.ObjectId();

    const csv = [
      'externalOrderRef,corridorCode,slotCode,pickupStopCode,deliveryStopCode,recipientName,recipientPhone,deliveryAddressLine,deliveryVillageOrTown,deliveryDistrict,deliveryState,deliveryPincode,deliveryLandmark,deliveryLongitude,deliveryLatitude,cargoCategory,quantity,lengthCm,widthCm,heightCm,unitActualWeightKg,stackable,declaredContents,handlingNotes,paymentChoice',
      'ORD-101,GJ-VAD-AMD-01,SLOT-AM,VAD,ANA,Anand Mills,+919825000111,"Plot 12, GIDC",Anand,Anand,Gujarat,388001,Near Tank,72.9289,22.5645,STANDARD_BOX,2,50,40,40,18,true,Cotton yarn,Keep dry,TOKEN_PLUS_PICKUP_BALANCE',
      'ORD-101,GJ-VAD-AMD-01,SLOT-AM,VAD,ANA,Anand Mills,+919825000111,Plot 12,Anand,Anand,Gujarat,388001,,72.9289,22.5645,STANDARD_BOX,1,50,40,40,18,true,Duplicate order,,TOKEN_PLUS_PICKUP_BALANCE',
      'ORD-102,GJ-VAD-AMD-01,SLOT-AM,VAD,ANA,Bad Pin Co,+919825000222,Plot 9,Anand,Anand,Gujarat,BADPIN,,72.9289,22.5645,STANDARD_BOX,1,50,40,40,18,true,Invalid pin,,TOKEN_PLUS_PICKUP_BALANCE',
    ].join('\n');

    expect(parseCsv(csv).rows).toHaveLength(3);

    vi.spyOn(Corridor, 'find').mockResolvedValue([
      {
        _id: corridorId,
        code: 'GJ-VAD-AMD-01',
        stops: [
          { stopCode: 'VAD', sequenceOrder: 0 },
          { stopCode: 'ANA', sequenceOrder: 1 },
        ],
      },
    ] as never);
    vi.spyOn(Slot, 'find').mockResolvedValue([
      {
        _id: slotId,
        corridorId,
        slotCode: 'SLOT-AM',
        status: 'OPEN',
        cutoffAt: new Date(Date.now() + 3600_000),
        capacityWeightKg: 2500,
        capacityVolumeCbm: 12,
        reservedWeightKg: 0,
        reservedVolumeCbm: 0,
      },
    ] as never);
    vi.spyOn(Shipment, 'find').mockImplementation((() => ({
      select: vi.fn().mockResolvedValue([]),
    })) as never);

    const report = await importShipmentsFromCsv({
      csvText: csv,
      business: { _id: businessId } as never,
      userId: String(new Types.ObjectId()),
      dryRun: true,
    });

    expect(report.summary).toEqual({
      totalRows: 3,
      createdCount: 1,
      rejectedCount: 1,
      duplicateCount: 1,
    });
    expect(report.rejected[0].rowNumber).toBe(4);
    expect(report.duplicates[0].externalOrderRef).toBe('ORD-101');
  });
});
