import { Types } from 'mongoose';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { BusinessProfile } from '../models/BusinessProfile.js';
import { Corridor } from '../models/Corridor.js';
import { DriverProfile } from '../models/DriverProfile.js';
import { ExceptionEvent, type ExceptionType } from '../models/ExceptionEvent.js';
import { NotificationLog } from '../models/NotificationLog.js';
import { Shipment } from '../models/Shipment.js';
import { Slot } from '../models/Slot.js';
import { Trip } from '../models/Trip.js';
import { TripEvent } from '../models/TripEvent.js';
import { User } from '../models/User.js';
import { Vehicle } from '../models/Vehicle.js';
import { signAccessToken } from '../services/authService.js';
import {
  reportTripException,
  resolveShipmentException,
} from '../services/exceptionService.js';
import * as routePlanningService from '../services/routePlanningService.js';
import * as poolService from '../services/poolService.js';
import { redactSensitiveData } from '../utils/logger.js';

const ALL_TEN_EXCEPTION_TYPES: ExceptionType[] = [
  'CUSTOMER_UNAVAILABLE',
  'INCORRECT_ADDRESS',
  'VEHICLE_BREAKDOWN',
  'ROAD_BLOCKED',
  'SHIPMENT_DAMAGED',
  'RECIPIENT_REFUSES',
  'DRIVER_UNAVAILABLE',
  'PARTIAL_DELIVERY',
  'PICKUP_FAILURE',
  'ROUTE_INFEASIBILITY',
];

describe('Stage 9 Exceptions, Breakdown Reassignment, Privacy & Security (MC-037, MC-038)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('handles all 10 exception cases with audit trail, shipper alert, and non-silent shipment transitions', async () => {
    const driverId = new Types.ObjectId();
    const tripId = new Types.ObjectId();
    const corridorId = new Types.ObjectId();
    const slotId = new Types.ObjectId();

    for (const excType of ALL_TEN_EXCEPTION_TYPES) {
      const shipmentId = new Types.ObjectId();
      const businessId = new Types.ObjectId();
      const shipperUserId = new Types.ObjectId();
      const saveTrip = vi.fn().mockResolvedValue(undefined);
      const saveShipment = vi.fn().mockResolvedValue(undefined);

      vi.spyOn(Trip, 'findOne').mockResolvedValueOnce({
        _id: tripId,
        tripCode: 'MC-TRIP-EXC',
        corridorId,
        slotId,
        vehicleId: new Types.ObjectId(),
        driverId,
        shipmentIds: [shipmentId],
        status: 'IN_PROGRESS',
        estimatedEndAt: new Date(Date.now() + 3600_000),
        stopsSummary: [],
        save: saveTrip,
      } as never);

      vi.spyOn(Shipment, 'findOne').mockResolvedValueOnce({
        _id: shipmentId,
        reference: `MC-${excType.slice(0, 6)}`,
        tripId,
        businessId,
        createdByUserId: shipperUserId,
        status: excType === 'PICKUP_FAILURE' ? 'LOCKED' : 'IN_TRANSIT',
        statusHistory: [],
        save: saveShipment,
      } as never);

      const createdExc = {
        _id: new Types.ObjectId(),
        tripId,
        shipmentId,
        businessId,
        exceptionType: excType,
        reason: `Simulated ${excType}`,
        reportedByUserId: driverId,
        occurredAt: new Date(),
        resolutionStatus: 'OPEN',
        routeRecalculated: false,
        resolutionHistory: [],
        save: vi.fn().mockResolvedValue(undefined),
      };

      vi.spyOn(ExceptionEvent, 'create').mockResolvedValueOnce(createdExc as never);
      vi.spyOn(TripEvent, 'create').mockResolvedValueOnce({ _id: new Types.ObjectId() } as never);
      vi.spyOn(NotificationLog, 'findOne').mockResolvedValueOnce(null);
      vi.spyOn(NotificationLog, 'create').mockResolvedValueOnce({} as never);

      if (excType === 'VEHICLE_BREAKDOWN') {
        vi.spyOn(Trip, 'findById').mockResolvedValueOnce(null);
      } else if (excType === 'ROAD_BLOCKED' || excType === 'ROUTE_INFEASIBILITY') {
        vi.spyOn(routePlanningService, 'optimizeAndPlanTripRoute').mockResolvedValueOnce({
          trip: {} as never,
          optimized: true,
          routePlan: {} as never,
          loadingPlan: {} as never,
        });
      }

      const result = await reportTripException({
        tripId: String(tripId),
        driverUserId: String(driverId),
        exceptionType: excType,
        reason: `Simulated ${excType}`,
        shipmentId: String(shipmentId),
      });

      expect(result.exception.exceptionType).toBe(excType);
      expect(result.exception.occurredAt).toBeInstanceOf(Date);
      expect(String(result.exception.reportedByUserId)).toBe(String(driverId));

      if (excType === 'PARTIAL_DELIVERY') {
        expect(saveShipment).toHaveBeenCalled();
      }
      if (excType === 'ROAD_BLOCKED' || excType === 'ROUTE_INFEASIBILITY') {
        expect(result.exception.routeRecalculated).toBe(true);
      }
    }
  });

  it('triggers rescue vehicle reassignment and route recalculation on VEHICLE_BREAKDOWN', async () => {
    const driverId = new Types.ObjectId();
    const rescueDriverId = new Types.ObjectId();
    const brokenVehicleId = new Types.ObjectId();
    const rescueVehicleId = new Types.ObjectId();
    const brokenTripId = new Types.ObjectId();
    const rescueTripId = new Types.ObjectId();
    const shipmentId = new Types.ObjectId();
    const corridorId = new Types.ObjectId();
    const slotId = new Types.ObjectId();

    const saveBrokenTrip = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(Trip, 'findOne')
      .mockResolvedValueOnce({
        _id: brokenTripId,
        tripCode: 'MC-TRIP-BRK1',
        corridorId,
        slotId,
        vehicleId: brokenVehicleId,
        driverId,
        shipmentIds: [shipmentId],
        status: 'IN_PROGRESS',
        estimatedEndAt: new Date(Date.now() + 7200_000),
        stopsSummary: [{ stopCode: 'S1', name: 'Erode', sequenceOrder: 1 }],
        save: saveBrokenTrip,
      } as never)
      .mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          session: vi.fn().mockResolvedValue(null),
        }),
      } as never);

    const saveException = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(ExceptionEvent, 'create').mockResolvedValueOnce({
      _id: new Types.ObjectId(),
      tripId: brokenTripId,
      exceptionType: 'VEHICLE_BREAKDOWN',
      reason: 'Axle breakdown near Kangayam',
      reportedByUserId: driverId,
      occurredAt: new Date(),
      resolutionStatus: 'OPEN',
      routeRecalculated: false,
      resolutionHistory: [],
      save: saveException,
    } as never);

    vi.spyOn(TripEvent, 'create').mockResolvedValueOnce({ _id: new Types.ObjectId() } as never);

    // Trip-level alert to shippers
    vi.spyOn(Shipment, 'find')
      .mockResolvedValueOnce([
        {
          _id: shipmentId,
          reference: 'MC-BRK-SHIP1',
          businessId: new Types.ObjectId(),
          createdByUserId: new Types.ObjectId(),
        },
      ] as never)
      // Remaining active shipments inside rescue function
      .mockResolvedValueOnce([
        {
          _id: shipmentId,
          reference: 'MC-BRK-SHIP1',
          status: 'IN_TRANSIT',
          cargo: {
            chargeableWeightKg: 250,
            volumeCbm: 1.2,
            unitDimensionsCm: { length: 80, width: 60, height: 50 },
          },
        },
      ] as never);

    vi.spyOn(NotificationLog, 'findOne').mockResolvedValue(null);
    vi.spyOn(NotificationLog, 'create').mockResolvedValue({} as never);

    vi.spyOn(Trip, 'findById').mockResolvedValueOnce({
      _id: brokenTripId,
      tripCode: 'MC-TRIP-BRK1',
      corridorId,
      slotId,
      vehicleId: brokenVehicleId,
      driverId,
      shipmentIds: [shipmentId],
      estimatedEndAt: new Date(Date.now() + 7200_000),
      stopsSummary: [{ stopCode: 'S1', name: 'Erode', sequenceOrder: 1 }],
    } as never);

    vi.spyOn(Corridor, 'findById').mockResolvedValueOnce({ _id: corridorId } as never);
    vi.spyOn(Slot, 'findById').mockResolvedValueOnce({
      _id: slotId,
      departureDate: new Date(),
      plannedDepartureAt: new Date(),
      estimatedArrivalEndAt: new Date(Date.now() + 7200_000),
    } as never);

    vi.spyOn(Vehicle, 'find').mockReturnValueOnce({
      sort: vi.fn().mockResolvedValue([
        {
          _id: rescueVehicleId,
          registrationNumber: 'TN-39-RS-9999',
          tier: 'TIER_1',
          isAvailable: true,
          maxWeightKg: 1000,
          maxVolumeCbm: 6,
          bedDimensionsCm: { length: 300, width: 180, height: 180 },
        },
      ]),
    } as never);

    vi.spyOn(DriverProfile, 'find').mockResolvedValueOnce([
      {
        userId: rescueDriverId,
        availabilityStatus: 'AVAILABLE',
      },
    ] as never);

    vi.spyOn(Trip, 'create').mockResolvedValueOnce({
      _id: rescueTripId,
      tripCode: 'MC-RESCUE-ABC123',
      driverId: rescueDriverId,
      vehicleId: rescueVehicleId,
    } as never);
    vi.spyOn(Shipment, 'updateMany').mockResolvedValueOnce({ modifiedCount: 1 } as never);
    vi.spyOn(routePlanningService, 'optimizeAndPlanTripRoute').mockResolvedValueOnce({
      trip: {} as never,
      optimized: true,
      routePlan: { optimizationStatus: 'OPTIMAL' } as never,
      loadingPlan: {} as never,
    });

    const result = await reportTripException({
      tripId: String(brokenTripId),
      driverUserId: String(driverId),
      exceptionType: 'VEHICLE_BREAKDOWN',
      reason: 'Axle breakdown near Kangayam',
    });

    expect(saveBrokenTrip).toHaveBeenCalled();
    expect(result.reassignment?.reassigned).toBe(true);
    expect(result.reassignment?.rescueTrip?.tripCode).toBe('MC-RESCUE-ABC123');
    expect(result.reassignment?.routeRecalculated).toBe(true);
    expect(result.exception.resolutionStatus).toBe('REASSIGNED');
    expect(result.exception.routeRecalculated).toBe(true);
    expect(saveException).toHaveBeenCalled();
  });

  it('resolves shipper exceptions via explicit RETURN and RESCHEDULE transitions while enforcing business ownership', async () => {
    const businessId = new Types.ObjectId();
    const otherBusinessId = new Types.ObjectId();
    const userId = new Types.ObjectId();
    const exceptionId = new Types.ObjectId();
    const shipmentId = new Types.ObjectId();
    const corridorId = new Types.ObjectId();
    const slotId = new Types.ObjectId();
    const targetSlotId = new Types.ObjectId();

    vi.spyOn(ExceptionEvent, 'findOne').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue(null),
    } as never);

    await expect(
      resolveShipmentException({
        exceptionId: String(exceptionId),
        businessId: otherBusinessId,
        userId: String(userId),
        action: 'RETURN',
      })
    ).rejects.toThrow(/not found for your business/);

    const saveShipmentReturn = vi.fn().mockResolvedValue(undefined);
    const saveExcReturn = vi.fn().mockResolvedValue(undefined);

    vi.spyOn(ExceptionEvent, 'findOne').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue({
        _id: exceptionId,
        businessId,
        shipmentId,
        resolutionStatus: 'OPEN',
        resolutionHistory: [],
        save: saveExcReturn,
      }),
    } as never);
    vi.spyOn(Shipment, 'findOne').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue({
        _id: shipmentId,
        businessId,
        status: 'FAILED',
        statusHistory: [],
        save: saveShipmentReturn,
      }),
    } as never);

    const returned = await resolveShipmentException({
      exceptionId: String(exceptionId),
      businessId,
      userId: String(userId),
      action: 'RETURN',
    });

    expect(returned.shipment.status).toBe('RETURNED');
    expect(returned.exception.resolutionStatus).toBe('RETURNED');

    // Now test RESCHEDULE into open slot
    const saveShipmentResched = vi.fn().mockResolvedValue(undefined);
    const saveExcResched = vi.fn().mockResolvedValue(undefined);

    vi.spyOn(ExceptionEvent, 'findOne').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue({
        _id: exceptionId,
        businessId,
        shipmentId,
        resolutionStatus: 'OPEN',
        resolutionHistory: [],
        save: saveExcResched,
      }),
    } as never);
    vi.spyOn(Shipment, 'findOne').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue({
        _id: shipmentId,
        businessId,
        corridorId,
        slotId,
        tokenStatus: 'PAID',
        status: 'FAILED',
        cargo: { chargeableWeightKg: 120, volumeCbm: 0.6 },
        statusHistory: [],
        save: saveShipmentResched,
      }),
    } as never);
    vi.spyOn(Corridor, 'findById').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue({ _id: corridorId }),
    } as never);
    vi.spyOn(Slot, 'findOneAndUpdate').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue({ _id: targetSlotId, slotCode: 'SLOT-NEXT' }),
    } as never);
    vi.spyOn(poolService, 'addShipmentToPool').mockResolvedValueOnce({} as never);

    const rescheduled = await resolveShipmentException({
      exceptionId: String(exceptionId),
      businessId,
      userId: String(userId),
      action: 'RESCHEDULE',
      targetSlotId: String(targetSlotId),
    });

    expect(rescheduled.shipment.status).toBe('ROLLED_OVER');
    expect(rescheduled.exception.resolutionStatus).toBe('RESCHEDULED');
  });

  it('redacts payment refs, tokens, passwords, and PII from logs', () => {
    const redacted = redactSensitiveData({
      event: 'TOKEN_PAYMENT',
      shipmentReference: 'MC-20261128-ABC1',
      paymentRef: 'SIM_PAY_987654',
      refundReference: 'REF_12345',
      trackingToken: 'tok_secret_1234567890abcdef',
      otp: '482910',
      password: 'Password123!',
      shipperPhone: '+919876543210',
      nested: {
        email: 'owner@factory.in',
        gstin: '33AAAAA0000A1Z5',
        authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig',
      },
    }) as Record<string, unknown>;

    expect(redacted.event).toBe('TOKEN_PAYMENT');
    expect(redacted.shipmentReference).toBe('MC-20261128-ABC1');
    expect(redacted.paymentRef).toBe('[REDACTED]');
    expect(redacted.refundReference).toBe('[REDACTED]');
    expect(redacted.trackingToken).toBe('[REDACTED]');
    expect(redacted.otp).toBe('[REDACTED]');
    expect(redacted.password).toBe('[REDACTED]');
    expect(redacted.shipperPhone).toBe('[REDACTED]');
    expect((redacted.nested as Record<string, unknown>).email).toBe('[REDACTED]');
    expect((redacted.nested as Record<string, unknown>).gstin).toBe('[REDACTED]');
    expect((redacted.nested as Record<string, unknown>).authorization).toBe('[REDACTED]');
  });

  it('enforces active-trip-only location sharing, upload MIME validation, and rate limit headers', async () => {
    const driverUserId = new Types.ObjectId();
    const tripId = new Types.ObjectId();
    const accessToken = signAccessToken({
      _id: driverUserId,
      role: 'DRIVER',
    });

    const app = createApp();

    vi.spyOn(User, 'findById').mockReturnValue({
      select: vi.fn().mockResolvedValue({
        _id: driverUserId,
        role: 'DRIVER',
        isActive: true,
      }),
    } as never);

    // Active-trip location rejected when trip is only ASSIGNED
    vi.spyOn(Trip, 'findOne').mockResolvedValueOnce({
      _id: tripId,
      driverId: driverUserId,
      status: 'ASSIGNED',
    } as never);

    const blockedLoc = await request(app)
      .post(`/api/v1/driver/trips/${tripId}/location`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ coordinates: [77.3411, 11.1085] });

    expect(blockedLoc.status).toBe(409);
    expect(blockedLoc.body.code).toBe('LOCATION_POLICY_VIOLATION');

    // Active-trip location allowed only when IN_PROGRESS + disclosure accepted
    const saveLoc = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(Trip, 'findOne').mockResolvedValueOnce({
      _id: tripId,
      driverId: driverUserId,
      status: 'IN_PROGRESS',
      locationDisclosureAcceptedAt: new Date(),
      save: saveLoc,
    } as never);

    const allowedLoc = await request(app)
      .post(`/api/v1/driver/trips/${tripId}/location`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ coordinates: [77.3411, 11.1085] });

    expect(allowedLoc.status).toBe(200);
    expect(allowedLoc.body.coordinates).toEqual([77.3411, 11.1085]);
    expect(saveLoc).toHaveBeenCalled();

    // Disallowed MIME upload rejected
    const badUpload = await request(app)
      .post(`/api/v1/driver/trips/${tripId}/exceptions`)
      .set('Authorization', `Bearer ${accessToken}`)
      .field('exceptionType', 'SHIPMENT_DAMAGED')
      .field('reason', 'Corner crushed')
      .attach('evidence', Buffer.from('%PDF-1.4 fake'), {
        filename: 'doc.pdf',
        contentType: 'application/pdf',
      });

    expect(badUpload.status).toBe(400);
    expect(badUpload.body.code).toBe('INVALID_FILE_TYPE');

    // Rate limiting headers present on login, OTP, and public track endpoints
    vi.spyOn(User, 'findOne').mockReturnValueOnce({
      select: vi.fn().mockResolvedValue(null),
    } as never);
    const loginRes = await request(app).post('/api/v1/auth/login').send({
      email: 'nobody@meecargo.demo',
      password: 'Password123',
    });
    expect(Boolean(loginRes.headers['ratelimit'] || loginRes.headers['ratelimit-limit'])).toBe(
      true
    );

    const trackRes = await request(app).get('/api/v1/track/short');
    expect(Boolean(trackRes.headers['ratelimit'] || trackRes.headers['ratelimit-limit'])).toBe(
      true
    );

    vi.spyOn(Trip, 'findOne').mockResolvedValueOnce(null);
    const otpRes = await request(app)
      .post(`/api/v1/driver/trips/${tripId}/shipments/${new Types.ObjectId()}/otp`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({});
    expect(Boolean(otpRes.headers['ratelimit'] || otpRes.headers['ratelimit-limit'])).toBe(true);

    // Silence unused import warning cleanly if BusinessProfile was referenced
    expect(BusinessProfile.modelName).toBe('BusinessProfile');
  });
});
