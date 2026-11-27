import { Router } from 'express';
import { isValidObjectId } from 'mongoose';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { Corridor, type ICorridor } from '../models/Corridor.js';
import { Pool } from '../models/Pool.js';
import { Trip } from '../models/Trip.js';
import { executePoolCutoff } from '../services/cutoffService.js';
import { allocateAndAssignTripForPool } from '../services/driverAssignment.js';
import { buildPoolLiveEvent } from '../services/poolService.js';
import { getActivePricingRules } from '../services/pricingEngine.js';
import { HttpError } from '../utils/errors.js';

const router = Router();

router.use(requireAuth);

router.get('/', async (_req, res) => {
  const [pools, rules] = await Promise.all([
    Pool.find({ status: { $in: ['OPEN', 'LOCKING', 'LOCKED', 'AWAITING_VIABILITY_DECISION'] } })
      .populate('corridorId', 'code name isEstablishedRoute viabilityThresholdPct baseRatePaisePerKg guaranteedCeilingPaisePerKg')
      .populate('slotId', 'slotCode label cutoffAt plannedDepartureAt')
      .sort({ updatedAt: -1 }),
    getActivePricingRules(),
  ]);

  const poolIds = pools.map((p) => p._id);
  const trips = await Trip.find({ poolId: { $in: poolIds } })
    .populate('vehicleId', 'registrationNumber vehicleClass tier')
    .lean();
  const tripByPoolId = new Map(trips.map((t) => [String(t.poolId), t]));

  const enriched = pools.map((pool) => {
    const corridor = pool.corridorId as unknown as ICorridor | null;
    const live = corridor
      ? buildPoolLiveEvent(pool, corridor, rules)
      : null;
    return {
      ...pool.toObject(),
      liveMetrics: live,
      trip: tripByPoolId.get(String(pool._id)) ?? null,
    };
  });

  res.json({
    success: true,
    pricingVersion: rules.version,
    discountTiers: rules.discountTiers,
    pools: enriched,
  });
});

router.get('/:poolId', async (req, res) => {
  const poolId = Array.isArray(req.params.poolId)
    ? req.params.poolId[0]
    : req.params.poolId;
  if (!isValidObjectId(poolId)) {
    throw new HttpError(400, 'Invalid pool ID', 'VALIDATION_ERROR');
  }

  const [pool, rules] = await Promise.all([
    Pool.findById(poolId)
      .populate('corridorId', 'code name isEstablishedRoute viabilityThresholdPct baseRatePaisePerKg guaranteedCeilingPaisePerKg')
      .populate('slotId', 'slotCode label cutoffAt plannedDepartureAt'),
    getActivePricingRules(),
  ]);

  if (!pool) {
    throw new HttpError(404, 'Pool not found', 'POOL_NOT_FOUND');
  }

  const corridor = pool.corridorId as unknown as ICorridor | null;
  res.json({
    success: true,
    pool: {
      ...pool.toObject(),
      liveMetrics: corridor ? buildPoolLiveEvent(pool, corridor, rules) : null,
    },
  });
});

router.post('/:poolId/cutoff', async (req, res) => {
  const poolId = Array.isArray(req.params.poolId)
    ? req.params.poolId[0]
    : req.params.poolId;

  const schema = z.object({
    enforceCutoffClock: z.boolean().default(false),
  });
  const parsed = schema.safeParse(req.body ?? {});

  const result = await executePoolCutoff({
    poolId,
    actorUserId: req.auth!.userId,
    enforceCutoffClock: parsed.success ? parsed.data.enforceCutoffClock : false,
  });

  const corridor = await Corridor.findById(result.pool.corridorId);
  const rules = await getActivePricingRules();

  res.json({
    success: true,
    idempotentHit: result.idempotentHit,
    viabilityPassed: result.viabilityPassed,
    allocation: 'allocation' in result ? result.allocation : undefined,
    pool: {
      ...result.pool.toObject(),
      liveMetrics: corridor ? buildPoolLiveEvent(result.pool, corridor, rules) : null,
    },
  });
});

router.post('/:poolId/allocate', async (req, res) => {
  const poolId = Array.isArray(req.params.poolId)
    ? req.params.poolId[0]
    : req.params.poolId;

  const schema = z.object({
    allowRightSizing: z.boolean().default(true),
  });
  const parsed = schema.safeParse(req.body ?? {});

  const result = await allocateAndAssignTripForPool({
    poolId,
    actorUserId: req.auth!.userId,
    allowRightSizing: parsed.success ? parsed.data.allowRightSizing : true,
  });

  res.json({
    success: true,
    ...result,
  });
});

export default router;
