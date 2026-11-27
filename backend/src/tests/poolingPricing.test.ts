import { Types } from 'mongoose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isValidPaymentTransition, Payment } from '../models/Payment.js';
import { Pool } from '../models/Pool.js';
import { Shipment } from '../models/Shipment.js';
import {
  evaluatePoolViability,
  executePoolCutoff,
} from '../services/cutoffService.js';
import { processTokenPayment } from '../services/paymentService.js';
import {
  addShipmentToPool,
  assertCargoCompatibleWithPool,
  computeUtilizationPercentages,
} from '../services/poolService.js';
import {
  calculateDeterministicPrice,
  DEFAULT_PRICING_RULES,
} from '../services/pricingEngine.js';

describe('Stage 4 Pooling, Deterministic Pricing, Tokens, Cutoff & Viability (MC-012 to MC-017)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calculates integer-paise prices, enforces ceiling, anchor rules, and minimum margin policy', () => {
    const standard = calculateDeterministicPrice({
      chargeableWeightKg: 100,
      baseRatePaisePerKg: 480,
      guaranteedCeilingPaisePerKg: 550,
      weightUtilizationPct: 70,
      volumeUtilizationPct: 45,
      isAnchorEligible: true,
      rules: DEFAULT_PRICING_RULES,
    });

    // Base = 48000, 15% pool discount (7200) + 5% anchor (2400) = 38400 + 5000 handling = 43400
    expect(Number.isInteger(standard.computedPricePaise)).toBe(true);
    expect(standard.poolDiscountPaise).toBe(7200);
    expect(standard.anchorDiscountPaise).toBe(2400);
    expect(standard.computedPricePaise).toBe(43400);
    expect(standard.computedPricePaise).toBeLessThanOrEqual(standard.ceilingPricePaise);
    // Token = 15% of ceiling (550*100 + 5000 = 60000 -> 9000 paise)
    expect(standard.tokenAmountPaise).toBe(9000);

    // Non-anchor under weight threshold gets 0 anchor discount
    const tooLightForAnchor = calculateDeterministicPrice({
      chargeableWeightKg: 20,
      baseRatePaisePerKg: 480,
      guaranteedCeilingPaisePerKg: 550,
      weightUtilizationPct: 20,
      volumeUtilizationPct: 10,
      isAnchorEligible: true,
      rules: DEFAULT_PRICING_RULES,
    });
    expect(tooLightForAnchor.anchorDiscountPaise).toBe(0);

    // Ceiling cap: even if base rate > ceiling rate, price never exceeds ceiling
    const capped = calculateDeterministicPrice({
      chargeableWeightKg: 100,
      baseRatePaisePerKg: 800,
      guaranteedCeilingPaisePerKg: 550,
      weightUtilizationPct: 10,
      volumeUtilizationPct: 10,
      isAnchorEligible: false,
      rules: DEFAULT_PRICING_RULES,
    });
    expect(capped.computedPricePaise).toBe(capped.ceilingPricePaise);

    // Minimum margin violation rejected unless subsidy approved
    expect(() =>
      calculateDeterministicPrice({
        chargeableWeightKg: 100,
        baseRatePaisePerKg: 200,
        guaranteedCeilingPaisePerKg: 250,
        weightUtilizationPct: 10,
        volumeUtilizationPct: 10,
        isAnchorEligible: false,
        rules: DEFAULT_PRICING_RULES,
        allowSubsidy: false,
      })
    ).toThrow(/minimum margin floor/i);

    const subsidized = calculateDeterministicPrice({
      chargeableWeightKg: 100,
      baseRatePaisePerKg: 200,
      guaranteedCeilingPaisePerKg: 250,
      weightUtilizationPct: 10,
      volumeUtilizationPct: 10,
      isAnchorEligible: false,
      rules: DEFAULT_PRICING_RULES,
      allowSubsidy: true,
    });
    expect(subsidized.marginFlagged).toBe(true);
    expect(subsidized.subsidyPaise).toBeGreaterThan(0);
  });

  it('computes weight and volume utilization separately and rejects incompatible cargo', () => {
    const util = computeUtilizationPercentages({
      reservedWeightKg: 1250,
      capacityWeightKg: 2500,
      reservedVolumeCbm: 9,
      capacityVolumeCbm: 12,
    });
    expect(util.weightUtilizationPct).toBe(50);
    expect(util.volumeUtilizationPct).toBe(75);

    expect(() =>
      assertCargoCompatibleWithPool({
        cargo: { handlingRestrictions: ['HAZMAT'] },
      } as never)
    ).toThrow(/incompatible/i);
  });

  it('prevents unpaid shipments, double-pooling, and concurrent pool overbooking', async () => {
    await expect(
      addShipmentToPool({
        shipment: { tokenStatus: 'PENDING', cargo: { handlingRestrictions: [] } } as never,
        slot: { status: 'OPEN' } as never,
        corridor: {} as never,
        actorUserId: 'u1',
        session: null,
      })
    ).rejects.toThrow(/token payment/i);

    vi.spyOn(Pool, 'findOne').mockImplementation((() => ({
      session: vi.fn().mockResolvedValue({ _id: new Types.ObjectId(), status: 'OPEN' }),
    })) as never);

    await expect(
      addShipmentToPool({
        shipment: {
          _id: new Types.ObjectId(),
          tokenStatus: 'PAID',
          poolId: new Types.ObjectId(),
          cargo: { handlingRestrictions: [] },
        } as never,
        slot: { status: 'OPEN' } as never,
        corridor: {} as never,
        actorUserId: 'u1',
        session: null,
      })
    ).rejects.toThrow(/already assigned to an active pool/i);

    // Concurrent overbooking protection: conditional findOneAndUpdate returns null
    vi.spyOn(Pool, 'findOneAndUpdate')
      .mockResolvedValueOnce({ _id: new Types.ObjectId() } as never) // upsert pool
      .mockResolvedValueOnce(null); // capacity guard failed under concurrency

    await expect(
      addShipmentToPool({
        shipment: {
          _id: new Types.ObjectId(),
          tokenStatus: 'PAID',
          cargo: { chargeableWeightKg: 1000, volumeCbm: 5, handlingRestrictions: [] },
        } as never,
        slot: {
          _id: new Types.ObjectId(),
          slotCode: 'SLOT-1',
          status: 'OPEN',
          capacityWeightKg: 2500,
          capacityVolumeCbm: 12,
        } as never,
        corridor: { _id: new Types.ObjectId() } as never,
        actorUserId: 'u1',
        session: null,
      })
    ).rejects.toThrow(/insufficient remaining weight\/volume capacity/i);
  });

  it('validates payment state transitions and handles duplicate payment callbacks idempotently', async () => {
    expect(isValidPaymentTransition('PENDING', 'SUCCESS')).toBe(true);
    expect(isValidPaymentTransition('SUCCESS', 'REFUNDED')).toBe(true);
    expect(isValidPaymentTransition('FAILED', 'SUCCESS')).toBe(false);

    const shipmentId = new Types.ObjectId();
    vi.spyOn(Payment, 'findOne').mockResolvedValueOnce({
      _id: new Types.ObjectId(),
      providerRef: 'SIM-TOK-1234',
      status: 'SUCCESS',
    } as never);
    vi.spyOn(Shipment, 'findById').mockResolvedValueOnce({
      _id: shipmentId,
      tokenStatus: 'PAID',
    } as never);

    const res = await processTokenPayment({
      shipmentId: String(shipmentId),
      businessId: new Types.ObjectId(),
      userId: 'u1',
      idempotencyKey: 'dup-pay-key',
    });
    expect(res.deduplicated).toBe(true);
    expect(res.payment?.providerRef).toBe('SIM-TOK-1234');
  });

  it('makes cutoff lock idempotent and enforces new-route viability checks', async () => {
    const poolId = new Types.ObjectId();
    vi.spyOn(Pool, 'findById').mockResolvedValueOnce({
      _id: poolId,
      status: 'LOCKED',
      lockedSnapshot: { pricingVersion: '2026.11.v1' },
    } as never);

    const lockedResult = await executePoolCutoff({ poolId: String(poolId) });
    expect(lockedResult.idempotentHit).toBe(true);
    expect(lockedResult.viabilityPassed).toBe(true);

    // New route below 50% threshold fails viability
    const failedNewRoute = evaluatePoolViability({
      corridor: { isEstablishedRoute: false, viabilityThresholdPct: 50 },
      pool: {
        reservedWeightKg: 600,
        capacityWeightKg: 2500, // 24%
        reservedVolumeCbm: 4,
        capacityVolumeCbm: 12, // 33.3%
      },
      totalPoolRevenuePaise: 300000,
      estimatedTripCostPaise: 220000,
    });
    expect(failedNewRoute.viable).toBe(false);
    expect(failedNewRoute.reason).toMatch(/below 50%/i);

    // New route >= 50% utilization but negative contribution also fails viability
    const negativeContribution = evaluatePoolViability({
      corridor: { isEstablishedRoute: false, viabilityThresholdPct: 50 },
      pool: {
        reservedWeightKg: 1500,
        capacityWeightKg: 2500, // 60%
        reservedVolumeCbm: 6,
        capacityVolumeCbm: 12,
      },
      totalPoolRevenuePaise: 180000,
      estimatedTripCostPaise: 250000,
    });
    expect(negativeContribution.viable).toBe(false);
    expect(negativeContribution.reason).toMatch(/contribution negative/i);

    // Established route passes under guaranteed ceiling policy
    const established = evaluatePoolViability({
      corridor: { isEstablishedRoute: true, viabilityThresholdPct: 50 },
      pool: {
        reservedWeightKg: 500,
        capacityWeightKg: 2500,
        reservedVolumeCbm: 3,
        capacityVolumeCbm: 12,
      },
      totalPoolRevenuePaise: 240000,
      estimatedTripCostPaise: 220000,
    });
    expect(established.viable).toBe(true);
  });
});
