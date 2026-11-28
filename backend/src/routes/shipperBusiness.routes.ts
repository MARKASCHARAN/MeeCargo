import { Router } from 'express';
import { isValidObjectId } from 'mongoose';
import { z } from 'zod';
import { withTransaction } from '../config/database.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { BusinessProfile } from '../models/BusinessProfile.js';
import { User } from '../models/User.js';
import { HttpError } from '../utils/errors.js';

const router = Router();

router.use(requireAuth, requireRole('SHIPPER'));

const geoPointInputSchema = z.object({
  type: z.literal('Point').default('Point'),
  coordinates: z
    .tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)])
    .describe('[longitude, latitude]'),
});

const addressInputSchema = z.object({
  addressLine: z.string().trim().min(3).max(250),
  villageOrTown: z.string().trim().min(2).max(100),
  district: z.string().trim().min(2).max(100),
  state: z.string().trim().min(2).max(80).default('Gujarat'),
  pincode: z.string().trim().regex(/^\d{6}$/, 'PIN code must be 6 digits'),
  landmark: z.string().trim().max(150).optional(),
  location: geoPointInputSchema,
});

const serviceLocationInputSchema = z.object({
  label: z.string().trim().min(2).max(100),
  villageOrTown: z.string().trim().min(2).max(100),
  district: z.string().trim().min(2).max(100),
  state: z.string().trim().min(2).max(80).default('Gujarat'),
  pincode: z.string().trim().regex(/^\d{6}$/).optional(),
  location: geoPointInputSchema.optional(),
});

const businessProfileInputSchema = z.object({
  businessName: z.string().trim().min(2).max(160),
  businessType: z
    .enum([
      'MANUFACTURER',
      'WHOLESALER',
      'TEXTILE_MILL',
      'AGRO_PROCESSOR',
      'RETAILER',
      'OTHER',
    ])
    .default('OTHER'),
  contactName: z.string().trim().min(2).max(120),
  contactPhone: z.string().trim().min(8).max(20),
  contactEmail: z.string().trim().email(),
  gstin: z
    .union([
      z.literal(''),
      z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/, 'Invalid GSTIN format'),
    ])
    .optional()
    .transform((val) => (val === '' ? undefined : val)),
  pickupAddress: addressInputSchema,
  serviceLocations: z.array(serviceLocationInputSchema).default([]),
});

router.get('/', async (req, res) => {
  const business = await BusinessProfile.findOne({
    isActive: true,
    $or: [{ ownerId: req.auth!.userId }, { memberUserIds: req.auth!.userId }],
  });

  res.json({
    success: true,
    businessProfile: business,
  });
});

router.post('/', async (req, res) => {
  const parsed = businessProfileInputSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(400, 'Invalid business profile data', 'VALIDATION_ERROR', parsed.error.flatten());
  }

  const existing = await BusinessProfile.findOne({
    isActive: true,
    $or: [{ ownerId: req.auth!.userId }, { memberUserIds: req.auth!.userId }],
  });

  if (existing) {
    throw new HttpError(409, 'A business profile already exists for this shipper user', 'PROFILE_EXISTS');
  }

  const created = await withTransaction(async (session) => {
    const [profile] = await BusinessProfile.create(
      [
        {
          ...parsed.data,
          ownerId: req.auth!.userId,
          memberUserIds: [req.auth!.userId],
        },
      ],
      { session: session ?? undefined }
    );

    await User.updateOne(
      { _id: req.auth!.userId },
      { $set: { businessId: profile._id } },
      { session: session ?? undefined }
    );

    return profile;
  });

  res.status(201).json({
    success: true,
    businessProfile: created,
  });
});

router.patch('/', async (req, res) => {
  const parsed = businessProfileInputSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(400, 'Invalid business profile update', 'VALIDATION_ERROR', parsed.error.flatten());
  }

  const existing = await BusinessProfile.findOne({
    isActive: true,
    $or: [{ ownerId: req.auth!.userId }, { memberUserIds: req.auth!.userId }],
  });

  if (!existing) {
    throw new HttpError(404, 'Business profile not found', 'NOT_FOUND');
  }

  Object.assign(existing, parsed.data);
  await existing.save();

  res.json({
    success: true,
    businessProfile: existing,
  });
});

router.get('/:businessId', async (req, res) => {
  const { businessId } = req.params;
  if (!isValidObjectId(businessId)) {
    throw new HttpError(400, 'Invalid business ID', 'VALIDATION_ERROR');
  }

  const business = await BusinessProfile.findOne({
    _id: businessId,
    isActive: true,
    $or: [{ ownerId: req.auth!.userId }, { memberUserIds: req.auth!.userId }],
  });

  if (!business) {
    throw new HttpError(403, 'You do not have access to this business profile', 'FORBIDDEN');
  }

  res.json({
    success: true,
    businessProfile: business,
  });
});

export default router;
