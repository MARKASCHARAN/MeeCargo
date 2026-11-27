import { Router } from 'express';
import { isValidObjectId } from 'mongoose';
import { z } from 'zod';
import { requireAuth, requireBusinessProfile, requireRole } from '../middleware/auth.js';
import { Corridor } from '../models/Corridor.js';
import { Payment } from '../models/Payment.js';
import { Shipment } from '../models/Shipment.js';
import { Slot } from '../models/Slot.js';
import {
  calculateCargoMetrics,
  CARGO_PRESETS,
} from '../services/cargoCalculator.js';
import {
  buildCsvTemplate,
  importShipmentsFromCsv,
} from '../services/csvImportService.js';
import { submitViabilityDecision } from '../services/cutoffService.js';
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
} from '../services/shipmentService.js';
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
  const schema = z.object({
    corridorId: z.string().min(1),
    slotId: z.string().min(1),
    chargeableWeightKg: z.number().positive(),
    isAnchorEligible: z.boolean().default(false),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success || !isValidObjectId(parsed.data.corridorId) || !isValidObjectId(parsed.data.slotId)) {
    throw new HttpError(400, 'Invalid quote preview request', 'VALIDATION_ERROR');
  }

  const [corridor, slot, rules] = await Promise.all([
    Corridor.findById(parsed.data.corridorId),
    Slot.findById(parsed.data.slotId),
    getActivePricingRules(),
  ]);

  if (!corridor || !slot) {
    throw new HttpError(404, 'Corridor or slot not found', 'NOT_FOUND');
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

  res.json({
    success: true,
    isEstimateFinal: false,
    breakdown,
  });
});

router.use(requireAuth, requireRole('SHIPPER'));

router.get('/import/template', async (_req, res) => {
  const openSlot = await Slot.findOne({ status: 'OPEN' }).sort({ plannedDepartureAt: 1 });
  const csv = buildCsvTemplate(openSlot?.slotCode);
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

router.get('/', requireBusinessProfile, async (req, res) => {
  const filter: Record<string, unknown> = {
    businessId: req.businessProfile!._id,
  };
  if (typeof req.query.status === 'string' && req.query.status) {
    filter.status = req.query.status;
  }
  if (typeof req.query.corridorId === 'string' && isValidObjectId(req.query.corridorId)) {
    filter.corridorId = req.query.corridorId;
  }

  const shipments = await Shipment.find(filter)
    .populate('corridorId', 'code name')
    .populate('slotId', 'slotCode label plannedDepartureAt cutoffAt')
    .sort({ createdAt: -1 });

  res.json({
    success: true,
    shipments,
  });
});

router.post('/', requireBusinessProfile, async (req, res) => {
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
    .populate('slotId', 'slotCode label plannedDepartureAt cutoffAt estimatedArrivalStartAt estimatedArrivalEndAt');

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
