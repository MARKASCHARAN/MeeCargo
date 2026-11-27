import { Router } from 'express';
import { isValidObjectId } from 'mongoose';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { Corridor, type ICorridor } from '../models/Corridor.js';
import { Pool } from '../models/Pool.js';
import { Trip } from '../models/Trip.js';
import { executePoolCutoff } from '../services/cutoffService.js';
import { allocateAndAssignTripForPool } from '../services/driverAssignment.js';
import { buildPoolLiveEvent } from '../services/poolService.js';
import { getActivePricingRules } from '../services/pricingEngine.js';
import { calculateAndPersistTripLedger } from '../services/tripEconomicsService.js';
import { HttpError } from '../utils/errors.js';

const router = Router();

router.use(requireAuth);

router.get('/', async (req, res) => {
  const isShipper = req.auth?.role === 'SHIPPER';
  const [pools, rules] = await Promise.all([
    Pool.find({ status: { $in: ['OPEN', 'LOCKING', 'LOCKED', 'AWAITING_VIABILITY_DECISION'] } })
      .populate(
        'corridorId',
        'code name isEstablishedRoute viabilityThresholdPct baseRatePaisePerKg guaranteedCeilingPaisePerKg'
      )
      .populate('slotId', 'slotCode slotNumber label departureDate cutoffAt plannedDepartureAt')
      .sort({ updatedAt: -1 }),
    getActivePricingRules(),
  ]);

  const poolIds = pools.map((p) => p._id);
  const trips = isShipper
    ? []
    : await Trip.find({ poolId: { $in: poolIds } })
        .populate('vehicleId', 'registrationNumber vehicleClass tier')
        .lean();
  const tripByPoolId = new Map(trips.map((t) => [String(t.poolId), t]));

  const enriched = pools.map((pool) => {
    const corridor = pool.corridorId as unknown as ICorridor | null;
    const live = corridor ? buildPoolLiveEvent(pool, corridor, rules) : null;
    const baseObj = pool.toObject();
    const slotObj = baseObj.slotId as unknown as {
      _id?: unknown;
      slotCode?: string;
      slotNumber?: number;
      label?: string;
      departureDate?: Date;
      cutoffAt?: Date;
      plannedDepartureAt?: Date;
    } | null;

    if (isShipper) {
      return {
        _id: baseObj._id,
        status: baseObj.status,
        viabilityStatus: baseObj.viabilityStatus,
        viabilityReason: baseObj.viabilityReason,
        corridorId: corridor
          ? {
              _id: corridor._id,
              code: corridor.code,
              name: corridor.name,
              guaranteedCeilingPaisePerKg: corridor.guaranteedCeilingPaisePerKg,
            }
          : undefined,
        slotId: slotObj
          ? {
              _id: slotObj._id,
              slotNumber: slotObj.slotNumber,
              label: slotObj.label
                ? slotObj.label.replace(/\s*[•-]\s*(?:Mandatory\s*)?(?:\d{2}:\d{2}\s*)?Return.*$/i, ')').trim().replace(/\)\)$/, ')')
                : undefined,
              departureDate: slotObj.departureDate,
              cutoffAt: slotObj.cutoffAt,
              plannedDepartureAt: slotObj.plannedDepartureAt,
            }
          : undefined,
        liveMetrics: live
          ? {
              ...live,
              // Omit Base Pool (0-39%) label when no pool discount applies
              appliedTierLabel:
                live.appliedTierLabel.startsWith('Base Pool') ? undefined : live.appliedTierLabel,
            }
          : null,
      };
    }

    return {
      ...baseObj,
      liveMetrics: live,
      trip: tripByPoolId.get(String(pool._id)) ?? null,
    };
  });

  res.json({
    success: true,
    ...(isShipper ? {} : { pricingVersion: rules.version, discountTiers: rules.discountTiers }),
    pools: enriched,
  });
});

router.get('/:poolId', async (req, res) => {
  const isShipper = req.auth?.role === 'SHIPPER';
  const poolId = Array.isArray(req.params.poolId)
    ? req.params.poolId[0]
    : req.params.poolId;
  if (!isValidObjectId(poolId)) {
    throw new HttpError(400, 'Invalid pool ID', 'VALIDATION_ERROR');
  }

  const [pool, rules] = await Promise.all([
    Pool.findById(poolId)
      .populate('corridorId', 'code name isEstablishedRoute viabilityThresholdPct baseRatePaisePerKg guaranteedCeilingPaisePerKg')
      .populate('slotId', 'slotCode slotNumber label departureDate cutoffAt plannedDepartureAt'),
    getActivePricingRules(),
  ]);

  if (!pool) {
    throw new HttpError(404, 'Pool not found', 'POOL_NOT_FOUND');
  }

  const corridor = pool.corridorId as unknown as ICorridor | null;
  const live = corridor ? buildPoolLiveEvent(pool, corridor, rules) : null;
  res.json({
    success: true,
    pool: {
      ...(isShipper
        ? {
            _id: pool._id,
            status: pool.status,
            viabilityStatus: pool.viabilityStatus,
            corridorId: pool.corridorId,
            slotId: pool.slotId,
          }
        : pool.toObject()),
      liveMetrics: live,
    },
  });
});

router.post('/:poolId/cutoff', requireRole('PLATFORM_OWNER'), async (req, res) => {
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

router.post('/:poolId/allocate', requireRole('PLATFORM_OWNER'), async (req, res) => {
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

// Internal trip economics ledger: strictly blocked for SHIPPER role (MC-034)
router.get('/:poolId/ledger', requireRole('DRIVER'), async (req, res) => {
  const poolId = Array.isArray(req.params.poolId) ? req.params.poolId[0] : req.params.poolId;
  if (!isValidObjectId(poolId)) {
    throw new HttpError(400, 'Invalid pool ID', 'VALIDATION_ERROR');
  }
  const trip = await Trip.findOne({ poolId });
  if (!trip) {
    throw new HttpError(404, 'No trip created for this pool yet', 'NOT_FOUND');
  }
  const ledger = await calculateAndPersistTripLedger(String(trip._id));
  res.json({ success: true, ledger });
});

export default router;
