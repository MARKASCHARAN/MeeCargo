import { Router } from 'express';
import { isValidObjectId } from 'mongoose';
import { z } from 'zod';
import { requireAuth, requireBusinessProfile, requireRole } from '../middleware/auth.js';
import { Corridor } from '../models/Corridor.js';
import { DeliveryProof } from '../models/DeliveryProof.js';
import { ExceptionEvent } from '../models/ExceptionEvent.js';
import { Payment } from '../models/Payment.js';
import { PickupCollection } from '../models/PickupCollection.js';
import { Shipment } from '../models/Shipment.js';
import { Slot, type ISlot } from '../models/Slot.js';
import {
  calculateCargoMetrics,
  CARGO_PRESETS,
} from '../services/cargoCalculator.js';
import {
  buildCsvTemplate,
  importShipmentsFromCsv,
} from '../services/csvImportService.js';
import { submitViabilityDecision } from '../services/cutoffService.js';
import { resolveShipmentException } from '../services/exceptionService.js';
import { getOperationalAndShipperMetrics } from '../services/metricsService.js';
import {
  cancelShipmentWithRefund,
  processTokenPayment,
} from '../services/paymentService.js';
import {
  calculateDeterministicPrice,
  getActivePricingRules,
} from '../services/pricingEngine.js';
import {
  confirmShipmentToken,
  createBookingSchema,
  createShipmentBooking,
  matchOperationalSlotForBooking,
  toServiceDateKey,
} from '../services/shipmentService.js';
import { serializeCsv } from '../utils/csv.js';
import { HttpError } from '../utils/errors.js';

const router = Router();

const calcWeightSchema = z.object({
  category: z.enum([
    'STANDARD_BOX',
    'SACK_BAG',
    'TEXTILE_ROLL',
    'PALLET_BUNDLE',
    'CUSTOM',
  ]),
  quantity: z.number().int().min(1).max(1000),
  length: z.number().positive(),
  width: z.number().positive(),
  height: z.number().positive(),
  dimensionUnit: z.enum(['CM', 'IN', 'M']).default('CM'),
  unitActualWeight: z.number().positive(),
  weightUnit: z.enum(['KG', 'G']).default('KG'),
});

router.get('/cargo-presets', requireAuth, (_req, res) => {
  res.json({
    success: true,
    presets: CARGO_PRESETS,
  });
});

router.post('/calculate-chargeable-weight', requireAuth, (req, res) => {
  const parsed = calcWeightSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(
      400,
      'Invalid cargo dimensions or weight',
      'VALIDATION_ERROR',
      parsed.error.flatten()
    );
  }
  const metrics = calculateCargoMetrics(parsed.data);
  res.json({
    success: true,
    metrics,
  });
});

router.post('/quote-preview', requireAuth, async (req, res) => {
  const schema = z
    .object({
      corridorId: z.string().min(1),
      slotId: z.string().min(1).optional(),
      serviceDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'serviceDate must be YYYY-MM-DD')
        .optional(),
      chargeableWeightKg: z.number().positive(),
      volumeCbm: z.number().nonnegative().optional(),
      isAnchorEligible: z.boolean().default(false),
    })
    .refine((d) => Boolean(d.slotId || d.serviceDate), {
      message: 'serviceDate or slotId is required',
      path: ['serviceDate'],
    });
  const parsed = schema.safeParse(req.body);
  if (
    !parsed.success ||
    !isValidObjectId(parsed.data.corridorId) ||
    (parsed.data.slotId && !isValidObjectId(parsed.data.slotId))
  ) {
    throw new HttpError(400, 'Invalid quote preview request', 'VALIDATION_ERROR');
  }

  const [corridor, rules] = await Promise.all([
    Corridor.findById(parsed.data.corridorId),
    getActivePricingRules(),
  ]);

  if (!corridor) {
    throw new HttpError(404, 'Corridor not found', 'NOT_FOUND');
  }

  let slot: ISlot | null = parsed.data.slotId
    ? ((await Slot.findById(parsed.data.slotId)) as ISlot | null)
    : null;
  if (!slot && parsed.data.serviceDate) {
    try {
      slot = await matchOperationalSlotForBooking({
        corridorId: corridor._id,
        serviceDate: parsed.data.serviceDate,
        chargeableWeightKg: parsed.data.chargeableWeightKg,
        volumeCbm: parsed.data.volumeCbm ?? 0,
      });
    } catch {
      const candidateSlots = await Slot.find({
        corridorId: corridor._id,
        status: { $in: ['OPEN', 'LOCKING', 'LOCKED'] },
      }).sort({ plannedDepartureAt: 1 });
      slot =
        (candidateSlots.find(
          (s) => toServiceDateKey(s.departureDate) === parsed.data.serviceDate
        ) as ISlot | undefined) ?? null;
    }
  }

  if (!slot) {
    throw new HttpError(404, 'Corridor service date or pool not found', 'NOT_FOUND');
  }

  const weightUtil = (slot.reservedWeightKg / slot.capacityWeightKg) * 100;
  const volUtil = (slot.reservedVolumeCbm / slot.capacityVolumeCbm) * 100;

  const breakdown = calculateDeterministicPrice({
    chargeableWeightKg: parsed.data.chargeableWeightKg,
    baseRatePaisePerKg: corridor.baseRatePaisePerKg,
    guaranteedCeilingPaisePerKg: corridor.guaranteedCeilingPaisePerKg,
    weightUtilizationPct: weightUtil,
    volumeUtilizationPct: volUtil,
    isAnchorEligible: parsed.data.isAnchorEligible,
    rules,
    allowSubsidy: true,
  });

  // Preview reflects standard refundable token deduction so remaining balance is accurate
  breakdown.remainingBalancePaise = Math.max(
    0,
    breakdown.computedPricePaise - breakdown.tokenAmountPaise
  );

  res.json({
    success: true,
    isEstimateFinal: false,
    breakdown,
  });
});

router.use(requireAuth, requireRole('SHIPPER'));

router.get('/import/template', async (_req, res) => {
  const openSlot = await Slot.findOne({ status: 'OPEN' }).sort({ plannedDepartureAt: 1 });
  const csv = buildCsvTemplate(
    openSlot ? toServiceDateKey(openSlot.departureDate) : undefined
  );
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="meecargo-shipments-template.csv"');
  res.send(csv);
});

router.post('/import/csv', requireBusinessProfile, async (req, res) => {
  const schema = z.object({
    csvText: z.string().min(1, 'csvText is required').max(1_000_000),
    dryRun: z.boolean().default(false),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(400, 'Invalid CSV import payload', 'VALIDATION_ERROR');
  }

  const report = await importShipmentsFromCsv({
    csvText: parsed.data.csvText,
    business: req.businessProfile!,
    userId: req.auth!.userId,
    dryRun: parsed.data.dryRun,
  });

  res.status(parsed.data.dryRun ? 200 : 201).json({
    success: true,
    ...report,
  });
});

const STATUS_GROUP_MAP: Record<string, string[]> = {
  UPCOMING: ['DRAFT', 'PENDING_TOKEN', 'CONFIRMED', 'POOLED', 'LOCKED'],
  ACTIVE: ['PICKED_UP', 'IN_TRANSIT', 'AT_DESTINATION'],
  DELIVERED: ['DELIVERED'],
  FAILED: ['FAILED'],
  CANCELLED: ['CANCELLED'],
  ROLLED_OVER: ['ROLLED_OVER'],
};

function buildShipmentQueryFilter(
  businessId: unknown,
  query: Record<string, unknown>
): Record<string, unknown> {
  const filter: Record<string, unknown> = { businessId };

  if (typeof query.status === 'string' && query.status) {
    filter.status = query.status;
  } else if (typeof query.statusGroup === 'string' && STATUS_GROUP_MAP[query.statusGroup]) {
    filter.status = { $in: STATUS_GROUP_MAP[query.statusGroup] };
  }

  if (typeof query.corridorId === 'string' && isValidObjectId(query.corridorId)) {
    filter.corridorId = query.corridorId;
  }

  if (typeof query.fromDate === 'string' || typeof query.toDate === 'string') {
    const createdAt: Record<string, Date> = {};
    if (typeof query.fromDate === 'string' && query.fromDate) {
      const d = new Date(query.fromDate);
      if (!Number.isNaN(d.getTime())) createdAt.$gte = d;
    }
    if (typeof query.toDate === 'string' && query.toDate) {
      const d = new Date(query.toDate);
      if (!Number.isNaN(d.getTime())) {
        d.setHours(23, 59, 59, 999);
        createdAt.$lte = d;
      }
    }
    if (Object.keys(createdAt).length > 0) {
      filter.createdAt = createdAt;
    }
  }

  return filter;
}

router.get('/analytics/impact', requireBusinessProfile, async (req, res) => {
  const metrics = await getOperationalAndShipperMetrics({
    businessId: req.businessProfile!._id,
  });
  res.json({ success: true, metrics });
});

router.get('/export/csv', requireBusinessProfile, async (req, res) => {
  const filter = buildShipmentQueryFilter(req.businessProfile!._id, req.query);
  const shipments = await Shipment.find(filter)
    .populate('corridorId', 'code name')
    .populate('slotId', 'slotCode plannedDepartureAt')
    .sort({ createdAt: -1 })
    .lean();

  const headers = [
    'reference',
    'externalOrderRef',
    'status',
    'tokenStatus',
    'corridorCode',
    'slotCode',
    'pickupStopCode',
    'deliveryStopCode',
    'recipientName',
    'chargeableWeightKg',
    'volumeCbm',
    'projectedOrLockedInr',
    'tokenPaidInr',
    'remainingBalanceInr',
    'createdAt',
  ];

  const rows = shipments.map((s) => {
    const corridor = s.corridorId as unknown as { code?: string } | null;
    const slot = s.slotId as unknown as { slotCode?: string } | null;
    const price =
      s.pricingSnapshot?.finalLockedPricePaise ??
      s.pricingSnapshot?.projectedPricePaise ??
      0;
    return {
      reference: s.reference,
      externalOrderRef: s.externalOrderRef ?? '',
      status: s.status,
      tokenStatus: s.tokenStatus,
      corridorCode: corridor?.code ?? '',
      slotCode: slot?.slotCode ?? '',
      pickupStopCode: s.pickupStopCode,
      deliveryStopCode: s.deliveryStopCode,
      recipientName: s.recipientName,
      chargeableWeightKg: s.cargo.chargeableWeightKg,
      volumeCbm: s.cargo.volumeCbm,
      projectedOrLockedInr: (price / 100).toFixed(2),
      tokenPaidInr: ((s.pricingSnapshot?.tokenPaidPaise ?? 0) / 100).toFixed(2),
      remainingBalanceInr: ((s.pricingSnapshot?.remainingBalancePaise ?? 0) / 100).toFixed(2),
      createdAt: new Date(s.createdAt).toISOString(),
    };
  });

  const csv = serializeCsv(headers, rows);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="meecargo-shipments-export.csv"');
  res.send(csv);
});

router.get('/', requireBusinessProfile, async (req, res) => {
  const filter = buildShipmentQueryFilter(req.businessProfile!._id, req.query);

  const shipments = await Shipment.find(filter)
    .populate('corridorId', 'code name')
    .populate('slotId', 'slotCode label departureDate plannedDepartureAt cutoffAt')
    .sort({ createdAt: -1 })
    .lean();

  const ids = shipments.map((s) => s._id);
  const [proofs, collections] = await Promise.all([
    DeliveryProof.find({ shipmentId: { $in: ids } }).lean(),
    PickupCollection.find({ shipmentId: { $in: ids } }).lean(),
  ]);

  const proofByShipment = new Map(proofs.map((p) => [String(p.shipmentId), p]));
  const collectionByShipment = new Map(
    collections.map((c) => [String(c.shipmentId), c])
  );

  const enriched = shipments.map((s) => {
    const proof = proofByShipment.get(String(s._id));
    const collection = collectionByShipment.get(String(s._id));
    return {
      ...s,
      podSummary: proof?.verifiedAt
        ? {
            confirmationMode: proof.confirmationMode,
            verifiedAt: proof.verifiedAt,
            b2bSignOffName: proof.b2bSignOffName,
            photoUrl: proof.photoAccessToken
              ? `/api/v1/track/pod-photo/${proof.photoAccessToken}?trackingToken=${encodeURIComponent(
                  s.trackingToken
                )}`
              : null,
          }
        : null,
      pickupCollectionSummary: collection
        ? {
            collectionState: collection.collectionState,
            settlementState: collection.settlementState,
            collectedAmountPaise: collection.collectedAmountPaise,
            paymentMethod: collection.paymentMethod,
            providerRef: collection.providerRef,
            isSimulated: collection.isSimulated,
          }
        : null,
    };
  });

  res.json({
    success: true,
    shipments: enriched,
  });
});

router.post('/', requireBusinessProfile, async (req, res) => {
  if (
    req.body &&
    typeof req.body === 'object' &&
    ('slotId' in req.body || 'poolId' in req.body || 'driverId' in req.body)
  ) {
    throw new HttpError(
      400,
      'Shippers cannot select driver pickup slots, pools, or drivers; choose an operating serviceDate instead.',
      'DRIVER_SLOT_SELECTION_FORBIDDEN'
    );
  }

  const parsed = createBookingSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(
      400,
      'Invalid shipment booking payload',
      'VALIDATION_ERROR',
      parsed.error.flatten()
    );
  }

  const result = await createShipmentBooking({
    business: req.businessProfile!,
    userId: req.auth!.userId,
    input: parsed.data,
  });

  res.status(result.deduplicated ? 200 : 201).json({
    success: true,
    deduplicated: result.deduplicated,
    shipment: result.shipment,
  });
});

router.post('/:shipmentId/confirm-token', requireBusinessProfile, async (req, res) => {
  const shipmentId = Array.isArray(req.params.shipmentId)
    ? req.params.shipmentId[0]
    : req.params.shipmentId;
  const result = await confirmShipmentToken({
    businessId: req.businessProfile!._id,
    shipmentId,
    userId: req.auth!.userId,
  });

  res.json({
    success: true,
    alreadyConfirmed: result.alreadyConfirmed,
    shipment: result.shipment,
  });
});

router.post('/:shipmentId/pay-token', requireBusinessProfile, async (req, res) => {
  const shipmentId = Array.isArray(req.params.shipmentId)
    ? req.params.shipmentId[0]
    : req.params.shipmentId;
  const schema = z.object({
    idempotencyKey: z.string().trim().min(4).max(120).optional(),
    simulateOutcome: z.enum(['SUCCESS', 'FAILED']).default('SUCCESS'),
  });
  const parsed = schema.safeParse(req.body ?? {});
  if (!parsed.success) {
    throw new HttpError(400, 'Invalid token payment request', 'VALIDATION_ERROR');
  }

  const result = await processTokenPayment({
    shipmentId,
    businessId: req.businessProfile!._id,
    userId: req.auth!.userId,
    idempotencyKey: parsed.data.idempotencyKey,
    simulateOutcome: parsed.data.simulateOutcome,
  });

  res.json({
    success: true,
    deduplicated: result.deduplicated,
    payment: result.payment,
    shipment: result.shipment,
    pool: 'pool' in result ? result.pool : undefined,
  });
});

router.post('/:shipmentId/cancel', requireBusinessProfile, async (req, res) => {
  const shipmentId = Array.isArray(req.params.shipmentId)
    ? req.params.shipmentId[0]
    : req.params.shipmentId;
  const schema = z.object({
    reason: z.string().trim().min(3).max(300).default('Cancelled by shipper'),
  });
  const parsed = schema.safeParse(req.body ?? {});
  const reason = parsed.success ? parsed.data.reason : 'Cancelled by shipper';

  const result = await cancelShipmentWithRefund({
    shipmentId,
    businessId: req.businessProfile!._id,
    userId: req.auth!.userId,
    reason,
  });

  res.json({
    success: true,
    shipment: result.shipment,
    refund: result.refund,
  });
});

router.post('/:shipmentId/viability-decision', requireBusinessProfile, async (req, res) => {
  const shipmentId = Array.isArray(req.params.shipmentId)
    ? req.params.shipmentId[0]
    : req.params.shipmentId;
  const schema = z.object({
    decision: z.enum(['ROLLOVER', 'REFUND']),
    targetSlotId: z.string().optional(),
    targetServiceDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'targetServiceDate must be YYYY-MM-DD')
      .optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(400, 'Invalid viability decision', 'VALIDATION_ERROR');
  }

  const result = await submitViabilityDecision({
    shipmentId,
    businessId: req.businessProfile!._id,
    userId: req.auth!.userId,
    decision: parsed.data.decision,
    targetSlotId: parsed.data.targetSlotId,
    targetServiceDate: parsed.data.targetServiceDate,
  });

  res.json({
    success: true,
    ...result,
  });
});

router.get('/:shipmentId/payments', requireBusinessProfile, async (req, res) => {
  const shipmentId = Array.isArray(req.params.shipmentId)
    ? req.params.shipmentId[0]
    : req.params.shipmentId;
  if (!isValidObjectId(shipmentId)) {
    throw new HttpError(400, 'Invalid shipment ID', 'VALIDATION_ERROR');
  }

  const shipment = await Shipment.findOne({
    _id: shipmentId,
    businessId: req.businessProfile!._id,
  });
  if (!shipment) {
    throw new HttpError(403, 'Shipment not found for your business', 'FORBIDDEN');
  }

  const payments = await Payment.find({
    shipmentId: shipment._id,
    businessId: req.businessProfile!._id,
  }).sort({ createdAt: -1 });

  res.json({
    success: true,
    payments,
  });
});

router.post('/:shipmentId/revoke-tracking', requireBusinessProfile, async (req, res) => {
  const shipmentId = Array.isArray(req.params.shipmentId)
    ? req.params.shipmentId[0]
    : req.params.shipmentId;
  if (!isValidObjectId(shipmentId)) {
    throw new HttpError(400, 'Invalid shipment ID', 'VALIDATION_ERROR');
  }

  const shipment = await Shipment.findOneAndUpdate(
    { _id: shipmentId, businessId: req.businessProfile!._id },
    { $set: { trackingTokenRevokedAt: new Date() } },
    { returnDocument: 'after' }
  );
  if (!shipment) {
    throw new HttpError(403, 'Shipment not found for your business', 'FORBIDDEN');
  }

  res.json({
    success: true,
    shipment,
  });
});

router.get('/:shipmentId/exceptions', requireBusinessProfile, async (req, res) => {
  const shipmentId = Array.isArray(req.params.shipmentId)
    ? req.params.shipmentId[0]
    : req.params.shipmentId;
  if (!isValidObjectId(shipmentId)) {
    throw new HttpError(400, 'Invalid shipment ID', 'VALIDATION_ERROR');
  }

  const shipment = await Shipment.findOne({
    _id: shipmentId,
    businessId: req.businessProfile!._id,
  });
  if (!shipment) {
    throw new HttpError(403, 'Shipment not found for your business', 'FORBIDDEN');
  }

  const exceptions = await ExceptionEvent.find({ shipmentId: shipment._id }).sort({
    createdAt: -1,
  });
  res.json({
    success: true,
    exceptions,
  });
});

router.post('/exceptions/:exceptionId/resolve', requireBusinessProfile, async (req, res) => {
  const exceptionId = Array.isArray(req.params.exceptionId)
    ? req.params.exceptionId[0]
    : req.params.exceptionId;
  const schema = z.object({
    action: z.enum(['RESCHEDULE', 'RETURN', 'REALLOCATE']),
    targetSlotId: z.string().trim().optional(),
    targetServiceDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    note: z.string().trim().max(300).optional(),
  });
  const parsed = schema.safeParse(req.body ?? {});
  if (!parsed.success) {
    throw new HttpError(400, 'Invalid exception resolution payload', 'VALIDATION_ERROR');
  }

  const result = await resolveShipmentException({
    exceptionId,
    businessId: req.businessProfile!._id,
    userId: req.auth!.userId,
    action: parsed.data.action,
    targetSlotId: parsed.data.targetSlotId || undefined,
    targetServiceDate: parsed.data.targetServiceDate || undefined,
    note: parsed.data.note,
  });

  res.json({
    success: true,
    ...result,
  });
});

router.get('/:shipmentId', requireBusinessProfile, async (req, res) => {
  const shipmentId = Array.isArray(req.params.shipmentId)
    ? req.params.shipmentId[0]
    : req.params.shipmentId;
  if (!isValidObjectId(shipmentId)) {
    throw new HttpError(400, 'Invalid shipment ID', 'VALIDATION_ERROR');
  }

  const shipment = await Shipment.findOne({
    _id: shipmentId,
    businessId: req.businessProfile!._id,
  })
    .populate('corridorId', 'code name stops')
    .populate('slotId', 'slotCode label departureDate plannedDepartureAt cutoffAt estimatedArrivalStartAt estimatedArrivalEndAt');

  if (!shipment) {
    throw new HttpError(
      403,
      'Shipment not found or does not belong to your business',
      'FORBIDDEN'
    );
  }

  res.json({
    success: true,
    shipment,
  });
});

export default router;
