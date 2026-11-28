import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { Corridor } from '../models/Corridor.js';
import { readDriverDocumentLocal } from '../services/driverDocumentStorage.js';
import {
  createCorridorForOwner,
  createOrUpdateDriverContract,
  getTier1DriverByIdForOwner,
  listAllTier1DriversForOwner,
  listCorridorsForOwner,
  registerTier1ContractDriver,
  resetTier1DriverPassword,
  toggleCorridorActiveStatus,
  updateCentralCorridorSchedule,
  updateCorridorForOwner,
  updateTier1DriverStatus,
  upsertDriverOwnedVehicle,
} from '../services/platformOwnerService.js';
import {
  approveTier2Application,
  getTier2ApplicationDetailForOwner,
  listTier2ApplicationsForOwner,
  rejectTier2Application,
} from '../services/tier2ApplicationService.js';
import {
  evaluatePoolForMarketplaceOpportunities,
  handleTier2CancellationOrBreakdownReassignment,
  listMarketplaceOpportunitiesForOwner,
} from '../services/hybridOrchestratorService.js';
import {
  getActiveMarketplacePolicy,
  holdOrReverseTier2Earning,
  listOwnerTier2Earnings,
  settleTier2Earning,
  updateMarketplacePolicyForOwner,
} from '../services/tier2PayoutService.js';
import { HttpError } from '../utils/errors.js';

const router = Router();

router.use(requireAuth, requireRole('PLATFORM_OWNER'));

const driverOwnedVehicleSchema = z.object({
  registrationNumber: z.string().trim().min(4).max(30),
  vehicleCategory: z.string().trim().min(2).max(80),
  bodyType: z.enum(['CLOSED_BODY', 'OPEN_BODY', 'CONTAINER', 'FLATBED', 'MINI_PICKUP']),
  maxWeightKg: z.coerce.number().min(100),
  bedLengthCm: z.coerce.number().min(50),
  bedWidthCm: z.coerce.number().min(50),
  bedHeightCm: z.coerce.number().min(50),
  maxVolumeCbm: z.coerce.number().positive().optional(),
  operationalStatus: z
    .enum(['ACTIVE', 'INACTIVE', 'MAINTENANCE', 'SUSPENDED'])
    .default('ACTIVE'),
  rcNumber: z.string().trim().max(40).optional(),
  insurancePolicyNumber: z.string().trim().max(60).optional(),
  insuranceValidUntil: z.coerce.date().optional(),
  fitnessValidUntil: z.coerce.date().optional(),
  permitNotes: z.string().trim().max(200).optional(),
  verificationStatus: z.enum(['PENDING', 'VERIFIED', 'REJECTED']).default('PENDING'),
  operatingRestrictions: z.array(z.string().trim()).optional(),
});

const registerContractDriverSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email(),
  phone: z.string().trim().min(8).max(20),
  password: z.string().min(8).max(128),
  licenseNumber: z.string().trim().max(40).optional(),
  homeBase: z.string().trim().max(120).optional(),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  minGuaranteePaise: z.number().int().min(0),
  perKmRatePaise: z.number().int().min(0),
  guaranteedMonthlyDays: z.number().int().min(1).max(31).optional(),
  notes: z.string().trim().max(400).optional(),
  eligibleCorridorIds: z.array(z.string().trim()).default([]),
  vehicle: driverOwnedVehicleSchema,
});

const contractPayloadSchema = z.object({
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  minGuaranteePaise: z.number().int().min(0),
  perKmRatePaise: z.number().int().min(0),
  guaranteedMonthlyDays: z.number().int().min(1).max(31).optional(),
  notes: z.string().trim().max(400).optional(),
  eligibleCorridorIds: z.array(z.string().trim()).default([]),
  status: z
    .enum(['DRAFT', 'ACTIVE', 'SUSPENDED', 'INACTIVE', 'EXPIRED', 'TERMINATED'])
    .default('ACTIVE'),
  changeNote: z.string().trim().max(400).optional(),
});

const corridorScheduleSlotSchema = z.object({
  slotNumber: z.union([z.literal(1), z.literal(2)]),
  slotCodeSuffix: z.string().trim().min(2).max(20),
  label: z.string().trim().min(2).max(120),
  outboundPickupTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
  returnTimeOptions: z.array(z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/)).min(1),
  defaultReturnTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
  returnTimeLocked: z.boolean(),
  lockedReturnTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):([0-5]\d)$/)
    .optional(),
});

const corridorStopSchema = z.object({
  stopCode: z.string().trim().min(2).max(20),
  name: z.string().trim().min(2).max(120),
  district: z.string().trim().min(2).max(100),
  state: z.string().trim().min(2).max(80).default('Gujarat'),
  sequenceOrder: z.coerce.number().int().min(0),
  location: z.object({
    type: z.literal('Point').default('Point'),
    coordinates: z.tuple([
      z.coerce.number().min(-180).max(180),
      z.coerce.number().min(-90).max(90),
    ]),
  }),
});

const weekdayEnum = z.enum(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']);

const createCorridorSchema = z.object({
  code: z.string().trim().min(3).max(40),
  name: z.string().trim().min(3).max(160),
  description: z.string().trim().max(500).optional(),
  stops: z.array(corridorStopSchema).min(2),
  operatingDays: z.array(weekdayEnum).min(1),
  slotSchedules: z.array(corridorScheduleSlotSchema).length(2),
  estimatedOutboundDurationMin: z.coerce.number().int().min(30).max(720).optional(),
  turnaroundBufferMin: z.coerce.number().int().min(0).max(240).optional(),
  guaranteedCeilingPaisePerKg: z.coerce.number().int().min(100),
  baseRatePaisePerKg: z.coerce.number().int().min(100),
  viabilityThresholdPct: z.coerce.number().min(0).max(100).default(50),
  isActive: z.boolean().default(true),
  generateInitialDaysAhead: z.coerce.number().int().min(0).max(14).optional(),
});

const updateCorridorSchema = z.object({
  name: z.string().trim().min(3).max(160).optional(),
  description: z.string().trim().max(500).optional(),
  stops: z.array(corridorStopSchema).min(2).optional(),
  operatingDays: z.array(weekdayEnum).min(1).optional(),
  slotSchedules: z.array(corridorScheduleSlotSchema).length(2).optional(),
  estimatedOutboundDurationMin: z.coerce.number().int().min(30).max(720).optional(),
  turnaroundBufferMin: z.coerce.number().int().min(0).max(240).optional(),
  guaranteedCeilingPaisePerKg: z.coerce.number().int().min(100).optional(),
  baseRatePaisePerKg: z.coerce.number().int().min(100).optional(),
  viabilityThresholdPct: z.coerce.number().min(0).max(100).optional(),
});

router.get('/catalog', async (_req, res) => {
  const corridors = await Corridor.find({ isActive: true })
    .select('code name stops operatingDays slotSchedules')
    .sort({ code: 1 });

  res.json({
    success: true,
    corridors,
  });
});

router.get('/corridors', async (req, res) => {
  const statusRaw = typeof req.query.status === 'string' ? req.query.status.toUpperCase() : undefined;
  const sortByRaw = typeof req.query.sortBy === 'string' ? req.query.sortBy : undefined;
  const sortOrderRaw = typeof req.query.sortOrder === 'string' ? req.query.sortOrder : undefined;
  const operatingDayRaw =
    typeof req.query.operatingDay === 'string' ? req.query.operatingDay.toUpperCase() : undefined;

  const statusParsed = statusRaw
    ? z.enum(['ALL', 'ACTIVE', 'INACTIVE']).safeParse(statusRaw)
    : null;
  if (statusParsed && !statusParsed.success) {
    throw new HttpError(400, 'Invalid corridor status filter', 'VALIDATION_ERROR');
  }
  const opDayParsed = operatingDayRaw ? weekdayEnum.safeParse(operatingDayRaw) : null;
  if (opDayParsed && !opDayParsed.success) {
    throw new HttpError(400, 'Invalid operatingDay filter', 'VALIDATION_ERROR');
  }
  const sortByParsed = sortByRaw
    ? z.enum(['name', 'code', 'updatedAt']).safeParse(sortByRaw)
    : null;
  if (sortByParsed && !sortByParsed.success) {
    throw new HttpError(400, 'Invalid sortBy option', 'VALIDATION_ERROR');
  }
  const sortOrderParsed = sortOrderRaw
    ? z.enum(['asc', 'desc']).safeParse(sortOrderRaw)
    : null;
  if (sortOrderParsed && !sortOrderParsed.success) {
    throw new HttpError(400, 'Invalid sortOrder option', 'VALIDATION_ERROR');
  }

  const result = await listCorridorsForOwner(req.auth!.userId, {
    status: statusParsed?.success ? statusParsed.data : 'ALL',
    origin: typeof req.query.origin === 'string' ? req.query.origin : undefined,
    destination: typeof req.query.destination === 'string' ? req.query.destination : undefined,
    operatingDay: opDayParsed?.success ? opDayParsed.data : undefined,
    q: typeof req.query.q === 'string' ? req.query.q : undefined,
    sortBy: sortByParsed?.success ? sortByParsed.data : 'code',
    sortOrder: sortOrderParsed?.success ? sortOrderParsed.data : undefined,
  });

  res.json({
    success: true,
    corridors: result.corridors,
    facets: result.facets,
  });
});

router.post('/corridors', async (req, res) => {
  const parsed = createCorridorSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(
      400,
      'Invalid corridor creation payload',
      'VALIDATION_ERROR',
      parsed.error.flatten()
    );
  }

  const result = await createCorridorForOwner({
    platformOwnerId: req.auth!.userId,
    input: parsed.data,
  });

  res.status(201).json({
    success: true,
    ...result,
  });
});

router.put('/corridors/:corridorId', async (req, res) => {
  const corridorId = Array.isArray(req.params.corridorId)
    ? req.params.corridorId[0]
    : req.params.corridorId;

  const parsed = updateCorridorSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(
      400,
      'Invalid corridor update payload',
      'VALIDATION_ERROR',
      parsed.error.flatten()
    );
  }

  const result = await updateCorridorForOwner({
    platformOwnerId: req.auth!.userId,
    corridorId,
    input: parsed.data,
  });

  res.json({
    success: true,
    ...result,
  });
});

router.patch('/corridors/:corridorId/status', async (req, res) => {
  const corridorId = Array.isArray(req.params.corridorId)
    ? req.params.corridorId[0]
    : req.params.corridorId;

  const parsed = z
    .object({
      isActive: z.boolean(),
      ensureDaysAhead: z.coerce.number().int().min(0).max(14).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(400, 'Invalid corridor status payload', 'VALIDATION_ERROR');
  }

  const result = await toggleCorridorActiveStatus({
    platformOwnerId: req.auth!.userId,
    corridorId,
    isActive: parsed.data.isActive,
    ensureDaysAhead: parsed.data.ensureDaysAhead,
  });

  res.json({
    success: true,
    ...result,
  });
});

router.put('/corridors/:corridorId/schedule', async (req, res) => {
  const corridorId = Array.isArray(req.params.corridorId)
    ? req.params.corridorId[0]
    : req.params.corridorId;

  const schema = z.object({
    operatingDays: z
      .array(z.enum(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']))
      .min(1)
      .optional(),
    slotSchedules: z.array(corridorScheduleSlotSchema).length(2),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(
      400,
      'Invalid centralized corridor schedule payload',
      'VALIDATION_ERROR',
      parsed.error.flatten()
    );
  }

  const result = await updateCentralCorridorSchedule({
    platformOwnerId: req.auth!.userId,
    corridorId,
    operatingDays: parsed.data.operatingDays,
    slotSchedules: parsed.data.slotSchedules,
  });

  res.json({
    success: true,
    ...result,
  });
});

router.get('/drivers', async (req, res) => {
  const statusParam = typeof req.query.status === 'string' ? req.query.status : undefined;
  const parsedStatus = statusParam
    ? z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']).safeParse(statusParam)
    : null;
  if (parsedStatus && !parsedStatus.success) {
    throw new HttpError(400, 'Invalid accountStatus filter', 'VALIDATION_ERROR');
  }

  const drivers = await listAllTier1DriversForOwner({
    platformOwnerId: req.auth!.userId,
    accountStatus: parsedStatus?.success ? parsedStatus.data : undefined,
  });

  res.json({
    success: true,
    drivers,
  });
});

router.post('/drivers', async (req, res) => {
  const parsed = registerContractDriverSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(
      400,
      'Invalid Tier 1 contract driver and driver-owned vehicle payload',
      'VALIDATION_ERROR',
      parsed.error.flatten()
    );
  }

  const d = parsed.data;
  const result = await registerTier1ContractDriver({
    platformOwnerId: req.auth!.userId,
    name: d.name,
    email: d.email,
    phone: d.phone,
    password: d.password,
    licenseNumber: d.licenseNumber,
    homeBase: d.homeBase,
    vehicle: d.vehicle,
    contract: {
      startDate: d.startDate,
      endDate: d.endDate,
      minGuaranteePaise: d.minGuaranteePaise,
      perKmRatePaise: d.perKmRatePaise,
      guaranteedMonthlyDays: d.guaranteedMonthlyDays,
      notes: d.notes,
      eligibleCorridorIds: d.eligibleCorridorIds,
    },
  });

  res.status(201).json({
    success: true,
    ...result,
  });
});

router.get('/drivers/:driverProfileId', async (req, res) => {
  const driverProfileId = Array.isArray(req.params.driverProfileId)
    ? req.params.driverProfileId[0]
    : req.params.driverProfileId;

  const result = await getTier1DriverByIdForOwner({
    platformOwnerId: req.auth!.userId,
    driverProfileId,
  });

  res.json({
    success: true,
    ...result,
  });
});

router.put('/drivers/:driverProfileId/vehicle', async (req, res) => {
  const driverProfileId = Array.isArray(req.params.driverProfileId)
    ? req.params.driverProfileId[0]
    : req.params.driverProfileId;

  const parsed = driverOwnedVehicleSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(
      400,
      'Invalid driver-owned vehicle payload',
      'VALIDATION_ERROR',
      parsed.error.flatten()
    );
  }

  const result = await upsertDriverOwnedVehicle({
    platformOwnerId: req.auth!.userId,
    driverProfileId,
    vehicle: parsed.data,
  });

  res.json({
    success: true,
    ...result,
  });
});

router.patch('/drivers/:driverProfileId/status', async (req, res) => {
  const driverProfileId = Array.isArray(req.params.driverProfileId)
    ? req.params.driverProfileId[0]
    : req.params.driverProfileId;

  const schema = z.object({
    accountStatus: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']),
    reason: z.string().trim().max(300).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(400, 'Invalid accountStatus update payload', 'VALIDATION_ERROR');
  }

  const result = await updateTier1DriverStatus({
    platformOwnerId: req.auth!.userId,
    driverProfileId,
    accountStatus: parsed.data.accountStatus,
    reason: parsed.data.reason,
  });

  res.json({
    success: true,
    ...result,
  });
});

router.patch('/drivers/:driverProfileId/password', async (req, res) => {
  const driverProfileId = Array.isArray(req.params.driverProfileId)
    ? req.params.driverProfileId[0]
    : req.params.driverProfileId;

  const parsed = z
    .object({
      password: z.string().min(8, 'Password must be at least 8 characters').max(128),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(
      400,
      'Invalid password payload (minimum 8 characters required)',
      'VALIDATION_ERROR',
      parsed.error.flatten()
    );
  }

  const result = await resetTier1DriverPassword({
    platformOwnerId: req.auth!.userId,
    driverProfileId,
    newPassword: parsed.data.password,
  });

  res.json({
    success: true,
    ...result,
  });
});

router.post('/drivers/:driverProfileId/contracts', async (req, res) => {
  const driverProfileId = Array.isArray(req.params.driverProfileId)
    ? req.params.driverProfileId[0]
    : req.params.driverProfileId;

  const parsed = contractPayloadSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(
      400,
      'Invalid contract payload',
      'VALIDATION_ERROR',
      parsed.error.flatten()
    );
  }

  const d = parsed.data;
  const result = await createOrUpdateDriverContract({
    platformOwnerId: req.auth!.userId,
    driverProfileId,
    startDate: d.startDate,
    endDate: d.endDate,
    minGuaranteePaise: d.minGuaranteePaise,
    perKmRatePaise: d.perKmRatePaise,
    guaranteedMonthlyDays: d.guaranteedMonthlyDays,
    notes: d.notes,
    eligibleCorridorIds: d.eligibleCorridorIds,
    status: d.status,
    changeNote: d.changeNote,
  });

  res.status(201).json({
    success: true,
    ...result,
  });
});

router.put('/drivers/:driverProfileId/contracts/:contractId', async (req, res) => {
  const driverProfileId = Array.isArray(req.params.driverProfileId)
    ? req.params.driverProfileId[0]
    : req.params.driverProfileId;
  const contractId = Array.isArray(req.params.contractId)
    ? req.params.contractId[0]
    : req.params.contractId;

  const parsed = contractPayloadSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(
      400,
      'Invalid contract update payload',
      'VALIDATION_ERROR',
      parsed.error.flatten()
    );
  }

  const d = parsed.data;
  const result = await createOrUpdateDriverContract({
    platformOwnerId: req.auth!.userId,
    driverProfileId,
    contractId,
    startDate: d.startDate,
    endDate: d.endDate,
    minGuaranteePaise: d.minGuaranteePaise,
    perKmRatePaise: d.perKmRatePaise,
    guaranteedMonthlyDays: d.guaranteedMonthlyDays,
    notes: d.notes,
    eligibleCorridorIds: d.eligibleCorridorIds,
    status: d.status,
    changeNote: d.changeNote,
  });

  res.json({
    success: true,
    ...result,
  });
});

// ---------------------------------------------------------------------------
// Tier 2 Marketplace Driver Application Review & Approval (MC-063)
// ---------------------------------------------------------------------------

router.get('/tier2-applications', async (req, res) => {
  const statusRaw = typeof req.query.status === 'string' ? req.query.status.toUpperCase() : undefined;
  const status =
    statusRaw === 'PENDING' ||
    statusRaw === 'APPROVED' ||
    statusRaw === 'REJECTED' ||
    statusRaw === 'ALL'
      ? statusRaw
      : undefined;
  const search = typeof req.query.search === 'string' ? req.query.search : undefined;

  const result = await listTier2ApplicationsForOwner({ status, search });
  res.json({
    success: true,
    ...result,
  });
});

router.get('/tier2-applications/:applicationId', async (req, res) => {
  const applicationId = Array.isArray(req.params.applicationId)
    ? req.params.applicationId[0]
    : req.params.applicationId;
  const application = await getTier2ApplicationDetailForOwner(applicationId);
  res.json({
    success: true,
    application,
  });
});

router.get('/tier2-applications/:applicationId/documents/:storageKey', async (req, res) => {
  const applicationId = Array.isArray(req.params.applicationId)
    ? req.params.applicationId[0]
    : req.params.applicationId;
  const storageKey = Array.isArray(req.params.storageKey)
    ? req.params.storageKey[0]
    : req.params.storageKey;

  const application = await getTier2ApplicationDetailForOwner(applicationId);
  const docRecord = application.uploadedDocuments?.find((d) => d.storageKey === storageKey);
  if (!docRecord) {
    throw new HttpError(404, 'Uploaded document not found on this application', 'NOT_FOUND');
  }

  const buffer = await readDriverDocumentLocal(docRecord.storageKey).catch(() => {
    throw new HttpError(404, 'Document file unavailable in storage', 'NOT_FOUND');
  });

  res.setHeader('Content-Type', docRecord.mimeType);
  res.setHeader(
    'Content-Disposition',
    `inline; filename="${docRecord.originalName.replace(/"/g, '')}"`
  );
  res.send(buffer);
});

router.post('/tier2-applications/:applicationId/approve', async (req, res) => {
  const applicationId = Array.isArray(req.params.applicationId)
    ? req.params.applicationId[0]
    : req.params.applicationId;
  const parsed = z
    .object({
      reviewNote: z.string().trim().max(400).optional(),
    })
    .safeParse(req.body ?? {});

  if (!parsed.success) {
    throw new HttpError(400, 'Invalid approval payload', 'VALIDATION_ERROR');
  }

  const result = await approveTier2Application({
    platformOwnerId: req.auth!.userId,
    applicationId,
    reviewNote: parsed.data.reviewNote,
  });

  res.json({
    success: true,
    ...result,
  });
});

router.post('/tier2-applications/:applicationId/reject', async (req, res) => {
  const applicationId = Array.isArray(req.params.applicationId)
    ? req.params.applicationId[0]
    : req.params.applicationId;
  const parsed = z
    .object({
      reason: z.string().trim().min(5, 'Rejection reason must be at least 5 characters').max(400),
    })
    .safeParse(req.body ?? {});

  if (!parsed.success) {
    throw new HttpError(
      400,
      'Rejection reason is required (minimum 5 characters).',
      'VALIDATION_ERROR',
      parsed.error.flatten()
    );
  }

  const result = await rejectTier2Application({
    platformOwnerId: req.auth!.userId,
    applicationId,
    reason: parsed.data.reason,
  });

  res.json({
    success: true,
    ...result,
  });
});

router.get('/marketplace-policy', async (_req, res) => {
  const policy = await getActiveMarketplacePolicy();
  res.json({
    success: true,
    policy,
  });
});

router.put('/marketplace-policy', async (req, res) => {
  const policy = await updateMarketplacePolicyForOwner(req.body ?? {});
  res.json({
    success: true,
    policy,
  });
});

router.get('/marketplace-opportunities', async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status.toUpperCase() : undefined;
  const opportunityType =
    typeof req.query.opportunityType === 'string'
      ? req.query.opportunityType.toUpperCase()
      : undefined;
  const opportunities = await listMarketplaceOpportunitiesForOwner({
    status: status as never,
    opportunityType: opportunityType as never,
  });
  res.json({
    success: true,
    opportunities,
  });
});

router.post('/marketplace-opportunities/:opportunityId/reassign', async (req, res) => {
  const opportunityId = Array.isArray(req.params.opportunityId)
    ? req.params.opportunityId[0]
    : req.params.opportunityId;
  const reason =
    typeof req.body?.reason === 'string' && req.body.reason.trim().length >= 3
      ? req.body.reason.trim()
      : 'Platform Owner triggered marketplace reassignment';
  const result = await handleTier2CancellationOrBreakdownReassignment({
    opportunityId,
    reason,
    actorUserId: req.auth!.userId,
  });
  res.json({
    success: true,
    ...result,
  });
});

router.post('/marketplace/evaluate-pool/:poolId', async (req, res) => {
  const poolId = Array.isArray(req.params.poolId) ? req.params.poolId[0] : req.params.poolId;
  const triggerType = req.body?.triggerType === 'RIGHT_SIZING' ? 'RIGHT_SIZING' : 'OVERFLOW';
  const result = await evaluatePoolForMarketplaceOpportunities({
    poolId,
    actorUserId: req.auth!.userId,
    triggerType,
  });
  res.json({
    success: true,
    ...result,
  });
});

router.get('/tier2-earnings', async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status.toUpperCase() : undefined;
  const result = await listOwnerTier2Earnings({
    status: status as never,
  });
  res.json({
    success: true,
    ...result,
  });
});

router.post('/tier2-earnings/:earningId/settle', async (req, res) => {
  const earningId = Array.isArray(req.params.earningId)
    ? req.params.earningId[0]
    : req.params.earningId;
  const earning = await settleTier2Earning({
    earningId,
    actorUserId: req.auth!.userId,
    idempotencyKey:
      typeof req.body?.idempotencyKey === 'string' ? req.body.idempotencyKey : undefined,
    adjustmentsPaise:
      typeof req.body?.adjustmentsPaise === 'number' ? req.body.adjustmentsPaise : undefined,
    note: typeof req.body?.note === 'string' ? req.body.note : undefined,
  });
  res.json({
    success: true,
    earning,
  });
});

router.post('/tier2-earnings/:earningId/action', async (req, res) => {
  const earningId = Array.isArray(req.params.earningId)
    ? req.params.earningId[0]
    : req.params.earningId;
  const schema = z.object({
    action: z.enum(['HOLD', 'DISPUTE', 'REVERSE']),
    reason: z.string().trim().min(3).max(400),
  });
  const parsed = schema.safeParse(req.body ?? {});
  if (!parsed.success) {
    throw new HttpError(400, 'Valid action and reason required', 'VALIDATION_ERROR');
  }
  const earning = await holdOrReverseTier2Earning({
    earningId,
    action: parsed.data.action,
    reason: parsed.data.reason,
  });
  res.json({
    success: true,
    earning,
  });
});

export default router;
