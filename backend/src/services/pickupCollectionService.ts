import crypto from 'node:crypto';
import { isValidObjectId, Types } from 'mongoose';
import { env } from '../config/env.js';
import { withTransaction } from '../config/database.js';
import { Payment } from '../models/Payment.js';
import {
  PickupCollection,
  type PickupPaymentMethod,
} from '../models/PickupCollection.js';
import { Shipment } from '../models/Shipment.js';
import { Trip } from '../models/Trip.js';
import { HttpError } from '../utils/errors.js';

export function computeRemainingPickupBalancePaise(params: {
  lockedPricePaise: number;
  tokenPaidPaise: number;
  otherPaidPaise?: number;
  adjustmentsPaise?: number;
}): number {
  const {
    lockedPricePaise,
    tokenPaidPaise,
    otherPaidPaise = 0,
    adjustmentsPaise = 0,
  } = params;
  return Math.max(
    0,
    Math.round(lockedPricePaise - tokenPaidPaise - otherPaidPaise - adjustmentsPaise)
  );
}

export async function recordPickupBalanceCollection(params: {
  tripId: string;
  shipmentId: string;
  driverUserId: string;
  paymentMethod: PickupPaymentMethod;
  adjustmentsPaise?: number;
  idempotencyKey?: string;
}) {
  const {
    tripId,
    shipmentId,
    driverUserId,
    paymentMethod,
    adjustmentsPaise = 0,
    idempotencyKey,
  } = params;

  if (!isValidObjectId(tripId) || !isValidObjectId(shipmentId)) {
    throw new HttpError(400, 'Invalid trip or shipment ID', 'VALIDATION_ERROR');
  }

  if (idempotencyKey) {
    const existingByKey = await PickupCollection.findOne({
      shipmentId,
      idempotencyKey,
    });
    if (existingByKey) {
      return { collection: existingByKey, deduplicated: true };
    }
  }

  return withTransaction(async (session) => {
    const trip = await Trip.findOne({ _id: tripId, driverId: driverUserId }).session(
      session
    );
    if (!trip) {
      throw new HttpError(403, 'Trip not found or not assigned to you', 'FORBIDDEN');
    }

    const shipment = await Shipment.findOne({
      _id: shipmentId,
      $or: [{ tripId: trip._id }, { _id: { $in: trip.shipmentIds } }],
    }).session(session);
    if (!shipment) {
      throw new HttpError(404, 'Shipment not found on this trip', 'NOT_FOUND');
    }

    const existingCollected = await PickupCollection.findOne({
      shipmentId: shipment._id,
      collectionState: 'COLLECTED_BY_DRIVER',
    }).session(session);
    if (existingCollected) {
      return { collection: existingCollected, deduplicated: true };
    }

    const lockedPricePaise =
      shipment.pricingSnapshot?.finalLockedPricePaise ??
      shipment.pricingSnapshot?.projectedPricePaise ??
      0;

    // Reconcile against persisted SUCCESS Payment records to prevent double-charging token or prior balance payments
    const validPayments = await Payment.find({
      shipmentId: shipment._id,
      status: 'SUCCESS',
      type: { $in: ['TOKEN', 'PICKUP_BALANCE'] },
    })
      .select('type amountPaise')
      .session(session);

    const tokenPaidFromPayments = validPayments
      .filter((p) => p.type === 'TOKEN')
      .reduce((sum, p) => sum + p.amountPaise, 0);
    const otherPaidFromPayments = validPayments
      .filter((p) => p.type !== 'TOKEN')
      .reduce((sum, p) => sum + p.amountPaise, 0);

    const tokenPaidPaise = Math.max(
      shipment.pricingSnapshot?.tokenPaidPaise ?? 0,
      tokenPaidFromPayments
    );

    const remainingBalancePaise = computeRemainingPickupBalancePaise({
      lockedPricePaise,
      tokenPaidPaise,
      otherPaidPaise: otherPaidFromPayments,
      adjustmentsPaise,
    });

    const isSimulated =
      env.PAYMENT_MODE === 'SIMULATED' || paymentMethod === 'SIMULATED_UPI';
    const providerRef = `${isSimulated ? 'SIM-BAL' : 'BAL'}-${crypto
      .randomBytes(5)
      .toString('hex')
      .toUpperCase()}`;

    let collection;
    try {
      const [created] = await PickupCollection.create(
        [
          {
            shipmentId: shipment._id,
            tripId: trip._id,
            businessId: shipment.businessId,
            collectedByDriverId: new Types.ObjectId(driverUserId),
            lockedPricePaise,
            tokenPaidPaise,
            adjustmentsPaise,
            remainingBalancePaise,
            collectedAmountPaise: remainingBalancePaise,
            paymentMethod,
            providerRef,
            collectionState: 'COLLECTED_BY_DRIVER',
            settlementState: 'PENDING_SETTLEMENT',
            isSimulated,
            ...(idempotencyKey ? { idempotencyKey } : {}),
            collectedAt: new Date(),
          },
        ],
        { session: session ?? undefined }
      );
      collection = created;
    } catch (err: unknown) {
      const isDup =
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code?: number }).code === 11000;
      if (isDup) {
        const dup = await PickupCollection.findOne({
          shipmentId: shipment._id,
          collectionState: 'COLLECTED_BY_DRIVER',
        }).session(session);
        if (dup) {
          return { collection: dup, deduplicated: true };
        }
      }
      throw err;
    }

    if (remainingBalancePaise > 0) {
      await Payment.create(
        [
          {
            shipmentId: shipment._id,
            businessId: shipment.businessId,
            type: 'PICKUP_BALANCE',
            amountPaise: remainingBalancePaise,
            status: 'SUCCESS',
            mode: env.PAYMENT_MODE,
            isSimulated,
            providerRef,
            actorUserId: new Types.ObjectId(driverUserId),
            processedAt: new Date(),
          },
        ],
        { session: session ?? undefined }
      );
    }

    if (shipment.pricingSnapshot) {
      shipment.pricingSnapshot.remainingBalancePaise = 0;
      await shipment.save({ session: session ?? undefined });
    }

    return { collection, deduplicated: false };
  });
}
