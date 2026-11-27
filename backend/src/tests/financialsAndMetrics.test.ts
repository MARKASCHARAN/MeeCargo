import { Types } from 'mongoose';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { BusinessProfile } from '../models/BusinessProfile.js';
import { PickupCollection } from '../models/PickupCollection.js';
import { Pool } from '../models/Pool.js';
import { Shipment } from '../models/Shipment.js';
import { Trip } from '../models/Trip.js';
import { User } from '../models/User.js';
import { signAccessToken } from '../services/authService.js';
import { getOperationalAndShipperMetrics } from '../services/metricsService.js';
import {
  computeRemainingPickupBalancePaise,
  recordPickupBalanceCollection,
} from '../services/pickupCollectionService.js';
import { computeTripLedgerBreakdown } from '../services/tripEconomicsService.js';

describe('Stage 8 Pickup Collections, Trip Economics Ledger, History & Metrics (MC-033 to MC-036)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('computes pickup balance accurately and deduplicates duplicate collection requests', async () => {
    expect(
      computeRemainingPickupBalancePaise({
        lockedPricePaise: 48000,
        tokenPaidPaise: 9000,
        adjustmentsPaise: 1000,
      })
    ).toBe(38000);

    const shipmentId = new Types.ObjectId();
    vi.spyOn(PickupCollection, 'findOne').mockResolvedValueOnce({
      _id: new Types.ObjectId(),
      providerRef: 'SIM-BAL-ABC12',
      collectionState: 'COLLECTED_BY_DRIVER',
      settlementState: 'PENDING_SETTLEMENT',
      isSimulated: true,
    } as never);

    const dup = await recordPickupBalanceCollection({
      tripId: String(new Types.ObjectId()),
      shipmentId: String(shipmentId),
      driverUserId: String(new Types.ObjectId()),
      paymentMethod: 'SIMULATED_UPI',
      idempotencyKey: 'col-dup-1',
    });

    expect(dup.deduplicated).toBe(true);
    expect(dup.collection.collectionState).toBe('COLLECTED_BY_DRIVER');
    expect(dup.collection.settlementState).toBe('PENDING_SETTLEMENT');
  });

  it('computes trip economics ledger with Min Guarantee, status/source lines, and excludes unconfirmed backhaul', async () => {
    const ledger = computeTripLedgerBreakdown({
      tripId: 't1',
      isDemoIllustrative: true,
      outboundShipments: [
        { finalLockedPricePaise: 420000, isLocked: true },
        { finalLockedPricePaise: 180000, isLocked: true },
      ],
      backhaul: {
        isConfirmedOrMatched: false, // Unconfirmed backhaul MUST be excluded
        revenuePaise: 500000,
        repositioningCostPaise: 50000,
      },
      vehiclePayoutAndMinGuaranteePaise: 320000,
      vehiclePayoutStatus: 'ACTUAL',
      roadDistanceKm: 114.6,
      refundsPaise: 0,
    });

    expect(ledger.outboundRevenuePaise).toBe(600000);
    expect(ledger.confirmedBackhaulRevenuePaise).toBe(0);
    expect(ledger.vehiclePayoutAndMinGuaranteePaise).toBe(320000);
    expect(ledger.lines.every((l) => l.source && (l.status === 'ACTUAL' || l.status === 'ESTIMATED'))).toBe(
      true
    );

    // Block shipper role from internal trip economics ledger endpoint
    const shipperId = new Types.ObjectId();
    const poolId = new Types.ObjectId();
    vi.spyOn(User, 'findById').mockImplementation((() => ({
      select: vi.fn().mockResolvedValue({
        _id: shipperId,
        role: 'SHIPPER',
        isActive: true,
      }),
    })) as never);

    const token = signAccessToken({ _id: shipperId, role: 'SHIPPER' });
    const app = createApp();
    const res = await request(app)
      .get(`/api/v1/pools/${poolId}/ledger`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('calculates shipper savings against ceiling baseline without hardcoded claims and separates weight/volume metrics', async () => {
    const businessId = new Types.ObjectId();

    vi.spyOn(Shipment, 'find').mockImplementation((() => ({
      lean: vi.fn().mockResolvedValue([
        {
          status: 'DELIVERED',
          cargo: { chargeableWeightKg: 100 },
          pricingSnapshot: {
            ceilingPricePaise: 60000,
            finalLockedPricePaise: 48000,
          },
        },
      ]),
    })) as never);

    vi.spyOn(Pool, 'find').mockImplementation((() => ({
      lean: vi.fn().mockResolvedValue([
        {
          reservedWeightKg: 1000,
          capacityWeightKg: 2500, // 40%
          reservedVolumeCbm: 9,
          capacityVolumeCbm: 12, // 75%
        },
      ]),
    })) as never);

    vi.spyOn(Trip, 'find').mockImplementation((() => ({
      populate: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue([
          {
            status: 'COMPLETED',
            routePlan: { totalDistanceMeters: 114600 },
            allocationEconomics: { estimatedVehiclePayoutPaise: 320000 },
            backhaulDecision: { decision: 'EARLY_TURNAROUND' },
            estimatedEndAt: new Date('2026-11-28T13:30:00Z'),
            actualCompletedAt: new Date('2026-11-28T13:00:00Z'),
          },
        ]),
      }),
    })) as never);

    const metrics = await getOperationalAndShipperMetrics({ businessId });
    expect(metrics.shipperScoped.estimatedSavingsPaise).toBe(12000);
    expect(metrics.shipperScoped.estimatedSavingsPct).toBe(20);
    expect(metrics.shipperScoped.finalizedSpendPaise).toBe(48000);
    expect(metrics.shipperScoped.finalizedSavingsPaise).toBe(12000);
    expect(metrics.shipperScoped.finalizedSavingsPct).toBe(20);
    expect(metrics.shipperScoped.projectedSpendPaise).toBe(0);
    expect(metrics.shipperScoped.hasPricedShipments).toBe(true);
    expect(metrics.shipperScoped.hasValidBaselineComparison).toBe(true);
    expect(metrics.shipperScoped.baselineMethodology).toContain('ceiling');
    expect(metrics.platformUtilization.avgVehicleWeightUtilizationPct).toBe(40);
    expect(metrics.platformUtilization.avgVehicleVolumeUtilizationPct).toBe(75);
    expect(metrics.platformUtilization.estimatedCo2ImpactKg).toBeNull(); // Not configured in test env
  });

  it('exports shipper shipment history to CSV cleanly', async () => {
    const shipperId = new Types.ObjectId();
    const businessId = new Types.ObjectId();

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

    const chain = {
      populate: vi.fn().mockReturnThis(),
      sort: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue([
        {
          reference: 'MC-20261128-EXP1',
          externalOrderRef: 'ORD-900',
          status: 'DELIVERED',
          tokenStatus: 'PAID',
          corridorId: { code: 'GJ-VAD-AMD-01' },
          slotId: { slotCode: 'SLOT-AM' },
          pickupStopCode: 'VAD',
          deliveryStopCode: 'ANA',
          recipientName: 'Anand Yarn',
          cargo: { chargeableWeightKg: 50, volumeCbm: 0.4 },
          pricingSnapshot: {
            finalLockedPricePaise: 24000,
            tokenPaidPaise: 4500,
            remainingBalancePaise: 0,
          },
          createdAt: new Date('2026-11-28T06:00:00Z'),
        },
      ]),
    };
    vi.spyOn(Shipment, 'find').mockReturnValue(chain as never);

    const token = signAccessToken({ _id: shipperId, role: 'SHIPPER', businessId });
    const app = createApp();
    const res = await request(app)
      .get('/api/v1/shipments/export/csv')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text).toContain('MC-20261128-EXP1');
    expect(res.text).toContain('240.00');
  });
});
