import type { ClientSession } from 'mongoose';
import { Corridor, type ICorridor } from '../models/Corridor.js';
import { Pool, type IPool } from '../models/Pool.js';
import { isValidShipmentTransition, Shipment, type IShipment } from '../models/Shipment.js';
import { Slot, type ISlot } from '../models/Slot.js';
import { emitPoolUpdated, type PoolLiveEvent } from '../socket/poolGateway.js';
import { HttpError } from '../utils/errors.js';
import {
  calculateDeterministicPrice,
  getActivePricingRules,
  selectDiscountTier,
  type PricingRuleSet,
} from './pricingEngine.js';

const INCOMPATIBLE_CARGO_FLAGS = new Set([
  'HAZMAT',
  'REFRIGERATED',
  'LIVESTOCK',
  'EXPLOSIVE',
]);

export function assertCargoCompatibleWithPool(shipment: IShipment): void {
  const flags = shipment.cargo.handlingRestrictions ?? [];
  const incompatible = flags.find((f) =>
    INCOMPATIBLE_CARGO_FLAGS.has(f.toUpperCase())
  );
  if (incompatible) {
    throw new HttpError(
      422,
      `Cargo restriction '${incompatible}' is incompatible with shared ambient corridor pools.`,
      'INCOMPATIBLE_CARGO'
    );
  }
}

export function computeUtilizationPercentages(pool: {
  reservedWeightKg: number;
  capacityWeightKg: number;
  reservedVolumeCbm: number;
  capacityVolumeCbm: number;
}) {
  const weightUtilizationPct =
    pool.capacityWeightKg > 0
      ? Number(
          Math.min(100, (pool.reservedWeightKg / pool.capacityWeightKg) * 100).toFixed(1)
        )
      : 0;
  const volumeUtilizationPct =
    pool.capacityVolumeCbm > 0
      ? Number(
          Math.min(100, (pool.reservedVolumeCbm / pool.capacityVolumeCbm) * 100).toFixed(1)
        )
      : 0;
  return { weightUtilizationPct, volumeUtilizationPct };
}

export function buildPoolLiveEvent(
  pool: IPool,
  corridor: Pick<ICorridor, '_id' | 'baseRatePaisePerKg' | 'guaranteedCeilingPaisePerKg'>,
  rules: PricingRuleSet
): PoolLiveEvent {
  const { weightUtilizationPct, volumeUtilizationPct } =
    computeUtilizationPercentages(pool);
  const effectiveUtil = Math.max(weightUtilizationPct, volumeUtilizationPct);
  const tier = selectDiscountTier(effectiveUtil, rules.discountTiers);
  const discountedRate = Math.round(
    corridor.baseRatePaisePerKg * (1 - tier.discountBps / 10000)
  );
  const projectedRatePaisePerKg = Math.min(
    discountedRate,
    corridor.guaranteedCeilingPaisePerKg
  );

  return {
    poolId: String(pool._id),
    poolCode: pool.poolCode,
    corridorId: String(pool.corridorId),
    slotId: String(pool.slotId),
    status: pool.status,
    weightUtilizationPct,
    volumeUtilizationPct,
    reservedWeightKg: Number(pool.reservedWeightKg.toFixed(2)),
    capacityWeightKg: pool.capacityWeightKg,
    reservedVolumeCbm: Number(pool.reservedVolumeCbm.toFixed(4)),
    capacityVolumeCbm: pool.capacityVolumeCbm,
    shipmentCount: pool.shipmentIds.length,
    projectedRatePaisePerKg:
      pool.status === 'LOCKED' && pool.lockedSnapshot
        ? pool.lockedSnapshot.effectiveRatePaisePerKg
        : projectedRatePaisePerKg,
    appliedTierLabel: tier.label,
    isEstimateFinal: pool.status === 'LOCKED',
    viabilityStatus: pool.viabilityStatus,
    updatedAt: new Date().toISOString(),
  };
}

export async function refreshPoolProjectedPrices(
  pool: IPool,
  corridor: ICorridor,
  rules: PricingRuleSet,
  session: ClientSession | null
): Promise<void> {
  if (pool.status !== 'OPEN') return;
  const { weightUtilizationPct, volumeUtilizationPct } =
    computeUtilizationPercentages(pool);

  const shipments = await Shipment.find({
    _id: { $in: pool.shipmentIds },
  }).session(session);

  for (const s of shipments) {
    const isAnchor =
      Boolean(pool.anchorShipmentId) && pool.anchorShipmentId!.equals(s._id);
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

    s.pricingSnapshot = {
      pricingVersion: breakdown.pricingVersion,
      ceilingPricePaise: breakdown.ceilingPricePaise,
      projectedPricePaise: breakdown.computedPricePaise,
      finalLockedPricePaise: s.pricingSnapshot?.finalLockedPricePaise,
      tokenAmountPaise: s.pricingSnapshot?.tokenAmountPaise ?? breakdown.tokenAmountPaise,
      tokenPaidPaise: s.pricingSnapshot?.tokenPaidPaise ?? 0,
      remainingBalancePaise: breakdown.remainingBalancePaise,
      isAnchorEligible: isAnchor,
      poolDiscountPaise: breakdown.poolDiscountPaise,
      anchorDiscountPaise: breakdown.anchorDiscountPaise,
      handlingFeePaise: breakdown.handlingFeePaise,
      subsidyPaise: breakdown.subsidyPaise,
      marginFlagged: breakdown.marginFlagged,
    };
    await s.save({ session: session ?? undefined });
  }
}

export async function addShipmentToPool(params: {
  shipment: IShipment;
  slot: ISlot;
  corridor: ICorridor;
  actorUserId: string;
  session: ClientSession | null;
}): Promise<{ pool: IPool; liveEvent: PoolLiveEvent }> {
  const { shipment, slot, corridor, actorUserId, session } = params;

  if (shipment.tokenStatus !== 'PAID') {
    throw new HttpError(
      409,
      'Only bookings with satisfied refundable token payment can enter a pool.',
      'TOKEN_PAYMENT_REQUIRED'
    );
  }

  assertCargoCompatibleWithPool(shipment);

  if (shipment.poolId) {
    const existingActive = await Pool.findOne({
      _id: shipment.poolId,
      status: { $in: ['OPEN', 'LOCKING', 'LOCKED', 'AWAITING_VIABILITY_DECISION'] },
    }).session(session);
    if (existingActive) {
      throw new HttpError(
        409,
        'Shipment is already assigned to an active pool.',
        'ALREADY_POOLED'
      );
    }
  }

  if (slot.status !== 'OPEN') {
    throw new HttpError(
      409,
      `Slot ${slot.slotCode} is ${slot.status} and cannot accept pool members.`,
      'SLOT_NOT_OPEN'
    );
  }

  // Ensure Pool document exists for this slot before atomic capacity reservation
  await Pool.findOneAndUpdate(
    { slotId: slot._id },
    {
      $setOnInsert: {
        poolCode: `POOL-${slot.slotCode}`,
        corridorId: corridor._id,
        slotId: slot._id,
        status: 'OPEN',
        capacityWeightKg: slot.capacityWeightKg,
        capacityVolumeCbm: slot.capacityVolumeCbm,
        reservedWeightKg: 0,
        reservedVolumeCbm: 0,
        shipmentIds: [],
        viabilityStatus: 'PENDING',
      },
    },
    { upsert: true, returnDocument: 'after', session: session ?? undefined }
  );

  // Atomic capacity & membership update to prevent concurrent overbooking
  const updatedPool = await Pool.findOneAndUpdate(
    {
      slotId: slot._id,
      status: 'OPEN',
      shipmentIds: { $ne: shipment._id },
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
      $addToSet: { shipmentIds: shipment._id },
    },
    { returnDocument: 'after', session: session ?? undefined }
  );

  if (!updatedPool) {
    throw new HttpError(
      409,
      'Pool is locked or has insufficient remaining weight/volume capacity.',
      'POOL_CAPACITY_OR_LOCK_CONFLICT'
    );
  }

  const rules = await getActivePricingRules();

  // Atomically claim anchor slot if none exists and shipment meets minimum weight
  if (
    !updatedPool.anchorShipmentId &&
    shipment.cargo.chargeableWeightKg >= rules.anchorMinWeightKg
  ) {
    const claimedAnchor = await Pool.findOneAndUpdate(
      { _id: updatedPool._id, anchorShipmentId: { $exists: false } },
      { $set: { anchorShipmentId: shipment._id } },
      { returnDocument: 'after', session: session ?? undefined }
    );
    if (claimedAnchor) {
      updatedPool.anchorShipmentId = claimedAnchor.anchorShipmentId;
    }
  }

  if (isValidShipmentTransition(shipment.status, 'POOLED')) {
    shipment.status = 'POOLED';
    shipment.statusHistory.push({
      status: 'POOLED',
      at: new Date(),
      actorUserId: shipment.createdByUserId,
      note: `Joined pool ${updatedPool.poolCode} (actor ${actorUserId})`,
    });
  }
  shipment.poolId = updatedPool._id;
  await shipment.save({ session: session ?? undefined });

  await refreshPoolProjectedPrices(updatedPool, corridor, rules, session);

  const liveEvent = buildPoolLiveEvent(updatedPool, corridor, rules);
  emitPoolUpdated(liveEvent);

  return { pool: updatedPool, liveEvent };
}

export async function removeShipmentFromPool(params: {
  shipment: IShipment;
  session: ClientSession | null;
}): Promise<PoolLiveEvent | null> {
  const { shipment, session } = params;
  if (!shipment.poolId) return null;

  const updatedPool = await Pool.findOneAndUpdate(
    {
      _id: shipment.poolId,
      shipmentIds: shipment._id,
    },
    {
      $inc: {
        reservedWeightKg: -shipment.cargo.chargeableWeightKg,
        reservedVolumeCbm: -shipment.cargo.volumeCbm,
      },
      $pull: { shipmentIds: shipment._id },
    },
    { returnDocument: 'after', session: session ?? undefined }
  );

  if (!updatedPool) return null;

  // Clamp any floating rounding residue to >= 0
  if (updatedPool.reservedWeightKg < 0 || updatedPool.reservedVolumeCbm < 0) {
    updatedPool.reservedWeightKg = Math.max(0, updatedPool.reservedWeightKg);
    updatedPool.reservedVolumeCbm = Math.max(0, updatedPool.reservedVolumeCbm);
    await updatedPool.save({ session: session ?? undefined });
  }

  // Clear anchor if the cancelled shipment was the anchor
  if (updatedPool.anchorShipmentId?.equals(shipment._id)) {
    updatedPool.anchorShipmentId = undefined;
    await updatedPool.save({ session: session ?? undefined });
  }

  const corridor = await Corridor.findById(updatedPool.corridorId).session(session);
  if (!corridor) return null;

  const rules = await getActivePricingRules();
  await refreshPoolProjectedPrices(updatedPool, corridor, rules, session);
  const liveEvent = buildPoolLiveEvent(updatedPool, corridor, rules);
  emitPoolUpdated(liveEvent);
  return liveEvent;
}
