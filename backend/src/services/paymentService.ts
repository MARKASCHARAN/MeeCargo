import crypto from 'node:crypto';
import { isValidObjectId, type ClientSession, type Types } from 'mongoose';
import { env } from '../config/env.js';
import { withTransaction } from '../config/database.js';
import { Corridor } from '../models/Corridor.js';
import {
  isValidPaymentTransition,
  Payment,
  type IPayment,
} from '../models/Payment.js';
import { isValidShipmentTransition, Shipment, type IShipment } from '../models/Shipment.js';
import { Slot } from '../models/Slot.js';
import { HttpError } from '../utils/errors.js';
import { addShipmentToPool, removeShipmentFromPool } from './poolService.js';
import { calculateDeterministicPrice, getActivePricingRules } from './pricingEngine.js';

export async function processTokenPayment(params: {
  shipmentId: string;
  businessId: Types.ObjectId;
  userId: string;
  idempotencyKey?: string;
  simulateOutcome?: 'SUCCESS' | 'FAILED';
}) {
  const {
    shipmentId,
    businessId,
    userId,
    idempotencyKey,
    simulateOutcome = 'SUCCESS',
  } = params;

  if (!isValidObjectId(shipmentId)) {
    throw new HttpError(400, 'Invalid shipmentId', 'VALIDATION_ERROR');
  }

  if (idempotencyKey) {
    const existingPayment = await Payment.findOne({
      shipmentId,
      idempotencyKey,
    });
    if (existingPayment) {
      const existingShipment = await Shipment.findById(shipmentId);
      return {
        payment: existingPayment,
        shipment: existingShipment,
        deduplicated: true,
      };
    }
  }

  return withTransaction(async (session) => {
    const shipment = await Shipment.findOne({
      _id: shipmentId,
      businessId,
    }).session(session);

    if (!shipment) {
      throw new HttpError(403, 'Shipment not found for your business', 'FORBIDDEN');
    }

    if (shipment.tokenStatus === 'PAID' && simulateOutcome === 'SUCCESS') {
      const existingSuccess = await Payment.findOne({
        shipmentId: shipment._id,
        type: 'TOKEN',
        status: 'SUCCESS',
      }).session(session);
      return {
        payment: existingSuccess,
        shipment,
        deduplicated: true,
      };
    }

    const corridor = await Corridor.findById(shipment.corridorId).session(session);
    const slot = await Slot.findById(shipment.slotId).session(session);
    const rules = await getActivePricingRules();

    if (!corridor || !slot) {
      throw new HttpError(404, 'Corridor or slot not found', 'NOT_FOUND');
    }

    const weightUtil = (slot.reservedWeightKg / slot.capacityWeightKg) * 100;
    const volUtil = (slot.reservedVolumeCbm / slot.capacityVolumeCbm) * 100;

    const quote = calculateDeterministicPrice({
      chargeableWeightKg: shipment.cargo.chargeableWeightKg,
      baseRatePaisePerKg: corridor.baseRatePaisePerKg,
      guaranteedCeilingPaisePerKg: corridor.guaranteedCeilingPaisePerKg,
      weightUtilizationPct: weightUtil,
      volumeUtilizationPct: volUtil,
      isAnchorEligible: false,
      rules,
      allowSubsidy: true,
    });

    const providerRef = `${
      env.PAYMENT_MODE === 'SIMULATED' ? 'SIM-TOK' : 'TST-TOK'
    }-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;

    const [payment] = await Payment.create(
      [
        {
          shipmentId: shipment._id,
          businessId,
          type: 'TOKEN',
          amountPaise: quote.tokenAmountPaise,
          status: simulateOutcome,
          mode: env.PAYMENT_MODE,
          isSimulated: env.PAYMENT_MODE === 'SIMULATED',
          providerRef,
          ...(idempotencyKey ? { idempotencyKey } : {}),
          actorUserId: shipment.createdByUserId,
          processedAt: new Date(),
        },
      ],
      { session: session ?? undefined }
    );

    if (simulateOutcome === 'FAILED') {
      shipment.tokenStatus = 'UNPAID';
      shipment.statusHistory.push({
        status: shipment.status,
        at: new Date(),
        actorUserId: shipment.createdByUserId,
        note: `Token payment failed (${providerRef})`,
      });
      await shipment.save({ session: session ?? undefined });
      return { payment, shipment, deduplicated: false };
    }

    // Reserve capacity on Slot atomically if not yet confirmed
    if (shipment.status === 'PENDING_TOKEN') {
      if (!isValidShipmentTransition(shipment.status, 'CONFIRMED')) {
        throw new HttpError(409, 'Invalid shipment status transition', 'INVALID_TRANSITION');
      }

      const updatedSlot = await Slot.findOneAndUpdate(
        {
          _id: slot._id,
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

      if (!updatedSlot) {
        throw new HttpError(
          409,
          'Slot cutoff passed or capacity exceeded while confirming token.',
          'SLOT_UNAVAILABLE'
        );
      }
      slot.reservedWeightKg = updatedSlot.reservedWeightKg;
      slot.reservedVolumeCbm = updatedSlot.reservedVolumeCbm;
    }

    shipment.tokenStatus = 'PAID';
    shipment.status = 'CONFIRMED';
    shipment.pricingSnapshot = {
      pricingVersion: quote.pricingVersion,
      ceilingPricePaise: quote.ceilingPricePaise,
      projectedPricePaise: quote.computedPricePaise,
      tokenAmountPaise: quote.tokenAmountPaise,
      tokenPaidPaise: quote.tokenAmountPaise,
      remainingBalancePaise: Math.max(0, quote.computedPricePaise - quote.tokenAmountPaise),
      isAnchorEligible: false,
      poolDiscountPaise: quote.poolDiscountPaise,
      anchorDiscountPaise: 0,
      handlingFeePaise: quote.handlingFeePaise,
      subsidyPaise: quote.subsidyPaise,
      marginFlagged: quote.marginFlagged,
    };
    shipment.statusHistory.push({
      status: 'CONFIRMED',
      at: new Date(),
      actorUserId: shipment.createdByUserId,
      note: `Token paid (${payment.isSimulated ? 'SIMULATED' : 'TEST'} ${providerRef})`,
    });
    await shipment.save({ session: session ?? undefined });

    const { pool, liveEvent } = await addShipmentToPool({
      shipment,
      slot,
      corridor,
      actorUserId: userId,
      session,
    });

    return { payment, shipment, pool, liveEvent, deduplicated: false };
  });
}

export async function issueTokenRefund(params: {
  shipment: IShipment;
  reason: string;
  actorUserId: string;
  session: ClientSession | null;
}): Promise<IPayment | null> {
  const { shipment, reason, session } = params;

  const paidToken = await Payment.findOne({
    shipmentId: shipment._id,
    type: 'TOKEN',
    status: 'SUCCESS',
  }).session(session);

  if (!paidToken && (shipment.pricingSnapshot?.tokenPaidPaise ?? 0) <= 0) {
    return null;
  }

  const refundAmountPaise =
    paidToken?.amountPaise ?? shipment.pricingSnapshot?.tokenPaidPaise ?? 0;

  if (paidToken) {
    if (!isValidPaymentTransition(paidToken.status, 'REFUNDED')) {
      throw new HttpError(409, 'Token payment is not in a refundable state', 'INVALID_REFUND');
    }
    paidToken.status = 'REFUNDED';
    await paidToken.save({ session: session ?? undefined });
  }

  const refundRef = `REF-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
  const [refund] = await Payment.create(
    [
      {
        shipmentId: shipment._id,
        businessId: shipment.businessId,
        type: 'REFUND',
        amountPaise: refundAmountPaise,
        status: 'REFUNDED',
        mode: env.PAYMENT_MODE,
        isSimulated: env.PAYMENT_MODE === 'SIMULATED',
        providerRef: refundRef,
        refundReference: refundRef,
        refundReason: reason,
        actorUserId: shipment.createdByUserId,
        processedAt: new Date(),
      },
    ],
    { session: session ?? undefined }
  );

  shipment.tokenStatus = 'REFUNDED';
  return refund;
}

export async function cancelShipmentWithRefund(params: {
  shipmentId: string;
  businessId: Types.ObjectId;
  userId: string;
  reason: string;
}) {
  const { shipmentId, businessId, userId, reason } = params;
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

    if (!isValidShipmentTransition(shipment.status, 'CANCELLED')) {
      throw new HttpError(
        409,
        `Cannot cancel shipment from status ${shipment.status}`,
        'INVALID_TRANSITION'
      );
    }

    const wasCapacityReserved = ['CONFIRMED', 'POOLED', 'ROLLED_OVER'].includes(
      shipment.status
    );

    if (wasCapacityReserved) {
      await Slot.updateOne(
        { _id: shipment.slotId },
        {
          $inc: {
            reservedWeightKg: -shipment.cargo.chargeableWeightKg,
            reservedVolumeCbm: -shipment.cargo.volumeCbm,
          },
        },
        { session: session ?? undefined }
      );
      await removeShipmentFromPool({ shipment, session });
    }

    const refund = await issueTokenRefund({
      shipment,
      reason,
      actorUserId: userId,
      session,
    });

    shipment.status = 'CANCELLED';
    shipment.statusHistory.push({
      status: 'CANCELLED',
      at: new Date(),
      actorUserId: shipment.createdByUserId,
      note: `Cancelled: ${reason}`,
    });
    await shipment.save({ session: session ?? undefined });

    return { shipment, refund };
  });
}
