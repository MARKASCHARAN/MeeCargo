import { isValidObjectId, type Types } from 'mongoose';
import { withTransaction } from '../config/database.js';
import { Corridor, type ICorridor } from '../models/Corridor.js';
import { Pool, type IPool, type ShipmentLockedSnapshot } from '../models/Pool.js';
import { isValidShipmentTransition, Shipment } from '../models/Shipment.js';
import { Slot } from '../models/Slot.js';
import { emitPoolUpdated } from '../socket/poolGateway.js';
import { HttpError } from '../utils/errors.js';
import { allocateAndAssignTripForPool } from './driverAssignment.js';
import { issueTokenRefund } from './paymentService.js';
import {
  addShipmentToPool,
  buildPoolLiveEvent,
  computeUtilizationPercentages,
  removeShipmentFromPool,
} from './poolService.js';
import { calculateDeterministicPrice, getActivePricingRules } from './pricingEngine.js';

export interface ViabilityEvaluation {
  viable: boolean;
  weightUtilizationPct: number;
  volumeUtilizationPct: number;
  thresholdPct: number;
  estimatedTripCostPaise: number;
  totalPoolRevenuePaise: number;
  contributionPaise: number;
  reason: string;
}

export function evaluatePoolViability(params: {
  corridor: Pick<ICorridor, 'isEstablishedRoute' | 'viabilityThresholdPct'>;
  pool: Pick<
    IPool,
    'reservedWeightKg' | 'capacityWeightKg' | 'reservedVolumeCbm' | 'capacityVolumeCbm'
  >;
  totalPoolRevenuePaise: number;
  estimatedTripCostPaise: number;
}): ViabilityEvaluation {
  const { corridor, pool, totalPoolRevenuePaise, estimatedTripCostPaise } = params;
  const { weightUtilizationPct, volumeUtilizationPct } =
    computeUtilizationPercentages(pool);
  const contributionPaise = totalPoolRevenuePaise - estimatedTripCostPaise;

  if (corridor.isEstablishedRoute) {
    return {
      viable: true,
      weightUtilizationPct,
      volumeUtilizationPct,
      thresholdPct: 0,
      estimatedTripCostPaise,
      totalPoolRevenuePaise,
      contributionPaise,
      reason: 'Established corridor operating under scheduled guarantee policy.',
    };
  }

  const thresholdPct = corridor.viabilityThresholdPct ?? 50;
  const meetsUtilization =
    weightUtilizationPct >= thresholdPct || volumeUtilizationPct >= thresholdPct;
  const meetsContribution = contributionPaise >= 0;
  const viable = meetsUtilization && meetsContribution;

  let reason = 'New route meets utilization and trip contribution thresholds.';
  if (!meetsUtilization) {
    reason = `New route below ${thresholdPct}% utilization threshold (weight ${weightUtilizationPct}%, volume ${volumeUtilizationPct}%).`;
  } else if (!meetsContribution) {
    reason = `New route contribution negative (${contributionPaise} paise) against trip cost.`;
  }

  return {
    viable,
    weightUtilizationPct,
    volumeUtilizationPct,
    thresholdPct,
    estimatedTripCostPaise,
    totalPoolRevenuePaise,
    contributionPaise,
    reason,
  };
}

export async function executePoolCutoff(params: {
  poolId: string;
  actorUserId?: string;
  enforceCutoffClock?: boolean;
}) {
  const { poolId, actorUserId, enforceCutoffClock = false } = params;
  if (!isValidObjectId(poolId)) {
    throw new HttpError(400, 'Invalid poolId', 'VALIDATION_ERROR');
  }

  // Idempotent short-circuit if already LOCKED
  const existingPool = await Pool.findById(poolId);
  if (!existingPool) {
    throw new HttpError(404, 'Pool not found', 'POOL_NOT_FOUND');
  }
  if (existingPool.status === 'LOCKED' && existingPool.lockedSnapshot) {
    return {
      pool: existingPool,
      idempotentHit: true,
      viabilityPassed: true,
    };
  }
  if (existingPool.status === 'AWAITING_VIABILITY_DECISION') {
    return {
      pool: existingPool,
      idempotentHit: true,
      viabilityPassed: false,
    };
  }

  // Atomically transition OPEN -> LOCKING before final calculations
  const lockingPool = await Pool.findOneAndUpdate(
    { _id: poolId, status: 'OPEN' },
    { $set: { status: 'LOCKING' } },
    { returnDocument: 'after' }
  );

  if (!lockingPool) {
    throw new HttpError(
      409,
      `Pool cannot be locked from status ${existingPool.status}`,
      'POOL_LOCK_CONFLICT'
    );
  }

  await Slot.updateOne(
    { _id: lockingPool.slotId, status: 'OPEN' },
    { $set: { status: 'LOCKING' } }
  );

  try {
    const lockResult = await withTransaction(async (session) => {
      const corridor = await Corridor.findById(lockingPool.corridorId).session(session);
      const slot = await Slot.findById(lockingPool.slotId).session(session);
      const rules = await getActivePricingRules();
      const shipments = await Shipment.find({
        _id: { $in: lockingPool.shipmentIds },
      }).session(session);

      if (!corridor || !slot) {
        throw new HttpError(404, 'Corridor or slot missing during lock', 'NOT_FOUND');
      }

      if (enforceCutoffClock && new Date() < slot.cutoffAt) {
        throw new HttpError(
          409,
          `Slot cutoff (${slot.cutoffAt.toISOString()}) has not been reached yet.`,
          'CUTOFF_NOT_REACHED'
        );
      }

      if (shipments.length === 0) {
        lockingPool.status = 'CANCELLED';
        lockingPool.viabilityStatus = 'FAILED';
        lockingPool.viabilityReason = 'No paid shipments in pool at cutoff.';
        await lockingPool.save({ session: session ?? undefined });
        slot.status = 'CANCELLED';
        await slot.save({ session: session ?? undefined });
        return { pool: lockingPool, idempotentHit: false, viabilityPassed: false };
      }

      const { weightUtilizationPct, volumeUtilizationPct } =
        computeUtilizationPercentages(lockingPool);

      const shipmentSnapshots: ShipmentLockedSnapshot[] = [];
      let totalPoolRevenuePaise = 0;
      let appliedDiscountBps = 0;
      let effectiveRatePaisePerKg = corridor.baseRatePaisePerKg;

      for (const s of shipments) {
        const isAnchor =
          Boolean(lockingPool.anchorShipmentId) &&
          lockingPool.anchorShipmentId!.equals(s._id);
        const breakdown = calculateDeterministicPrice({
          chargeableWeightKg: s.cargo.chargeableWeightKg,
          baseRatePaisePerKg: corridor.baseRatePaisePerKg,
          guaranteedCeilingPaisePerKg: corridor.guaranteedCeilingPaisePerKg,
          weightUtilizationPct,
          volumeUtilizationPct,
          isAnchorEligible: isAnchor,
          rules,
          allowSubsidy: true,
          tokenPaidPaise: s.pricingSnapshot?.tokenPaidPaise ?? 0,
        });

        appliedDiscountBps = breakdown.appliedDiscountBps;
        effectiveRatePaisePerKg = breakdown.effectiveRatePaisePerKg;
        totalPoolRevenuePaise += breakdown.computedPricePaise;

        shipmentSnapshots.push({
          shipmentId: s._id,
          chargeableWeightKg: s.cargo.chargeableWeightKg,
          baseFreightPaise: breakdown.baseFreightPaise,
          poolDiscountPaise: breakdown.poolDiscountPaise,
          anchorDiscountPaise: breakdown.anchorDiscountPaise,
          handlingFeePaise: breakdown.handlingFeePaise,
          subsidyPaise: breakdown.subsidyPaise,
          finalChargePaise: breakdown.computedPricePaise,
          tokenPaidPaise: s.pricingSnapshot?.tokenPaidPaise ?? 0,
          remainingBalancePaise: breakdown.remainingBalancePaise,
        });
      }

      // Prototype baseline corridor trip cost estimate (min guarantee or weight-based cost)
      const estimatedTripCostPaise = Math.max(
        220000,
        Math.round(lockingPool.reservedWeightKg * rules.estimatedCostPaisePerKg)
      );

      const viability = evaluatePoolViability({
        corridor,
        pool: lockingPool,
        totalPoolRevenuePaise,
        estimatedTripCostPaise,
      });

      if (!viability.viable) {
        lockingPool.status = 'AWAITING_VIABILITY_DECISION';
        lockingPool.viabilityStatus = 'FAILED';
        lockingPool.viabilityReason = viability.reason;
        await lockingPool.save({ session: session ?? undefined });

        for (const s of shipments) {
          s.viabilityDecision = 'PENDING_CHOICE';
          s.statusHistory.push({
            status: s.status,
            at: new Date(),
            actorUserId: s.createdByUserId,
            note: `New route viability check failed: ${viability.reason}`,
          });
          await s.save({ session: session ?? undefined });
        }

        const liveEvent = buildPoolLiveEvent(lockingPool, corridor, rules);
        emitPoolUpdated(liveEvent);
        return {
          pool: lockingPool,
          viability,
          idempotentHit: false,
          viabilityPassed: false,
        };
      }

      // Snapshot immutable prices on Pool & Shipments
      lockingPool.viabilityStatus = 'PASSED';
      lockingPool.viabilityReason = viability.reason;
      lockingPool.lockedSnapshot = {
        pricingVersion: rules.version,
        lockedAt: new Date(),
        weightUtilizationPct,
        volumeUtilizationPct,
        appliedDiscountBps,
        anchorShipmentId: lockingPool.anchorShipmentId,
        anchorRewardBps: rules.anchorRewardBps,
        effectiveRatePaisePerKg,
        ceilingRatePaisePerKg: corridor.guaranteedCeilingPaisePerKg,
        totalPoolRevenuePaise,
        estimatedTripCostPaise,
        contributionPaise: viability.contributionPaise,
        shipmentSnapshots,
      };
      lockingPool.status = 'LOCKED';
      await lockingPool.save({ session: session ?? undefined });

      slot.status = 'LOCKED';
      await slot.save({ session: session ?? undefined });

      for (const s of shipments) {
        const snap = shipmentSnapshots.find((item) => item.shipmentId.equals(s._id))!;
        s.pricingSnapshot = {
          pricingVersion: rules.version,
          ceilingPricePaise:
            s.pricingSnapshot?.ceilingPricePaise ??
            Math.round(s.cargo.chargeableWeightKg * corridor.guaranteedCeilingPaisePerKg) +
              snap.handlingFeePaise,
          projectedPricePaise: snap.finalChargePaise,
          finalLockedPricePaise: snap.finalChargePaise,
          tokenAmountPaise: s.pricingSnapshot?.tokenAmountPaise ?? snap.tokenPaidPaise,
          tokenPaidPaise: snap.tokenPaidPaise,
          remainingBalancePaise: snap.remainingBalancePaise,
          isAnchorEligible: Boolean(
            lockingPool.anchorShipmentId && lockingPool.anchorShipmentId.equals(s._id)
          ),
          poolDiscountPaise: snap.poolDiscountPaise,
          anchorDiscountPaise: snap.anchorDiscountPaise,
          handlingFeePaise: snap.handlingFeePaise,
          subsidyPaise: snap.subsidyPaise,
          marginFlagged: snap.subsidyPaise > 0,
        };

        if (isValidShipmentTransition(s.status, 'LOCKED')) {
          s.status = 'LOCKED';
          s.statusHistory.push({
            status: 'LOCKED',
            at: new Date(),
            actorUserId: s.createdByUserId,
            note: `Cutoff locked at ₹${(snap.finalChargePaise / 100).toFixed(2)} (actor ${
              actorUserId ?? 'system'
            })`,
          });
        }
        await s.save({ session: session ?? undefined });
      }

      const liveEvent = buildPoolLiveEvent(lockingPool, corridor, rules);
      emitPoolUpdated(liveEvent);

      return {
        pool: lockingPool,
        viability,
        idempotentHit: false,
        viabilityPassed: true,
      };
    });

    if (lockResult.viabilityPassed && lockResult.pool.status === 'LOCKED') {
      const allocation = await allocateAndAssignTripForPool({
        poolId: String(lockResult.pool._id),
        actorUserId,
      });
      const latestPool = await Pool.findById(lockResult.pool._id);
      return {
        ...lockResult,
        pool: latestPool ?? lockResult.pool,
        allocation,
      };
    }

    return lockResult;
  } catch (error) {
    // Recover safely from LOCKING back to OPEN so users are never stuck or partially charged
    await Pool.updateOne({ _id: poolId, status: 'LOCKING' }, { $set: { status: 'OPEN' } });
    await Slot.updateOne(
      { _id: lockingPool.slotId, status: 'LOCKING' },
      { $set: { status: 'OPEN' } }
    );
    throw error;
  }
}

export async function submitViabilityDecision(params: {
  shipmentId: string;
  businessId: Types.ObjectId;
  userId: string;
  decision: 'ROLLOVER' | 'REFUND';
  targetSlotId?: string;
}) {
  const { shipmentId, businessId, userId, decision, targetSlotId } = params;
  if (!isValidObjectId(shipmentId)) {
    throw new HttpError(400, 'Invalid shipmentId', 'VALIDATION_ERROR');
  }

  return withTransaction(async (session) => {
    const shipment = await Shipment.findOne({
      _id: shipmentId,
      businessId,
    }).session(session);

    if (!shipment) {
      throw new HttpError(403, 'Shipment not found for your business', 'FORBIDDEN');
    }

    if (shipment.viabilityDecision !== 'PENDING_CHOICE') {
      throw new HttpError(
        409,
        'This shipment is not awaiting a low-utilization viability decision.',
        'INVALID_STATE'
      );
    }

    const oldPoolId = shipment.poolId;
    const oldSlotId = shipment.slotId;

    if (decision === 'REFUND') {
      await Slot.updateOne(
        { _id: oldSlotId },
        {
          $inc: {
            reservedWeightKg: -shipment.cargo.chargeableWeightKg,
            reservedVolumeCbm: -shipment.cargo.volumeCbm,
          },
        },
        { session: session ?? undefined }
      );
      await removeShipmentFromPool({ shipment, session });
      const refund = await issueTokenRefund({
        shipment,
        reason: 'New route failed minimum viability threshold; shipper chose full token refund',
        actorUserId: userId,
        session,
      });

      shipment.viabilityDecision = 'REFUND_REQUESTED';
      shipment.status = 'CANCELLED';
      shipment.statusHistory.push({
        status: 'CANCELLED',
        at: new Date(),
        actorUserId: shipment.createdByUserId,
        note: 'Full token refunded after failed new-route viability',
      });
      await shipment.save({ session: session ?? undefined });

      if (oldPoolId) {
        await Pool.updateOne(
          { _id: oldPoolId, shipmentIds: { $size: 0 } },
          { $set: { status: 'CANCELLED' } },
          { session: session ?? undefined }
        );
      }

      return { shipment, refund, decision: 'REFUND' as const };
    }

    // ROLLOVER path requires explicit targetSlotId
    if (!targetSlotId || !isValidObjectId(targetSlotId)) {
      throw new HttpError(
        400,
        'A valid future targetSlotId is required for consented rollover.',
        'TARGET_SLOT_REQUIRED'
      );
    }

    const corridor = await Corridor.findById(shipment.corridorId).session(session);
    const targetSlot = await Slot.findOneAndUpdate(
      {
        _id: targetSlotId,
        corridorId: shipment.corridorId,
        status: 'OPEN',
        cutoffAt: { $gt: new Date() },
        $expr: {
          $and: [
            {
              $lte: [
                { $add: ['$reservedWeightKg', shipment.cargo.chargeableWeightKg] },
                '$capacityWeightKg',
              ],
            },
            {
              $lte: [
                { $add: ['$reservedVolumeCbm', shipment.cargo.volumeCbm] },
                '$capacityVolumeCbm',
              ],
            },
          ],
        },
      },
      {
        $inc: {
          reservedWeightKg: shipment.cargo.chargeableWeightKg,
          reservedVolumeCbm: shipment.cargo.volumeCbm,
        },
      },
      { returnDocument: 'after', session: session ?? undefined }
    );

    if (!corridor || !targetSlot) {
      throw new HttpError(
        409,
        'Target rollover slot is unavailable, past cutoff, or lacks capacity.',
        'TARGET_SLOT_UNAVAILABLE'
      );
    }

    await Slot.updateOne(
      { _id: oldSlotId },
      {
        $inc: {
          reservedWeightKg: -shipment.cargo.chargeableWeightKg,
          reservedVolumeCbm: -shipment.cargo.volumeCbm,
        },
      },
      { session: session ?? undefined }
    );
    await removeShipmentFromPool({ shipment, session });

    shipment.rolledOverFromSlotId = oldSlotId;
    shipment.slotId = targetSlot._id;
    shipment.poolId = undefined;
    shipment.viabilityDecision = 'ROLLOVER_CONSENTED';
    shipment.status = 'ROLLED_OVER';
    shipment.statusHistory.push({
      status: 'ROLLED_OVER',
      at: new Date(),
      actorUserId: shipment.createdByUserId,
      note: `Shipper consented to rollover into slot ${targetSlot.slotCode}`,
    });
    await shipment.save({ session: session ?? undefined });

    const { pool, liveEvent } = await addShipmentToPool({
      shipment,
      slot: targetSlot,
      corridor,
      actorUserId: userId,
      session,
    });

    if (oldPoolId) {
      await Pool.updateOne(
        { _id: oldPoolId, shipmentIds: { $size: 0 } },
        { $set: { status: 'ROLLED_OVER' } },
        { session: session ?? undefined }
      );
    }

    return { shipment, targetPool: pool, liveEvent, decision: 'ROLLOVER' as const };
  });
}
