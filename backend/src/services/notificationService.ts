import { Types } from 'mongoose';
import { env } from '../config/env.js';
import { NotificationLog } from '../models/NotificationLog.js';
import { logger } from '../utils/logger.js';

export type NotificationEventType =
  | 'BOOKING_CONFIRMED'
  | 'TOKEN_PAYMENT_SUCCESS'
  | 'POOL_CUTOFF_APPROACHING'
  | 'POOL_LOCKED'
  | 'TRIP_ASSIGNED'
  | 'SHIPMENT_PICKED_UP'
  | 'SHIPMENT_IN_TRANSIT'
  | 'DRIVER_APPROACHING'
  | 'DELIVERY_COMPLETED'
  | 'DELIVERY_FAILED'
  | 'ROLLOVER_REFUND_REQUIRED'
  | 'POOLING_WINDOW_OPEN'
  | 'MARKETPLACE_OFFER'
  | 'TIER2_EARNING_SETTLED'
  | 'EXPRESS_UNFILLED';

export interface NotificationTemplate {
  title: (vars: Record<string, string>) => string;
  body: (vars: Record<string, string>) => string;
}

export const NOTIFICATION_TEMPLATES: Record<
  NotificationEventType,
  NotificationTemplate
> = {
  BOOKING_CONFIRMED: {
    title: (v) => `Booking ${v.reference} confirmed`,
    body: (v) =>
      `Your booking ${v.reference} is confirmed for slot ${v.slotCode ?? ''}. Track: ${v.trackingUrl ?? ''}`,
  },
  TOKEN_PAYMENT_SUCCESS: {
    title: (v) => `Token payment received for ${v.reference}`,
    body: (v) =>
      `Refundable token (${v.amount ?? ''}) received (${v.mode ?? 'SIMULATED'}).`,
  },
  POOL_CUTOFF_APPROACHING: {
    title: (v) => `Pool cutoff approaching for ${v.slotCode}`,
    body: (v) =>
      `Current utilization: ${v.weightPct ?? '0'}% weight / ${v.volumePct ?? '0'}% volume.`,
  },
  POOL_LOCKED: {
    title: (v) => `Pool locked & final price confirmed (${v.reference})`,
    body: (v) =>
      `Final locked charge is ${v.finalPrice ?? ''}; pickup balance ${v.balance ?? ''}.`,
  },
  TRIP_ASSIGNED: {
    title: (v) => `Vehicle & driver assigned (${v.tripCode})`,
    body: (v) =>
      `Shipment ${v.reference} assigned to ${v.vehicleReg ?? 'vehicle'}.`,
  },
  SHIPMENT_PICKED_UP: {
    title: (v) => `Shipment ${v.reference} picked up`,
    body: (v) =>
      `Cargo verified via QR at pickup. Live tracking: ${v.trackingUrl ?? ''}`,
  },
  SHIPMENT_IN_TRANSIT: {
    title: (v) => `Shipment ${v.reference} is in transit`,
    body: (v) =>
      `Your shipment is en route to ${v.stopCode ?? 'destination'}. Track: ${v.trackingUrl ?? ''}`,
  },
  DRIVER_APPROACHING: {
    title: (v) => `Driver approaching ${v.stopCode ?? 'destination'}`,
    body: (v) =>
      `Shipment ${v.reference} is arriving soon. Keep delivery OTP ready if applicable.`,
  },
  DELIVERY_COMPLETED: {
    title: (v) => `Shipment ${v.reference} delivered`,
    body: (v) =>
      `Delivery verified at ${v.stopCode ?? 'destination'} (${v.mode ?? 'POD'}).`,
  },
  DELIVERY_FAILED: {
    title: (v) => `Delivery attempt failed for ${v.reference}`,
    body: (v) =>
      `Reason: ${v.reason ?? 'See trip updates'}. Please review reschedule/return options.`,
  },
  ROLLOVER_REFUND_REQUIRED: {
    title: (v) => `Action required for ${v.reference}`,
    body: () =>
      `New route below viability threshold. Choose slot rollover or full token refund.`,
  },
  POOLING_WINDOW_OPEN: {
    title: (v) => `Pooling window open: ${v.corridorCode} (${v.slotLabel ?? ''})`,
    body: (v) =>
      `Select pickup/return availability for ${v.corridorName ?? v.corridorCode} (${v.departureDate ?? ''}) before cutoff ${v.cutoffTime ?? ''}.`,
  },
  MARKETPLACE_OFFER: {
    title: (v) => `New ${v.opportunityType ?? 'Marketplace'} offer: ${v.opportunityCode}`,
    body: (v) =>
      `${v.route ?? ''} | Fixed payout ${v.payout ?? ''} | Respond before ${v.expiresAt ?? ''}.`,
  },
  TIER2_EARNING_SETTLED: {
    title: (v) => `Tier 2 payout settled (${v.earningCode})`,
    body: (v) =>
      `Simulated settlement ${v.settlementRef ?? ''} completed for ${v.amount ?? ''} on trip ${v.tripCode ?? ''}.`,
  },
  EXPRESS_UNFILLED: {
    title: (v) => `Express booking ${v.reference} expired unfilled`,
    body: (v) =>
      `No eligible Tier 2 vehicle accepted within the window. Full refund (${v.refundRef ?? 'initiated'}) processed.`,
  },
};

export function getExternalChannelAvailability() {
  return {
    sms: { configured: false, reason: 'SMS gateway not configured in prototype' },
    whatsapp: {
      configured: false,
      reason: 'WhatsApp Business API not configured in prototype',
    },
    activeProvider: env.NOTIFICATION_PROVIDER,
  };
}

/**
 * Dispatches deduplicated, template-rendered notifications without ever throwing
 * into critical shipment/trip state transitions.
 */
export async function sendLifecycleNotification(params: {
  eventType: NotificationEventType;
  dedupeKey: string;
  recipientUserId?: Types.ObjectId | string;
  recipientContact?: string;
  vars: Record<string, string>;
  metadata?: Record<string, unknown>;
}): Promise<{ dispatched: boolean; deduplicated: boolean }> {
  try {
    const template = NOTIFICATION_TEMPLATES[params.eventType];
    const title = template.title(params.vars);
    const message = template.body(params.vars);

    const existing = await NotificationLog.findOne({ dedupeKey: params.dedupeKey });
    if (existing) {
      return { dispatched: false, deduplicated: true };
    }

    const channel = env.NOTIFICATION_PROVIDER === 'WEBHOOK' ? 'WEBHOOK' : 'CONSOLE';

    await NotificationLog.create({
      ...(params.recipientUserId
        ? { recipientUserId: new Types.ObjectId(String(params.recipientUserId)) }
        : {}),
      ...(params.recipientContact ? { recipientContact: params.recipientContact } : {}),
      channel,
      eventType: params.eventType,
      title,
      message,
      dedupeKey: params.dedupeKey,
      metadata: {
        ...params.metadata,
        externalChannels: getExternalChannelAvailability(),
      },
    });

    if (env.NODE_ENV !== 'test') {
      logger.info(`[Notification:${channel}] ${params.eventType}`, {
        recipient: params.recipientContact ?? params.recipientUserId ?? 'recipient',
        title,
      });
    }

    return { dispatched: true, deduplicated: false };
  } catch (error) {
    logger.warn('[Notification] Non-fatal dispatch failure', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { dispatched: false, deduplicated: false };
  }
}
