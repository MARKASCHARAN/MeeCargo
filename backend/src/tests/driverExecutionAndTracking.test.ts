import { Types } from 'mongoose';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { DeliveryProof } from '../models/DeliveryProof.js';
import { NotificationLog } from '../models/NotificationLog.js';
import { Shipment } from '../models/Shipment.js';
import { Trip } from '../models/Trip.js';
import { TripEvent } from '../models/TripEvent.js';
import { sendLifecycleNotification } from '../services/notificationService.js';
import { validatePodImageFile } from '../services/podStorageService.js';
import {
  isValidTripTransition,
  scanShipmentQrForPickup,
  syncOfflineDriverEvents,
  verifyDeliveryAndComplete,
} from '../services/tripExecutionService.js';

describe('Stage 7 Driver Execution, QR, POD, Public Tracking & Offline Sync (MC-026 to MC-032)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('validates trip state transitions and executes idempotent QR pickup verification', async () => {
    expect(isValidTripTransition('ASSIGNED', 'IN_PROGRESS')).toBe(true);
    expect(isValidTripTransition('IN_PROGRESS', 'PAUSED')).toBe(true);
    expect(isValidTripTransition('COMPLETED', 'IN_PROGRESS')).toBe(false);

    const tripId = new Types.ObjectId();
    const driverId = new Types.ObjectId();
    const wrongShipmentId = new Types.ObjectId();
    const rightShipmentId = new Types.ObjectId();

    vi.spyOn(Trip, 'findOne').mockResolvedValue({
      _id: tripId,
      tripCode: 'MC-TRIP-001',
      driverId,
      shipmentIds: [rightShipmentId],
    } as never);

    // Wrong-trip QR scan is rejected
    vi.spyOn(Shipment, 'findOne').mockResolvedValueOnce({
      _id: wrongShipmentId,
      reference: 'MC-OTHER-999',
      tripId: new Types.ObjectId(),
      status: 'LOCKED',
    } as never);

    await expect(
      scanShipmentQrForPickup({
        tripId: String(tripId),
        driverUserId: String(driverId),
        qrToken: 'wrong-trip-qr-token-1234',
      })
    ).rejects.toThrow(/Wrong trip/);

    // Right-trip QR scan succeeds & triggers pickup balance request
    const saveShipment = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(Shipment, 'findOne').mockResolvedValueOnce({
      _id: rightShipmentId,
      reference: 'MC-20261127-OK1',
      tripId,
      createdByUserId: new Types.ObjectId(),
      recipientPhone: '+919800000111',
      trackingToken: 'a'.repeat(48),
      status: 'LOCKED',
      pricingSnapshot: { remainingBalancePaise: 42000 },
      statusHistory: [],
      save: saveShipment,
    } as never);

    vi.spyOn(TripEvent, 'create').mockResolvedValue({ _id: new Types.ObjectId() } as never);
    vi.spyOn(NotificationLog, 'findOne').mockResolvedValue(null);
    vi.spyOn(NotificationLog, 'create').mockResolvedValue({} as never);

    const pickupRes = await scanShipmentQrForPickup({
      tripId: String(tripId),
      driverUserId: String(driverId),
      qrToken: 'valid-qr-token-1234',
    });

    expect(pickupRes.deduplicated).toBe(false);
    expect(pickupRes.balanceCollectionTriggered).toBe(true);
    expect(pickupRes.pickupBalanceDuePaise).toBe(42000);

    // Duplicate scan is idempotent
    vi.spyOn(Shipment, 'findOne').mockResolvedValueOnce({
      _id: rightShipmentId,
      reference: 'MC-20261127-OK1',
      tripId,
      status: 'PICKED_UP',
      pricingSnapshot: { remainingBalancePaise: 42000 },
      pickupBalanceRequestedAt: new Date(),
    } as never);
    vi.spyOn(TripEvent, 'findOne').mockResolvedValueOnce({ _id: new Types.ObjectId() } as never);

    const dupScan = await scanShipmentQrForPickup({
      tripId: String(tripId),
      driverUserId: String(driverId),
      qrToken: 'valid-qr-token-1234',
    });
    expect(dupScan.deduplicated).toBe(true);
  });

  it('prevents failed OTP verification from marking shipment delivered and validates POD upload MIME/size', async () => {
    const tripId = new Types.ObjectId();
    const driverId = new Types.ObjectId();
    const shipmentId = new Types.ObjectId();

    vi.spyOn(Trip, 'findOne').mockResolvedValue({
      _id: tripId,
      driverId,
      shipmentIds: [shipmentId],
    } as never);
    const saveShipment = vi.fn();
    vi.spyOn(Shipment, 'findOne').mockResolvedValue({
      _id: shipmentId,
      tripId,
      status: 'AT_DESTINATION',
      save: saveShipment,
    } as never);

    const saveProof = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(DeliveryProof, 'findOne').mockImplementation((() => ({
      select: vi.fn().mockResolvedValue({
        otpHash: 'expected-hash-mismatch',
        otpExpiresAt: new Date(Date.now() + 60_000),
        attemptCount: 0,
        maxAttempts: 5,
        save: saveProof,
      }),
    })) as never);

    await expect(
      verifyDeliveryAndComplete({
        tripId: String(tripId),
        shipmentId: String(shipmentId),
        driverUserId: String(driverId),
        confirmationMode: 'OTP',
        otp: '000000',
      })
    ).rejects.toThrow(/Invalid delivery OTP/);
    expect(saveShipment).not.toHaveBeenCalled();

    expect(() =>
      validatePodImageFile({ mimetype: 'application/pdf', size: 1000 })
    ).toThrow(/Unsupported POD image type/);
    expect(() =>
      validatePodImageFile({ mimetype: 'image/jpeg', size: 10 * 1024 * 1024 })
    ).toThrow(/size/);
  });

  it('returns strictly recipient-safe public tracking fields and rejects revoked tokens', async () => {
    const app = createApp();

    // Short / guessable token rejected
    const badRes = await request(app).get('/api/v1/track/12345');
    expect(badRes.status).toBe(404);

    // Revoked token returns 410
    const token = 'b'.repeat(48);
    const leanChain = (val: unknown) => ({
      populate: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue(val),
    });
    vi.spyOn(Shipment, 'findOne').mockReturnValueOnce(
      leanChain({
        _id: new Types.ObjectId(),
        trackingToken: token,
        trackingTokenRevokedAt: new Date(),
      }) as never
    );

    const revokedRes = await request(app).get(`/api/v1/track/${token}`);
    expect(revokedRes.status).toBe(410);

    // Valid token returns minimal safe fields (no driver phone, no pricing, no GPS)
    vi.spyOn(Shipment, 'findOne').mockReturnValueOnce(
      leanChain({
        _id: new Types.ObjectId(),
        reference: 'MC-20261127-SAFE',
        status: 'IN_TRANSIT',
        pickupStopCode: 'VAD',
        deliveryStopCode: 'ANA',
        deliveryAddress: { villageOrTown: 'Anand', district: 'Anand' },
        cargo: {
          category: 'TEXTILE_ROLL',
          quantity: 4,
          declaredContents: 'Cotton rolls',
        },
        corridorId: { code: 'GJ-VAD-AMD-01', name: 'Vadodara - Ahmedabad' },
        slotId: {
          label: 'Morning Express',
          estimatedArrivalStartAt: new Date().toISOString(),
          estimatedArrivalEndAt: new Date().toISOString(),
        },
        statusHistory: [{ status: 'IN_TRANSIT', at: new Date().toISOString(), note: 'En route' }],
        trackingToken: token,
      }) as never
    );
    vi.spyOn(DeliveryProof, 'findOne').mockImplementation((() => ({
      lean: vi.fn().mockResolvedValue(null),
    })) as never);

    const okRes = await request(app).get(`/api/v1/track/${token}`);
    expect(okRes.status).toBe(200);
    expect(okRes.body.tracking.reference).toBe('MC-20261127-SAFE');
    expect(okRes.body.tracking.driverPhone).toBeUndefined();
    expect(okRes.body.tracking.pricingSnapshot).toBeUndefined();
    expect(okRes.body.tracking.lastKnownLocation).toBeUndefined();
  });

  it('deduplicates notifications without throwing on errors and surfaces offline sync conflicts', async () => {
    vi.spyOn(NotificationLog, 'findOne').mockResolvedValueOnce({ _id: new Types.ObjectId() } as never);
    const dupNotif = await sendLifecycleNotification({
      eventType: 'BOOKING_CONFIRMED',
      dedupeKey: 'BOOKING_CONFIRMED:1',
      vars: { reference: 'MC-1' },
    });
    expect(dupNotif.deduplicated).toBe(true);

    // Notification failure never throws
    vi.spyOn(NotificationLog, 'findOne').mockRejectedValueOnce(new Error('DB down'));
    const safeFail = await sendLifecycleNotification({
      eventType: 'BOOKING_CONFIRMED',
      dedupeKey: 'BOOKING_CONFIRMED:2',
      vars: { reference: 'MC-2' },
    });
    expect(safeFail.dispatched).toBe(false);

    // Offline sync surfaces conflicts (e.g. trying to sync unsupported OTP offline or invalid state)
    vi.spyOn(TripEvent, 'findOne').mockResolvedValue(null);
    vi.spyOn(Trip, 'findOne').mockResolvedValue({
      _id: new Types.ObjectId(),
      status: 'COMPLETED',
    } as never);

    const syncRes = await syncOfflineDriverEvents({
      tripId: String(new Types.ObjectId()),
      driverUserId: String(new Types.ObjectId()),
      events: [
        {
          idempotencyKey: 'off-1',
          kind: 'TRIP_STATUS',
          targetStatus: 'PAUSED',
          reason: 'Traffic',
          occurredAt: new Date().toISOString(),
        },
        {
          idempotencyKey: 'off-2',
          kind: 'SHIPMENT_STATUS',
          targetStatus: 'DELIVERED',
          shipmentId: String(new Types.ObjectId()),
          occurredAt: new Date().toISOString(),
        },
      ],
    });

    expect(syncRes.results[0].status).toBe('CONFLICT');
    expect(syncRes.results[1].status).toBe('CONFLICT');
  });
});
