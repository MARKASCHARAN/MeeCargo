import { Router } from 'express';
import { isValidObjectId } from 'mongoose';
import multer from 'multer';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { otpRateLimiter } from '../middleware/rateLimiters.js';
import { DriverProfile } from '../models/DriverProfile.js';
import {
  ExceptionEvent,
  type ExceptionType,
} from '../models/ExceptionEvent.js';
import { NotificationLog } from '../models/NotificationLog.js';
import { Trip } from '../models/Trip.js';
import { TripEvent } from '../models/TripEvent.js';
import { Vehicle } from '../models/Vehicle.js';
import { evaluateBackhaulForTrip } from '../services/backhaulService.js';
import { readDriverDocumentLocal } from '../services/driverDocumentStorage.js';
import { respondToTripAssignment } from '../services/driverAssignment.js';
import {
  listOpenPoolingSlotsForDriver,
  submitDriverSlotCommitment,
  withdrawDriverSlotCommitment,
} from '../services/driverSlotService.js';
import { reportTripException } from '../services/exceptionService.js';
import { appendLoadingOverride } from '../services/loadingPlanService.js';
import { optimizeAndPlanTripRoute } from '../services/routePlanningService.js';
import { recordPickupBalanceCollection } from '../services/pickupCollectionService.js';
import { calculateAndPersistTripLedger } from '../services/tripEconomicsService.js';
import {
  generateShipmentDeliveryOtp,
  scanShipmentQrForPickup,
  syncOfflineDriverEvents,
  transitionTripExecutionState,
  updateTripShipmentLifecycle,
  verifyDeliveryAndComplete,
} from '../services/tripExecutionService.js';
import {
  acceptMarketplaceOpportunity,
  assertApprovedTier2Driver,
  getDriverTier2ApplicationState,
  listMarketplaceOpportunitiesForTier2,
  submitOrResubmitTier2Application,
  tier2ApplicationSubmissionSchema,
} from '../services/tier2ApplicationService.js';
import { MarketplaceOpportunity } from '../models/MarketplaceOpportunity.js';
import {
  acceptMarketplaceOpportunityAtomic,
  declineMarketplaceOffer,
  handleTier2CancellationOrBreakdownReassignment,
  listEligibleOpportunitiesForDriver,
  viewMarketplaceOffer,
} from '../services/hybridOrchestratorService.js';
import { listDriverTier2Earnings } from '../services/tier2PayoutService.js';
import { HttpError } from '../utils/errors.js';

const ALLOWED_UPLOAD_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_UPLOAD_MIME.has(file.mimetype)) {
      cb(
        new HttpError(
          400,
          'Unsupported upload MIME type. Allowed: JPEG, PNG, WebP.',
          'INVALID_FILE_TYPE'
        )
      );
      return;
    }
    cb(null, true);
  },
});

const router = Router();

router.use(requireAuth, requireRole('DRIVER'));

const profileSchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(8).max(20),
  availabilityStatus: z.enum(['AVAILABLE', 'ON_TRIP', 'OFFLINE']).default('AVAILABLE'),
  fleetTier: z.enum(['TIER_1', 'TIER_2', 'TIER_3']).default('TIER_2'),
  licenseNumber: z.string().trim().max(40).optional(),
  homeBase: z.string().trim().max(120).optional(),
  vehicleId: z.string().optional(),
});

const availabilitySchema = z.object({
  availabilityStatus: z.enum(['AVAILABLE', 'ON_TRIP', 'OFFLINE']),
});

router.get('/profile', async (req, res) => {
  const profile = await DriverProfile.findOne({ userId: req.auth!.userId }).populate(
    'vehicleId'
  );
  res.json({
    success: true,
    driverProfile: profile,
  });
});

router.get('/tier2-application', async (req, res) => {
  const state = await getDriverTier2ApplicationState(req.auth!.userId);
  res.json({
    success: true,
    ...state,
  });
});

router.get('/tier2-application/documents/:storageKey', async (req, res) => {
  const storageKey = Array.isArray(req.params.storageKey)
    ? req.params.storageKey[0]
    : req.params.storageKey;
  const state = await getDriverTier2ApplicationState(req.auth!.userId);
  const docRecord = state.application?.uploadedDocuments?.find(
    (d) => d.storageKey === storageKey
  );
  if (!docRecord) {
    throw new HttpError(404, 'Document not found on your application', 'NOT_FOUND');
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

router.post('/tier2-application', async (req, res) => {
  const parsed = tier2ApplicationSubmissionSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(
      400,
      'Invalid Tier 2 driver application payload',
      'VALIDATION_ERROR',
      parsed.error.flatten()
    );
  }

  const result = await submitOrResubmitTier2Application({
    driverUserId: req.auth!.userId,
    input: parsed.data,
  });

  res.status(201).json({
    success: true,
    ...result,
  });
});

router.get('/marketplace-opportunities', async (req, res) => {
  await assertApprovedTier2Driver(req.auth!.userId);
  const [hybridRes, legacyRes] = await Promise.all([
    listEligibleOpportunitiesForDriver(req.auth!.userId),
    listMarketplaceOpportunitiesForTier2(req.auth!.userId),
  ]);
  res.json({
    success: true,
    eligible: hybridRes.eligible,
    ineligibilityReason: hybridRes.ineligibilityReason,
    marketplaceOpportunities: hybridRes.opportunities,
    opportunities: legacyRes.opportunities,
    vehicle: legacyRes.vehicle,
  });
});

router.post('/marketplace-opportunities/:opportunityId/view', async (req, res) => {
  const opportunityId = Array.isArray(req.params.opportunityId)
    ? req.params.opportunityId[0]
    : req.params.opportunityId;
  const opportunity = await viewMarketplaceOffer({
    opportunityId,
    driverUserId: req.auth!.userId,
  });
  res.json({
    success: true,
    opportunity,
  });
});

router.post('/marketplace-opportunities/:opportunityId/accept', async (req, res) => {
  const targetId = Array.isArray(req.params.opportunityId)
    ? req.params.opportunityId[0]
    : req.params.opportunityId;

  const isMarketplaceOpp = isValidObjectId(targetId)
    ? await MarketplaceOpportunity.exists({ _id: targetId })
    : null;

  if (isMarketplaceOpp) {
    const result = await acceptMarketplaceOpportunityAtomic({
      opportunityId: targetId,
      driverUserId: req.auth!.userId,
    });
    res.json({
      success: true,
      ...result,
    });
    return;
  }

  const result = await acceptMarketplaceOpportunity({
    driverUserId: req.auth!.userId,
    tripId: targetId,
  });
  res.json({
    success: true,
    ...result,
  });
});

router.post('/marketplace-opportunities/:opportunityId/decline', async (req, res) => {
  const opportunityId = Array.isArray(req.params.opportunityId)
    ? req.params.opportunityId[0]
    : req.params.opportunityId;
  const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
  const result = await declineMarketplaceOffer({
    opportunityId,
    driverUserId: req.auth!.userId,
    reason,
  });
  res.json({
    success: true,
    ...result,
  });
});

router.get('/marketplace-earnings', async (req, res) => {
  await assertApprovedTier2Driver(req.auth!.userId);
  const result = await listDriverTier2Earnings(req.auth!.userId);
  res.json({
    success: true,
    ...result,
  });
});

router.post('/trips/:tripId/release-reassignment', async (req, res) => {
  const tripId = Array.isArray(req.params.tripId) ? req.params.tripId[0] : req.params.tripId;
  const reason =
    typeof req.body?.reason === 'string' && req.body.reason.trim().length >= 3
      ? req.body.reason.trim()
      : 'Tier 2 driver released trip for marketplace reassignment';
  const trip = await Trip.findOne({ _id: tripId, driverId: req.auth!.userId });
  if (!trip) {
    throw new HttpError(403, 'Trip not found or not assigned to you', 'FORBIDDEN');
  }
  const result = await handleTier2CancellationOrBreakdownReassignment({
    tripId: String(trip._id),
    reason,
    actorUserId: req.auth!.userId,
  });
  res.json({
    success: true,
    ...result,
  });
});

router.put('/profile', async (req, res) => {
  const parsed = profileSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(400, 'Invalid driver profile payload', 'VALIDATION_ERROR', parsed.error.flatten());
  }

  const data = parsed.data;
  const existingProfile = await DriverProfile.findOne({ userId: req.auth!.userId });
  if (data.fleetTier === 'TIER_1' && !existingProfile?.platformOwnerId) {
    throw new HttpError(
      403,
      'Tier 1 contract drivers must be registered and owned by a Platform Owner account.',
      'PLATFORM_OWNER_REQUIRED'
    );
  }
  if (existingProfile && data.fleetTier !== existingProfile.fleetTier) {
    throw new HttpError(
      403,
      'Drivers cannot change their fleet tier directly.',
      'TIER_CHANGE_FORBIDDEN'
    );
  }
  if (data.vehicleId) {
    if (!isValidObjectId(data.vehicleId)) {
      throw new HttpError(400, 'Invalid vehicleId', 'VALIDATION_ERROR');
    }
    const vehicle = await Vehicle.findById(data.vehicleId);
    if (!vehicle) {
      throw new HttpError(404, 'Assigned vehicle not found', 'VEHICLE_NOT_FOUND');
    }
  }

  const effectiveTier = existingProfile?.fleetTier ?? 'TIER_2';
  const profile = await DriverProfile.findOneAndUpdate(
    { userId: req.auth!.userId },
    {
      $set: {
        userId: req.auth!.userId,
        name: data.name,
        phone: data.phone,
        availabilityStatus:
          effectiveTier === 'TIER_2' && existingProfile?.tier2ApplicationStatus !== 'APPROVED'
            ? 'OFFLINE'
            : data.availabilityStatus,
        fleetTier: effectiveTier,
        ...(effectiveTier === 'TIER_2' && !existingProfile
          ? { tier2ApplicationStatus: 'PENDING' }
          : {}),
        ...(data.licenseNumber !== undefined ? { licenseNumber: data.licenseNumber } : {}),
        ...(data.homeBase !== undefined ? { homeBase: data.homeBase } : {}),
        ...(data.vehicleId !== undefined ? { vehicleId: data.vehicleId } : {}),
      },
    },
    { upsert: true, returnDocument: 'after', runValidators: true }
  ).populate('vehicleId');

  res.json({
    success: true,
    driverProfile: profile,
  });
});

router.patch('/availability', async (req, res) => {
  const parsed = availabilitySchema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(400, 'Invalid availability status', 'VALIDATION_ERROR');
  }

  await assertApprovedTier2Driver(req.auth!.userId);

  const profile = await DriverProfile.findOneAndUpdate(
    { userId: req.auth!.userId },
    { $set: { availabilityStatus: parsed.data.availabilityStatus } },
    { returnDocument: 'after', runValidators: true }
  ).populate('vehicleId');

  if (!profile) {
    throw new HttpError(404, 'Driver profile not found. Create your profile first.', 'NOT_FOUND');
  }

  res.json({
    success: true,
    driverProfile: profile,
  });
});

router.get('/pooling-slots', async (req, res) => {
  const result = await listOpenPoolingSlotsForDriver({
    driverUserId: req.auth!.userId,
  });
  res.json({
    success: true,
    ...result,
  });
});

router.post('/pooling-slots/:slotId/commit', async (req, res) => {
  const slotId = Array.isArray(req.params.slotId)
    ? req.params.slotId[0]
    : req.params.slotId;

  const parsed = z
    .object({
      selectedReturnTime: z
        .string()
        .trim()
        .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Expected 24-hour HH:mm time')
        .optional(),
    })
    .safeParse(req.body ?? {});

  if (!parsed.success) {
    throw new HttpError(
      400,
      'Invalid slot commitment payload',
      'VALIDATION_ERROR',
      parsed.error.flatten()
    );
  }

  const result = await submitDriverSlotCommitment({
    driverUserId: req.auth!.userId,
    slotId,
    selectedReturnTime: parsed.data.selectedReturnTime,
  });

  res.json({
    success: true,
    ...result,
  });
});

router.delete('/pooling-slots/:slotId/commit', async (req, res) => {
  const slotId = Array.isArray(req.params.slotId)
    ? req.params.slotId[0]
    : req.params.slotId;

  const result = await withdrawDriverSlotCommitment({
    driverUserId: req.auth!.userId,
    slotId,
  });

  res.json({
    success: true,
    ...result,
  });
});

router.get('/trips', async (req, res) => {
  const allTrips = await Trip.find({ driverId: req.auth!.userId, quarantined: { $ne: true } })
    .populate('corridorId', 'code name stops turnaroundBufferMin estimatedOutboundDurationMin')
    .populate(
      'slotId',
      'slotNumber slotCode label departureDate plannedDepartureAt estimatedArrivalStartAt estimatedArrivalEndAt returnTimeOptions returnTimeLocked lockedReturnTime scheduleSnapshot'
    )
    .populate('sourceCommitmentId', 'slotNumber selectedPickupTime selectedReturnTime status departureDate')
    .populate(
      'vehicleId',
      'registrationNumber vehicleClass bodyType ownershipType tier operationalStatus maxWeightKg maxVolumeCbm bedDimensionsCm'
    )
    .populate(
      'shipmentIds',
      'reference deliveryStopCode pickupStopCode deliveryAddress recipientName cargo status qrToken allowB2bWarehouseConfirm pricingSnapshot pickupBalanceRequestedAt pickupBalanceCollectedAt'
    )
    .sort({ plannedDepartureAt: 1 });

  // MC-051: Filter out / quarantine any inconsistent Tier 1 trips lacking valid matching commitment
  const validTrips = [];
  for (const trip of allTrips) {
    const tier = trip.allocationEconomics?.allocatedTier;
    const isTier1 = tier === 'TIER_1';
    if (isTier1) {
      const sc = trip.sourceCommitmentId as unknown as {
        _id?: unknown;
        slotNumber?: number;
        status?: string;
        departureDate?: Date;
      } | null;
      const slotObj = trip.slotId as unknown as {
        _id?: unknown;
        slotNumber?: number;
        departureDate?: Date;
      } | null;

      const consistent =
        Boolean(sc) &&
        (sc!.status === 'ALLOCATED' || sc!.status === 'LOCKED') &&
        (!slotObj?.slotNumber || !sc!.slotNumber || slotObj.slotNumber === sc!.slotNumber);

      if (!consistent) {
        await Trip.updateOne(
          { _id: trip._id },
          {
            $set: {
              quarantined: true,
              quarantineReason: 'Quarantined due to missing or mismatched Tier 1 slot commitment.',
            },
          }
        ).catch(() => undefined);
        continue;
      }
    }
    validTrips.push(trip);
  }

  res.json({
    success: true,
    trips: validTrips,
  });
});

router.get('/trips/:tripId', async (req, res) => {
  const tripId = Array.isArray(req.params.tripId)
    ? req.params.tripId[0]
    : req.params.tripId;
  if (!isValidObjectId(tripId)) {
    throw new HttpError(400, 'Invalid trip ID', 'VALIDATION_ERROR');
  }

  const trip = await Trip.findOne({
    _id: tripId,
    driverId: req.auth!.userId,
    quarantined: { $ne: true },
  })
    .populate('corridorId', 'code name stops turnaroundBufferMin estimatedOutboundDurationMin')
    .populate(
      'slotId',
      'slotNumber slotCode label departureDate plannedDepartureAt estimatedArrivalStartAt estimatedArrivalEndAt returnTimeOptions returnTimeLocked lockedReturnTime scheduleSnapshot'
    )
    .populate('sourceCommitmentId', 'slotNumber selectedPickupTime selectedReturnTime status departureDate')
    .populate(
      'vehicleId',
      'registrationNumber vehicleClass bodyType ownershipType tier operationalStatus maxWeightKg maxVolumeCbm bedDimensionsCm'
    )
    .populate(
      'shipmentIds',
      'reference deliveryStopCode pickupStopCode deliveryAddress recipientName cargo status qrToken allowB2bWarehouseConfirm pricingSnapshot pickupBalanceRequestedAt pickupBalanceCollectedAt'
    );

  if (!trip) {
    throw new HttpError(403, 'Trip not found or not assigned to you', 'FORBIDDEN');
  }

  res.json({
    success: true,
    trip,
  });
});

router.post('/trips/:tripId/respond', async (req, res) => {
  const tripId = Array.isArray(req.params.tripId)
    ? req.params.tripId[0]
    : req.params.tripId;

  const schema = z.object({
    decision: z.enum(['ACCEPT', 'REJECT']),
    reason: z.string().trim().max(300).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(400, 'Invalid trip response payload', 'VALIDATION_ERROR');
  }

  const result = await respondToTripAssignment({
    tripId,
    driverUserId: req.auth!.userId,
    decision: parsed.data.decision,
    reason: parsed.data.reason,
  });

  res.json({
    success: true,
    ...result,
  });
});

router.post('/trips/:tripId/optimize-route', async (req, res) => {
  const tripId = Array.isArray(req.params.tripId)
    ? req.params.tripId[0]
    : req.params.tripId;
  if (!isValidObjectId(tripId)) {
    throw new HttpError(400, 'Invalid trip ID', 'VALIDATION_ERROR');
  }
  const owned = await Trip.findOne({ _id: tripId, driverId: req.auth!.userId });
  if (!owned) {
    throw new HttpError(403, 'Trip not found or not assigned to you', 'FORBIDDEN');
  }

  const routeRes = await optimizeAndPlanTripRoute({
    tripId,
    actorUserId: req.auth!.userId,
  });
  const backhaulRes = await evaluateBackhaulForTrip({
    tripId,
    applyMatch: true,
  });

  res.json({
    success: true,
    optimized: routeRes.optimized,
    routePlan: routeRes.routePlan,
    loadingPlan: routeRes.loadingPlan,
    backhaulDecision: backhaulRes.decision,
  });
});

router.post('/trips/:tripId/loading-override', async (req, res) => {
  const tripId = Array.isArray(req.params.tripId)
    ? req.params.tripId[0]
    : req.params.tripId;
  const schema = z.object({
    shipmentId: z.string().min(1),
    note: z.string().trim().min(3).max(300),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success || !isValidObjectId(tripId)) {
    throw new HttpError(400, 'Invalid loading override payload', 'VALIDATION_ERROR');
  }

  const trip = await Trip.findOne({ _id: tripId, driverId: req.auth!.userId });
  if (!trip || !trip.loadingPlan) {
    throw new HttpError(404, 'Trip or loading plan not found', 'NOT_FOUND');
  }

  trip.loadingPlan = appendLoadingOverride(trip.loadingPlan, {
    shipmentId: parsed.data.shipmentId,
    note: parsed.data.note,
    actorUserId: req.auth!.userId,
  });
  trip.markModified('loadingPlan');
  await trip.save();

  res.json({
    success: true,
    loadingPlan: trip.loadingPlan,
  });
});

const coordsSchema = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);

router.post('/trips/:tripId/start', async (req, res) => {
  const tripId = Array.isArray(req.params.tripId) ? req.params.tripId[0] : req.params.tripId;
  const schema = z.object({
    idempotencyKey: z.string().optional(),
    coordinates: coordsSchema.optional(),
    locationDisclosureAccepted: z.boolean().default(true),
  });
  const parsed = schema.safeParse(req.body ?? {});
  const result = await transitionTripExecutionState({
    tripId,
    driverUserId: req.auth!.userId,
    targetStatus: 'IN_PROGRESS',
    idempotencyKey: parsed.success ? parsed.data.idempotencyKey : undefined,
    coordinates: parsed.success ? parsed.data.coordinates : undefined,
    locationDisclosureAccepted: parsed.success ? parsed.data.locationDisclosureAccepted : true,
  });
  res.json({ success: true, ...result });
});

router.post('/trips/:tripId/pause', async (req, res) => {
  const tripId = Array.isArray(req.params.tripId) ? req.params.tripId[0] : req.params.tripId;
  const schema = z.object({
    reason: z.string().trim().min(3).max(300),
    idempotencyKey: z.string().optional(),
    coordinates: coordsSchema.optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(400, 'Pause reason (min 3 chars) is required', 'VALIDATION_ERROR');
  }
  const result = await transitionTripExecutionState({
    tripId,
    driverUserId: req.auth!.userId,
    targetStatus: 'PAUSED',
    reason: parsed.data.reason,
    idempotencyKey: parsed.data.idempotencyKey,
    coordinates: parsed.data.coordinates,
  });
  res.json({ success: true, ...result });
});

router.post('/trips/:tripId/resume', async (req, res) => {
  const tripId = Array.isArray(req.params.tripId) ? req.params.tripId[0] : req.params.tripId;
  const schema = z.object({
    idempotencyKey: z.string().optional(),
    coordinates: coordsSchema.optional(),
  });
  const parsed = schema.safeParse(req.body ?? {});
  const result = await transitionTripExecutionState({
    tripId,
    driverUserId: req.auth!.userId,
    targetStatus: 'IN_PROGRESS',
    idempotencyKey: parsed.success ? parsed.data.idempotencyKey : undefined,
    coordinates: parsed.success ? parsed.data.coordinates : undefined,
  });
  res.json({ success: true, ...result });
});

router.post('/trips/:tripId/complete', async (req, res) => {
  const tripId = Array.isArray(req.params.tripId) ? req.params.tripId[0] : req.params.tripId;
  const schema = z.object({
    idempotencyKey: z.string().optional(),
    coordinates: coordsSchema.optional(),
  });
  const parsed = schema.safeParse(req.body ?? {});
  const result = await transitionTripExecutionState({
    tripId,
    driverUserId: req.auth!.userId,
    targetStatus: 'COMPLETED',
    idempotencyKey: parsed.success ? parsed.data.idempotencyKey : undefined,
    coordinates: parsed.success ? parsed.data.coordinates : undefined,
  });
  res.json({ success: true, ...result });
});

router.post('/trips/:tripId/scan-qr', async (req, res) => {
  const tripId = Array.isArray(req.params.tripId) ? req.params.tripId[0] : req.params.tripId;
  const schema = z.object({
    qrToken: z.string().trim().min(8),
    expectedPickupStopCode: z.string().trim().max(20).optional(),
    coordinates: coordsSchema.optional(),
    idempotencyKey: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(400, 'Valid qrToken is required', 'VALIDATION_ERROR');
  }
  const result = await scanShipmentQrForPickup({
    tripId,
    driverUserId: req.auth!.userId,
    qrToken: parsed.data.qrToken,
    expectedPickupStopCode: parsed.data.expectedPickupStopCode,
    coordinates: parsed.data.coordinates,
    idempotencyKey: parsed.data.idempotencyKey,
  });
  res.json({ success: true, ...result });
});

router.post('/trips/:tripId/shipments/:shipmentId/status', async (req, res) => {
  const tripId = Array.isArray(req.params.tripId) ? req.params.tripId[0] : req.params.tripId;
  const shipmentId = Array.isArray(req.params.shipmentId)
    ? req.params.shipmentId[0]
    : req.params.shipmentId;
  const schema = z.object({
    status: z.enum(['IN_TRANSIT', 'AT_DESTINATION', 'FAILED']),
    reason: z.string().trim().max(300).optional(),
    idempotencyKey: z.string().optional(),
    coordinates: coordsSchema.optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(400, 'Invalid shipment status event', 'VALIDATION_ERROR');
  }
  const result = await updateTripShipmentLifecycle({
    tripId,
    shipmentId,
    driverUserId: req.auth!.userId,
    targetStatus: parsed.data.status,
    reason: parsed.data.reason,
    idempotencyKey: parsed.data.idempotencyKey,
    coordinates: parsed.data.coordinates,
  });
  res.json({ success: true, ...result });
});

router.post('/trips/:tripId/shipments/:shipmentId/otp', otpRateLimiter, async (req, res) => {
  const tripId = Array.isArray(req.params.tripId) ? req.params.tripId[0] : req.params.tripId;
  const shipmentId = Array.isArray(req.params.shipmentId)
    ? req.params.shipmentId[0]
    : req.params.shipmentId;
  const result = await generateShipmentDeliveryOtp({
    tripId,
    shipmentId,
    driverUserId: req.auth!.userId,
  });
  res.json({ success: true, ...result });
});

router.post(
  '/trips/:tripId/shipments/:shipmentId/deliver',
  otpRateLimiter,
  upload.single('photo'),
  async (req, res) => {
    const tripId = Array.isArray(req.params.tripId) ? req.params.tripId[0] : req.params.tripId;
    const shipmentId = Array.isArray(req.params.shipmentId)
      ? req.params.shipmentId[0]
      : req.params.shipmentId;
    const schema = z.object({
      confirmationMode: z
        .enum(['OTP', 'B2B_WAREHOUSE_SIGN_OFF'])
        .default('OTP'),
      otp: z.string().optional(),
      b2bSignOffName: z.string().optional(),
      b2bSignOffNote: z.string().optional(),
    });
    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new HttpError(400, 'Invalid delivery confirmation payload', 'VALIDATION_ERROR');
    }

    const result = await verifyDeliveryAndComplete({
      tripId,
      shipmentId,
      driverUserId: req.auth!.userId,
      confirmationMode: parsed.data.confirmationMode,
      otp: parsed.data.otp,
      b2bSignOffName: parsed.data.b2bSignOffName,
      b2bSignOffNote: parsed.data.b2bSignOffNote,
      photoFile: req.file
        ? {
            buffer: req.file.buffer,
            mimetype: req.file.mimetype,
            size: req.file.size,
          }
        : undefined,
    });
    res.json({ success: true, ...result });
  }
);

router.post('/trips/:tripId/sync-offline', async (req, res) => {
  const tripId = Array.isArray(req.params.tripId) ? req.params.tripId[0] : req.params.tripId;
  const schema = z.object({
    events: z
      .array(
        z.object({
          idempotencyKey: z.string().min(4),
          kind: z.enum(['TRIP_STATUS', 'SHIPMENT_STATUS']),
          targetStatus: z.string().min(2),
          shipmentId: z.string().optional(),
          reason: z.string().optional(),
          occurredAt: z.string(),
          coordinates: coordsSchema.optional(),
        })
      )
      .min(1)
      .max(50),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(400, 'Invalid offline sync payload', 'VALIDATION_ERROR');
  }
  const result = await syncOfflineDriverEvents({
    tripId,
    driverUserId: req.auth!.userId,
    events: parsed.data.events,
  });
  res.json({ success: true, ...result });
});

router.get('/trips/:tripId/events', async (req, res) => {
  const tripId = Array.isArray(req.params.tripId) ? req.params.tripId[0] : req.params.tripId;
  if (!isValidObjectId(tripId)) {
    throw new HttpError(400, 'Invalid trip ID', 'VALIDATION_ERROR');
  }
  const trip = await Trip.findOne({ _id: tripId, driverId: req.auth!.userId });
  if (!trip) {
    throw new HttpError(403, 'Trip not found or not assigned to you', 'FORBIDDEN');
  }
  const events = await TripEvent.find({ tripId: trip._id }).sort({ occurredAt: 1 });
  res.json({ success: true, events });
});

router.post('/trips/:tripId/shipments/:shipmentId/collect-balance', async (req, res) => {
  const tripId = Array.isArray(req.params.tripId) ? req.params.tripId[0] : req.params.tripId;
  const shipmentId = Array.isArray(req.params.shipmentId)
    ? req.params.shipmentId[0]
    : req.params.shipmentId;

  const schema = z.object({
    paymentMethod: z
      .enum(['SIMULATED_UPI', 'CASH_AT_PICKUP', 'TEST_GATEWAY'])
      .default('SIMULATED_UPI'),
    adjustmentsPaise: z.number().int().default(0),
    idempotencyKey: z.string().trim().min(4).max(120).optional(),
  });
  const parsed = schema.safeParse(req.body ?? {});
  if (!parsed.success) {
    throw new HttpError(400, 'Invalid pickup balance collection payload', 'VALIDATION_ERROR');
  }

  const result = await recordPickupBalanceCollection({
    tripId,
    shipmentId,
    driverUserId: req.auth!.userId,
    paymentMethod: parsed.data.paymentMethod,
    adjustmentsPaise: parsed.data.adjustmentsPaise,
    idempotencyKey: parsed.data.idempotencyKey,
  });

  res.json({
    success: true,
    ...result,
  });
});

router.get('/trips/:tripId/ledger', async (req, res) => {
  const tripId = Array.isArray(req.params.tripId) ? req.params.tripId[0] : req.params.tripId;
  if (!isValidObjectId(tripId)) {
    throw new HttpError(400, 'Invalid trip ID', 'VALIDATION_ERROR');
  }
  const trip = await Trip.findOne({ _id: tripId, driverId: req.auth!.userId });
  if (!trip) {
    throw new HttpError(403, 'Trip not found or not assigned to you', 'FORBIDDEN');
  }
  const ledger = await calculateAndPersistTripLedger(tripId);
  res.json({ success: true, ledger });
});

router.post('/trips/:tripId/location', async (req, res) => {
  const tripId = Array.isArray(req.params.tripId) ? req.params.tripId[0] : req.params.tripId;
  if (!isValidObjectId(tripId)) {
    throw new HttpError(400, 'Invalid trip ID', 'VALIDATION_ERROR');
  }
  const parsed = z.object({ coordinates: coordsSchema }).safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(400, 'Valid [lng, lat] coordinates required', 'VALIDATION_ERROR');
  }

  const trip = await Trip.findOne({ _id: tripId, driverId: req.auth!.userId });
  if (!trip) {
    throw new HttpError(403, 'Trip not found or not assigned to you', 'FORBIDDEN');
  }
  if (trip.status !== 'IN_PROGRESS' || !trip.locationDisclosureAcceptedAt) {
    throw new HttpError(
      409,
      'Location sharing is strictly limited to active IN_PROGRESS trips after disclosure acceptance.',
      'LOCATION_POLICY_VIOLATION'
    );
  }

  trip.lastKnownLocation = {
    coordinates: parsed.data.coordinates,
    recordedAt: new Date(),
  };
  await trip.save();

  res.json({
    success: true,
    recordedAt: trip.lastKnownLocation.recordedAt,
    coordinates: trip.lastKnownLocation.coordinates,
  });
});

const exceptionTypeEnum = z.enum([
  'CUSTOMER_UNAVAILABLE',
  'INCORRECT_ADDRESS',
  'VEHICLE_BREAKDOWN',
  'ROAD_BLOCKED',
  'SHIPMENT_DAMAGED',
  'RECIPIENT_REFUSES',
  'DRIVER_UNAVAILABLE',
  'PARTIAL_DELIVERY',
  'PICKUP_FAILURE',
  'ROUTE_INFEASIBILITY',
]);

router.get('/trips/:tripId/exceptions', async (req, res) => {
  const tripId = Array.isArray(req.params.tripId) ? req.params.tripId[0] : req.params.tripId;
  if (!isValidObjectId(tripId)) {
    throw new HttpError(400, 'Invalid trip ID', 'VALIDATION_ERROR');
  }
  const trip = await Trip.findOne({ _id: tripId, driverId: req.auth!.userId });
  if (!trip) {
    throw new HttpError(403, 'Trip not found or not assigned to you', 'FORBIDDEN');
  }
  const exceptions = await ExceptionEvent.find({ tripId: trip._id }).sort({
    createdAt: -1,
  });
  res.json({ success: true, exceptions });
});

router.post('/trips/:tripId/exceptions', upload.single('evidence'), async (req, res) => {
  const tripId = Array.isArray(req.params.tripId) ? req.params.tripId[0] : req.params.tripId;
  const schema = z.object({
    exceptionType: exceptionTypeEnum,
    reason: z.string().trim().min(3).max(500),
    shipmentId: z.string().trim().optional(),
  });
  const parsed = schema.safeParse(req.body ?? {});
  if (!parsed.success) {
    throw new HttpError(
      400,
      'Valid exceptionType and reason (min 3 chars) are required',
      'VALIDATION_ERROR',
      parsed.error.flatten()
    );
  }

  const result = await reportTripException({
    tripId,
    driverUserId: req.auth!.userId,
    exceptionType: parsed.data.exceptionType as ExceptionType,
    reason: parsed.data.reason,
    shipmentId: parsed.data.shipmentId || undefined,
    evidenceFile: req.file
      ? {
          buffer: req.file.buffer,
          mimetype: req.file.mimetype,
          size: req.file.size,
        }
      : undefined,
  });

  res.status(201).json({
    success: true,
    ...result,
  });
});

router.get('/notifications', async (req, res) => {
  const notifications = await NotificationLog.find({
    recipientUserId: req.auth!.userId,
  })
    .sort({ createdAt: -1 })
    .limit(25);

  res.json({
    success: true,
    notifications,
  });
});

router.patch('/notifications/:id/read', async (req, res) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!isValidObjectId(id)) {
    throw new HttpError(400, 'Invalid notification ID', 'VALIDATION_ERROR');
  }

  await NotificationLog.updateOne(
    { _id: id, recipientUserId: req.auth!.userId },
    { $set: { readAt: new Date() } }
  );

  res.json({ success: true });
});

export default router;
