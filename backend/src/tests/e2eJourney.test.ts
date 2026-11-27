import { Types } from 'mongoose';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { BackhaulRequest } from '../models/BackhaulRequest.js';
import { BusinessProfile } from '../models/BusinessProfile.js';
import { Corridor } from '../models/Corridor.js';
import { DeliveryProof } from '../models/DeliveryProof.js';
import { NotificationLog } from '../models/NotificationLog.js';
import { Payment } from '../models/Payment.js';
import { RouteMatrixCache } from '../models/RouteMatrixCache.js';
import { Shipment } from '../models/Shipment.js';
import { Slot } from '../models/Slot.js';
import { Trip } from '../models/Trip.js';
import { TripEvent } from '../models/TripEvent.js';
import { User } from '../models/User.js';
import { Vehicle } from '../models/Vehicle.js';
import { signAccessToken } from '../services/authService.js';
import { calculateDeterministicPrice, DEFAULT_PRICING_RULES } from '../services/pricingEngine.js';

describe('Stage 10 Optimizer Integration, Rounding Precision & End-to-End Flow (MC-040)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rounds fractional chargeable-weight charges accurately to integer paise without exceeding ceiling', () => {
    const result = calculateDeterministicPrice({
      chargeableWeightKg: 12.37,
      baseRatePaisePerKg: 483,
      guaranteedCeilingPaisePerKg: 550,
      weightUtilizationPct: 45,
      volumeUtilizationPct: 35,
      isAnchorEligible: true,
      rules: DEFAULT_PRICING_RULES,
    });

    expect(Number.isInteger(result.baseFreightPaise)).toBe(true);
    expect(Number.isInteger(result.poolDiscountPaise)).toBe(true);
    expect(Number.isInteger(result.anchorDiscountPaise)).toBe(true);
    expect(Number.isInteger(result.computedPricePaise)).toBe(true);
    expect(Number.isInteger(result.tokenAmountPaise)).toBe(true);
    expect(result.computedPricePaise).toBeLessThanOrEqual(result.ceilingPricePaise);
  });

  it('integrates Express optimize-route endpoint with FastAPI OR-Tools optimizer response and builds LIFO plan', async () => {
    const driverId = new Types.ObjectId();
    const tripId = new Types.ObjectId();
    const corridorId = new Types.ObjectId();
    const vehicleId = new Types.ObjectId();
    const shipmentId = new Types.ObjectId();

    const driverToken = signAccessToken({ _id: driverId, role: 'DRIVER' });
    const app = createApp();

    vi.spyOn(User, 'findById').mockReturnValueOnce({
      select: vi.fn().mockResolvedValue({
        _id: driverId,
        role: 'DRIVER',
        isActive: true,
      }),
    } as never);

    const saveTrip = vi.fn().mockResolvedValue(undefined);
    const tripDoc = {
      _id: tripId,
      tripCode: 'MC-INT-TRIP-1',
      driverId,
      corridorId,
      vehicleId,
      plannedDepartureAt: new Date(),
      estimatedEndAt: new Date(Date.now() + 7200_000),
      shipmentIds: [shipmentId],
      stopsSummary: [
        { stopCode: 'VAD', name: 'Vadodara', sequenceOrder: 0 },
        { stopCode: 'ANA', name: 'Anand', sequenceOrder: 1 },
      ],
      save: saveTrip,
    };

    vi.spyOn(Trip, 'findOne').mockResolvedValueOnce(tripDoc as never);
    vi.spyOn(Trip, 'findById').mockResolvedValue(tripDoc as never);

    vi.spyOn(Corridor, 'findById').mockResolvedValueOnce({
      _id: corridorId,
      stops: [
        {
          stopCode: 'VAD',
          name: 'Vadodara Hub',
          sequenceOrder: 0,
          location: { coordinates: [73.1812, 22.3072] },
        },
        {
          stopCode: 'ANA',
          name: 'Anand Drop',
          sequenceOrder: 1,
          location: { coordinates: [72.9289, 22.5645] },
        },
      ],
    } as never);

    vi.spyOn(Vehicle, 'findById').mockResolvedValue({
      _id: vehicleId,
      registrationNumber: 'GJ-06-MC-1001',
      tier: 'TIER_1',
      maxWeightKg: 2500,
      maxVolumeCbm: 12.5,
      bedDimensionsCm: { length: 425, width: 195, height: 150 },
      perKmRatePaise: 2400,
      minGuaranteePaise: 320000,
    } as never);

    vi.spyOn(Shipment, 'find').mockResolvedValueOnce([
      {
        _id: shipmentId,
        reference: 'MC-INT-SHP-1',
        deliveryStopCode: 'ANA',
        cargo: {
          quantity: 4,
          chargeableWeightKg: 120,
          volumeCbm: 0.8,
          unitDimensionsCm: { length: 60, width: 40, height: 40 },
          stackable: true,
        },
      },
    ] as never);

    vi.spyOn(RouteMatrixCache, 'findOne').mockReturnValueOnce({
      lean: vi.fn().mockResolvedValue({
        provider: 'FIXTURE',
        stopCodes: ['VAD', 'ANA'],
        distanceMatrixMeters: [
          [0, 42800],
          [42800, 0],
        ],
        durationMatrixSeconds: [
          [0, 3120],
          [3120, 0],
        ],
      }),
    } as never);

    // Mock FastAPI OR-Tools optimizer HTTP response
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 'OPTIMAL',
        total_distance_meters: 42800,
        estimated_duration_seconds: 3120,
        ordered_stops: [
          {
            sequence: 0,
            stop_code: 'VAD',
            name: 'Vadodara Hub',
            arrival_min: 0,
            cumulative_distance_meters: 0,
            shipment_ids: [],
          },
          {
            sequence: 1,
            stop_code: 'ANA',
            name: 'Anand Drop',
            arrival_min: 52,
            cumulative_distance_meters: 42800,
            shipment_ids: [String(shipmentId)],
          },
        ],
      }),
    } as never);

    vi.spyOn(BackhaulRequest, 'find').mockReturnValueOnce({
      sort: vi.fn().mockResolvedValue([]),
    } as never);

    const res = await request(app)
      .post(`/api/v1/driver/trips/${tripId}/optimize-route`)
      .set('Authorization', `Bearer ${driverToken}`)
      .send({});

    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(res.body.optimized).toBe(true);
    expect(res.body.routePlan.optimizationStatus).toBe('OPTIMAL');
    expect(res.body.routePlan.totalDistanceMeters).toBe(42800);
    expect(res.body.loadingPlan.sequenceItems).toHaveLength(1);
    expect(res.body.loadingPlan.sequenceItems[0].zoneColor).toBe('GREEN');
    expect(saveTrip).toHaveBeenCalled();
  });

  it('completes end-to-end journey from shipper booking to recipient public tracking without leaking private data', async () => {
    const shipperId = new Types.ObjectId();
    const driverId = new Types.ObjectId();
    const businessId = new Types.ObjectId();
    const corridorId = new Types.ObjectId();
    const slotId = new Types.ObjectId();
    const tripId = new Types.ObjectId();
    const shipmentId = new Types.ObjectId();

    const trackingToken = 'e2e_tok_abcdef1234567890abcdef123456';
    const qrToken = 'MCR_E2E_QR_TOKEN_12345';

    const shipperToken = signAccessToken({
      _id: shipperId,
      role: 'SHIPPER',
      businessId,
    });
    const driverToken = signAccessToken({
      _id: driverId,
      role: 'DRIVER',
    });

    const app = createApp();

    // Shared mutable state across mocked booking -> pickup -> delivery -> public tracking steps
    const statusHistory: Array<{ status: string; at: Date; note?: string }> = [
      { status: 'PENDING_TOKEN', at: new Date(), note: 'Booking created' },
    ];
    let currentStatus = 'PENDING_TOKEN';
    let tokenPaidAt: Date | undefined;
    let deliveryOtpHash: string | undefined;

    const saveShipment = vi.fn().mockImplementation(async () => undefined);
    const shipmentState: Record<string, unknown> = {
      _id: shipmentId,
      reference: 'MC-E2E-001',
      businessId,
      createdByUserId: shipperId,
      corridorId,
      slotId,
      tripId,
      pickupStopCode: 'VAD',
      pickupStopOrder: 0,
      deliveryStopCode: 'ANA',
      deliveryStopOrder: 1,
      pickupAddress: {
        addressLine: 'Plot 1',
        villageOrTown: 'Vadodara',
        district: 'Vadodara',
        state: 'Gujarat',
        pincode: '390010',
        location: { type: 'Point', coordinates: [73.1812, 22.3072] },
      },
      deliveryAddress: {
        addressLine: 'Plot 12',
        villageOrTown: 'Anand',
        district: 'Anand',
        state: 'Gujarat',
        pincode: '388001',
        location: { type: 'Point', coordinates: [72.9289, 22.5645] },
      },
      recipientName: 'Anand Buyer',
      recipientPhone: '+919800000999',
      cargo: {
        category: 'STANDARD_BOX',
        quantity: 2,
        chargeableWeightKg: 40,
        volumeCbm: 0.3,
        declaredContents: 'Electrical parts',
      },
      tokenStatus: 'PAID',
      get status() {
        return currentStatus;
      },
      set status(val: string) {
        currentStatus = val;
      },
      pricingSnapshot: {
        ceilingPricePaise: 27000,
        projectedPricePaise: 24000,
        finalLockedPricePaise: 24000,
        tokenAmountPaise: 4050,
        tokenPaidPaise: 4050,
        remainingBalancePaise: 19950,
      },
      trackingToken,
      qrToken,
      statusHistory,
      allowB2bWarehouseConfirm: false,
      get deliveryOtpHash() {
        return deliveryOtpHash;
      },
      set deliveryOtpHash(v: string | undefined) {
        deliveryOtpHash = v;
      },
      deliveryOtpAttempts: 0,
      get pickupBalanceRequestedAt() {
        return tokenPaidAt;
      },
      set pickupBalanceRequestedAt(v: Date | undefined) {
        tokenPaidAt = v;
      },
      save: saveShipment,
    };

    // Step 1: Shipper creates booking via API
    vi.spyOn(User, 'findById').mockReturnValueOnce({
      select: vi.fn().mockResolvedValue({
        _id: shipperId,
        role: 'SHIPPER',
        businessId,
        isActive: true,
      }),
    } as never);
    vi.spyOn(BusinessProfile, 'findOne').mockResolvedValueOnce({
      _id: businessId,
      pickupAddress: shipmentState.pickupAddress,
    } as never);
    vi.spyOn(Corridor, 'findOne').mockResolvedValueOnce({
      _id: corridorId,
      isActive: true,
      baseRatePaisePerKg: 480,
      guaranteedCeilingPaisePerKg: 550,
      stops: [
        { stopCode: 'VAD', sequenceOrder: 0 },
        { stopCode: 'ANA', sequenceOrder: 1 },
      ],
    } as never);
    vi.spyOn(Slot, 'findById').mockResolvedValueOnce({
      _id: slotId,
      corridorId,
      status: 'OPEN',
      cutoffAt: new Date(Date.now() + 3600_000),
      capacityWeightKg: 2500,
      capacityVolumeCbm: 12,
      reservedWeightKg: 0,
      reservedVolumeCbm: 0,
    } as never);
    vi.spyOn(Shipment, 'create').mockResolvedValueOnce(shipmentState as never);

    const bookRes = await request(app)
      .post('/api/v1/shipments')
      .set('Authorization', `Bearer ${shipperToken}`)
      .send({
        corridorId: String(corridorId),
        slotId: String(slotId),
        pickupStopCode: 'VAD',
        deliveryStopCode: 'ANA',
        deliveryAddress: shipmentState.deliveryAddress,
        recipientName: 'Anand Buyer',
        recipientPhone: '+919800000999',
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
          declaredContents: 'Electrical parts',
        },
        paymentChoice: 'TOKEN_PLUS_PICKUP_BALANCE',
      });

    expect(bookRes.status).toBe(201);
    expect(bookRes.body.shipment.reference).toBe('MC-E2E-001');

    // Transition locked for trip execution phase
    currentStatus = 'LOCKED';
    statusHistory.push({ status: 'LOCKED', at: new Date(), note: 'Locked after cutoff' });

    // Step 2: Driver QR pickup verification
    vi.spyOn(User, 'findById').mockReturnValueOnce({
      select: vi.fn().mockResolvedValue({ _id: driverId, role: 'DRIVER', isActive: true }),
    } as never);
    vi.spyOn(Trip, 'findOne').mockResolvedValueOnce({
      _id: tripId,
      driverId,
      shipmentIds: [shipmentId],
    } as never);
    vi.spyOn(Shipment, 'findOne').mockResolvedValueOnce(shipmentState as never);
    vi.spyOn(TripEvent, 'create').mockResolvedValueOnce({ _id: new Types.ObjectId() } as never);
    vi.spyOn(NotificationLog, 'findOne').mockResolvedValueOnce(null);
    vi.spyOn(NotificationLog, 'create').mockResolvedValueOnce({} as never);

    const scanRes = await request(app)
      .post(`/api/v1/driver/trips/${tripId}/scan-qr`)
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ qrToken });

    expect(scanRes.status).toBe(200);
    expect(currentStatus).toBe('PICKED_UP');

    // Step 3: Driver moves shipment IN_TRANSIT -> OTP -> DELIVERED
    currentStatus = 'IN_TRANSIT';
    statusHistory.push({ status: 'IN_TRANSIT', at: new Date(), note: 'Departed hub' });

    let storedOtpProof: Record<string, unknown> | null = null;
    const saveProof = vi.fn().mockResolvedValue(undefined);

    vi.spyOn(User, 'findById').mockReturnValueOnce({
      select: vi.fn().mockResolvedValue({ _id: driverId, role: 'DRIVER', isActive: true }),
    } as never);
    vi.spyOn(Trip, 'findOne').mockResolvedValueOnce({
      _id: tripId,
      driverId,
      shipmentIds: [shipmentId],
    } as never);
    vi.spyOn(Shipment, 'findOne').mockResolvedValueOnce(shipmentState as never);
    vi.spyOn(DeliveryProof, 'findOneAndUpdate').mockImplementation((async (
      _filter: unknown,
      update: { $set?: Record<string, unknown> }
    ) => {
      storedOtpProof = {
        _id: new Types.ObjectId(),
        ...(update.$set ?? {}),
        save: saveProof,
      };
      return storedOtpProof;
    }) as never);

    const otpGenRes = await request(app)
      .post(`/api/v1/driver/trips/${tripId}/shipments/${shipmentId}/otp`)
      .set('Authorization', `Bearer ${driverToken}`)
      .send({});

    expect(otpGenRes.status).toBe(200);
    const demoOtp = otpGenRes.body.demoOtp as string;
    expect(demoOtp).toMatch(/^\d{6}$/);

    vi.spyOn(User, 'findById').mockReturnValueOnce({
      select: vi.fn().mockResolvedValue({ _id: driverId, role: 'DRIVER', isActive: true }),
    } as never);
    vi.spyOn(Trip, 'findOne').mockResolvedValueOnce({
      _id: tripId,
      driverId,
      shipmentIds: [shipmentId],
    } as never);
    vi.spyOn(Shipment, 'findOne').mockResolvedValueOnce(shipmentState as never);
    vi.spyOn(DeliveryProof, 'findOne').mockReturnValueOnce({
      select: vi.fn().mockResolvedValue(storedOtpProof),
    } as never);
    vi.spyOn(TripEvent, 'create').mockResolvedValueOnce({ _id: new Types.ObjectId() } as never);
    vi.spyOn(NotificationLog, 'findOne').mockResolvedValueOnce(null);
    vi.spyOn(NotificationLog, 'create').mockResolvedValueOnce({} as never);

    const deliverRes = await request(app)
      .post(`/api/v1/driver/trips/${tripId}/shipments/${shipmentId}/deliver`)
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ confirmationMode: 'OTP', otp: demoOtp });

    expect(deliverRes.status).toBe(200);
    expect(saveProof).toHaveBeenCalled();
    expect(currentStatus).toBe('DELIVERED');

    // Step 4: Public recipient tracking page API reflects DELIVERED + POD without leaking private fields
    vi.spyOn(Shipment, 'findOne').mockReturnValueOnce({
      populate: vi.fn().mockReturnValue({
        populate: vi.fn().mockReturnValue({
          lean: vi.fn().mockResolvedValue({
            _id: shipmentId,
            reference: 'MC-E2E-001',
            status: currentStatus,
            pickupStopCode: 'VAD',
            deliveryStopCode: 'ANA',
            deliveryAddress: { villageOrTown: 'Anand', district: 'Anand' },
            cargo: { category: 'STANDARD_BOX', quantity: 2, declaredContents: 'Electrical parts' },
            corridorId: { code: 'GJ-VAD-AMD-01', name: 'Vadodara - Ahmedabad' },
            slotId: {
              label: 'Morning Express Pool',
              estimatedArrivalStartAt: new Date(),
              estimatedArrivalEndAt: new Date(Date.now() + 3600_000),
            },
            statusHistory,
          }),
        }),
      }),
    } as never);
    vi.spyOn(DeliveryProof, 'findOne').mockReturnValueOnce({
      lean: vi.fn().mockResolvedValue({
        verifiedAt: new Date(),
        confirmationMode: 'OTP',
      }),
    } as never);

    const trackRes = await request(app).get(`/api/v1/track/${trackingToken}`);
    expect(trackRes.status).toBe(200);
    expect(trackRes.body.tracking.status).toBe('DELIVERED');
    expect(trackRes.body.tracking.deliveryProof.confirmationMode).toBe('OTP');
    expect(trackRes.body.tracking.pricingSnapshot).toBeUndefined();
    expect(trackRes.body.tracking.recipientPhone).toBeUndefined();
    expect(Payment.modelName).toBe('Payment');
  });
});
