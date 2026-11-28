import { Types } from 'mongoose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BackhaulRequest } from '../models/BackhaulRequest.js';
import { RouteMatrixCache } from '../models/RouteMatrixCache.js';
import { Trip } from '../models/Trip.js';
import { Vehicle } from '../models/Vehicle.js';
import { evaluateBackhaulForTrip } from '../services/backhaulService.js';
import { getRoadDistanceMatrix } from '../services/distanceMatrixService.js';
import {
  appendLoadingOverride,
  buildLifoLoadingPlan,
  LOADING_PLANNING_AID_DISCLAIMER,
} from '../services/loadingPlanService.js';
import { callRouteOptimizer } from '../services/optimizerClient.js';

describe('Stage 6 Routing, OR-Tools Client, LIFO Loading & Backhaul (MC-021 to MC-025)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses deterministic road-distance fixtures, reuses cache, and fails visibly on missing stops', async () => {
    vi.spyOn(RouteMatrixCache, 'findOne').mockImplementation((() => ({
      lean: vi.fn().mockResolvedValue(null),
    })) as never);
    vi.spyOn(RouteMatrixCache, 'findOneAndUpdate').mockResolvedValue({} as never);

    const matrix = await getRoadDistanceMatrix([
      { code: 'VAD', coordinates: [73.1812, 22.3072] },
      { code: 'ANA', coordinates: [72.9289, 22.5645] },
      { code: 'AMD', coordinates: [72.5714, 23.0225] },
    ]);

    expect(matrix.provider).toBe('FIXTURE');
    expect(matrix.fromCache).toBe(false);
    expect(matrix.distanceMatrixMeters[0][2]).toBe(114600);

    // Missing stop fails visibly rather than inventing straight-line distance
    await expect(
      getRoadDistanceMatrix([
        { code: 'VAD', coordinates: [73.1812, 22.3072] },
        { code: 'UNKNOWN', coordinates: [72.0, 22.0] },
      ])
    ).rejects.toThrow(/Road matrix fixture missing/);

    // Cached matrix reuse
    vi.spyOn(RouteMatrixCache, 'findOne').mockImplementation((() => ({
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
    })) as never);

    const cached = await getRoadDistanceMatrix([
      { code: 'VAD', coordinates: [73.1812, 22.3072] },
      { code: 'ANA', coordinates: [72.9289, 22.5645] },
    ]);
    expect(cached.fromCache).toBe(true);
  });

  it('handles unreachable OR-Tools optimizer service without fabricating an optimized route', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const res = await callRouteOptimizer({
      vehicles: [{ id: 'V1', max_weight_kg: 2500, max_volume_cbm: 12 }],
      stops: [
        {
          stop_index: 0,
          stop_code: 'VAD',
          name: 'Vadodara',
          demand_weight_kg: 0,
          demand_volume_cbm: 0,
          time_window_min: null,
          shipment_ids: [],
        },
        {
          stop_index: 1,
          stop_code: 'ANA',
          name: 'Anand',
          demand_weight_kg: 100,
          demand_volume_cbm: 0.5,
          time_window_min: null,
          shipment_ids: ['S1'],
        },
      ],
      distance_matrix_meters: [
        [0, 42800],
        [42800, 0],
      ],
      duration_matrix_seconds: [
        [0, 3120],
        [3120, 0],
      ],
      open_ended_outbound: true,
    });

    expect(res.status).toBe('OPTIMIZER_UNAVAILABLE');
    expect(res.ordered_stops).toEqual([]);
  });

  it('builds reverse-stop LIFO loading sequence, zone colors, 2D placement, overflow detection, and overrides', () => {
    const sAnaId = new Types.ObjectId();
    const sNadId = new Types.ObjectId();
    const sAmdId = new Types.ObjectId();
    const sOverflowId = new Types.ObjectId();

    const plan = buildLifoLoadingPlan({
      orderedStops: [
        { sequence: 0, stopCode: 'VAD' },
        { sequence: 1, stopCode: 'ANA' },
        { sequence: 2, stopCode: 'NAD' },
        { sequence: 3, stopCode: 'AMD' },
      ],
      shipments: [
        {
          _id: sAnaId,
          reference: 'MC-ANA-1',
          deliveryStopCode: 'ANA',
          cargo: {
            quantity: 1,
            unitDimensionsCm: { length: 100, width: 80, height: 60 },
            chargeableWeightKg: 50,
            stackable: true,
          },
        } as never,
        {
          _id: sNadId,
          reference: 'MC-NAD-2',
          deliveryStopCode: 'NAD',
          cargo: {
            quantity: 1,
            unitDimensionsCm: { length: 100, width: 80, height: 60 },
            chargeableWeightKg: 70,
            stackable: true,
          },
        } as never,
        {
          _id: sAmdId,
          reference: 'MC-AMD-3',
          deliveryStopCode: 'AMD',
          cargo: {
            quantity: 1,
            unitDimensionsCm: { length: 100, width: 80, height: 60 },
            chargeableWeightKg: 90,
            stackable: false,
          },
        } as never,
        {
          _id: sOverflowId,
          reference: 'MC-OVER-4',
          deliveryStopCode: 'AMD',
          cargo: {
            quantity: 1,
            unitDimensionsCm: { length: 500, width: 80, height: 60 }, // Exceeds 425cm bed length
            chargeableWeightKg: 100,
            stackable: false,
          },
        } as never,
      ],
      bedDimensionsCm: { length: 425, width: 195, height: 150 },
    });

    expect(plan.zoneMapping.map((z) => z.zoneColor)).toEqual(['GREEN', 'YELLOW', 'RED']);
    // Furthest drop (AMD) is loaded first (#1/#2), earliest drop (ANA) is loaded last (#4)
    expect(plan.sequenceItems[0].stopCode).toBe('AMD');
    expect(plan.sequenceItems[plan.sequenceItems.length - 1].stopCode).toBe('ANA');
    expect(plan.overflowShipmentIds).toEqual([String(sOverflowId)]);
    expect(plan.planningAidDisclaimer).toBe(LOADING_PLANNING_AID_DISCLAIMER);

    const updated = appendLoadingOverride(plan, {
      shipmentId: String(sAnaId),
      note: 'Shifted to left side for fragile pipe',
      actorUserId: String(new Types.ObjectId()),
    });
    expect(updated.manualOverrides).toHaveLength(1);
    expect(updated.manualOverrides[0].note).toContain('fragile pipe');
  });

  it('matches profitable confirmed backhaul while honoring driver schedule and Tier 1 guarantee, or proposes early turnaround', async () => {
    const tripId = new Types.ObjectId();
    const corridorId = new Types.ObjectId();
    const vehicleId = new Types.ObjectId();
    const driverId = new Types.ObjectId();
    const reqId = new Types.ObjectId();

    const saveTrip = vi.fn().mockResolvedValue(undefined);
    const tripDoc = {
      _id: tripId,
      corridorId,
      vehicleId,
      driverId,
      estimatedEndAt: new Date('2026-11-28T13:30:00Z'),
      stopsSummary: [
        { stopCode: 'VAD', name: 'Vadodara', sequenceOrder: 0 },
        { stopCode: 'AMD', name: 'Ahmedabad', sequenceOrder: 1 },
      ],
      allocationEconomics: { tier1MinGuaranteeIncludedPaise: 320000 },
      save: saveTrip,
    };

    vi.spyOn(Trip, 'findById').mockResolvedValue(tripDoc as never);
    vi.spyOn(Vehicle, 'findById').mockResolvedValue({
      _id: vehicleId,
      maxWeightKg: 2500,
      maxVolumeCbm: 12.5,
      bedDimensionsCm: { length: 425, width: 195, height: 150 },
      operatingRestrictions: [],
      perKmRatePaise: 2400,
      payoutModel: { perKmRatePaise: 2400 },
      minGuaranteePaise: 320000,
    } as never);

    vi.spyOn(BackhaulRequest, 'find').mockImplementation((() => ({
      sort: vi.fn().mockResolvedValue([
        {
          _id: reqId,
          requestCode: 'BH-AMD-VAD-001',
          originStopCode: 'AMD',
          destinationStopCode: 'VAD',
          cargo: {
            chargeableWeightKg: 950,
            volumeCbm: 4.5,
            unitDimensionsCm: { length: 120, width: 100, height: 90 },
          },
          quotedRevenuePaise: 540000, // 114.6 km * 2400 = 275040 cost -> +264960 net
        },
      ]),
    })) as never);

    // Case 1: Driver has no conflicting next trip -> MATCHED
    vi.spyOn(Trip, 'findOne').mockImplementation((() => ({
      select: vi.fn().mockReturnValue({
        session: vi.fn().mockResolvedValue(null),
      }),
    })) as never);
    vi.spyOn(BackhaulRequest, 'updateOne').mockResolvedValue({} as never);

    const matched = await evaluateBackhaulForTrip({
      tripId: String(tripId),
      applyMatch: true,
    });
    expect(matched.matched).toBe(true);
    expect(matched.decision.decision).toBe('MATCHED');
    expect(matched.decision.tier1MinGuaranteeIncludedPaise).toBe(320000);
    expect(matched.decision.netContributionPaise).toBeGreaterThan(0);

    // Case 2: Driver has overlapping next trip -> EARLY_TURNAROUND
    vi.spyOn(Trip, 'findOne').mockImplementation((() => ({
      select: vi.fn().mockReturnValue({
        session: vi.fn().mockResolvedValue({ _id: new Types.ObjectId() }),
      }),
    })) as never);

    const conflict = await evaluateBackhaulForTrip({
      tripId: String(tripId),
      applyMatch: false,
    });
    expect(conflict.matched).toBe(false);
    expect(conflict.decision.decision).toBe('EARLY_TURNAROUND');
  });
});
