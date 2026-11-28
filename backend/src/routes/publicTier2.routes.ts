import { Router, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { env } from '../config/env.js';
import { authRateLimiter } from '../middleware/rateLimiters.js';
import type { Tier2DocumentType } from '../models/Tier2Application.js';
import { issueTokenPair } from '../services/authService.js';
import {
  ALLOWED_DRIVER_DOC_MIME,
  MAX_DRIVER_DOC_BYTES,
} from '../services/driverDocumentStorage.js';
import {
  getTier2VerificationPolicy,
  lookupPublicTier2ApplicationStatus,
  publicTier2ApplySchema,
  submitPublicTier2Application,
} from '../services/tier2ApplicationService.js';
import { HttpError } from '../utils/errors.js';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_DRIVER_DOC_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_DRIVER_DOC_MIME.has(file.mimetype)) {
      cb(
        new HttpError(
          400,
          'Unsupported document file type. Allowed: JPEG, PNG, WebP, or PDF.',
          'INVALID_FILE_TYPE'
        )
      );
      return;
    }
    cb(null, true);
  },
});

function setAuthCookies(res: Response, accessToken: string, refreshToken: string) {
  const isProd = env.NODE_ENV === 'production';
  res.cookie('mc_access_token', accessToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    maxAge: 15 * 60 * 1000,
  });
  res.cookie('mc_refresh_token', refreshToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

router.get('/policy', (_req, res) => {
  res.json({
    success: true,
    policy: getTier2VerificationPolicy(),
  });
});

router.post(
  '/apply',
  authRateLimiter,
  upload.fields([
    { name: 'licenseFile', maxCount: 1 },
    { name: 'idProofFile', maxCount: 1 },
    { name: 'rcFile', maxCount: 1 },
    { name: 'insuranceFile', maxCount: 1 },
  ]),
  async (req, res) => {
    let rawPayload: unknown = req.body;
    if (typeof req.body?.payload === 'string') {
      try {
        rawPayload = JSON.parse(req.body.payload);
      } catch {
        throw new HttpError(400, 'Malformed JSON payload field', 'VALIDATION_ERROR');
      }
    }

    const parsed = publicTier2ApplySchema.safeParse(rawPayload);
    if (!parsed.success) {
      throw new HttpError(
        400,
        'Invalid Tier 2 application form fields',
        'VALIDATION_ERROR',
        parsed.error.flatten()
      );
    }

    const filesMap = (req.files ?? {}) as Record<string, Express.Multer.File[]>;
    const filesByDocType: Partial<
      Record<
        Tier2DocumentType,
        { buffer: Buffer; mimetype: string; size: number; originalname?: string }
      >
    > = {};

    const fieldMapping: Array<[string, Tier2DocumentType]> = [
      ['licenseFile', 'DRIVING_LICENSE'],
      ['idProofFile', 'IDENTITY_PROOF'],
      ['rcFile', 'VEHICLE_RC'],
      ['insuranceFile', 'INSURANCE_POLICY'],
    ];
    for (const [field, docType] of fieldMapping) {
      const f = filesMap[field]?.[0];
      if (f) {
        filesByDocType[docType] = {
          buffer: f.buffer,
          mimetype: f.mimetype,
          size: f.size,
          originalname: f.originalname,
        };
      }
    }

    const result = await submitPublicTier2Application({
      input: parsed.data,
      filesByDocType,
    });

    const { accessToken, refreshToken } = await issueTokenPair(result.user);
    setAuthCookies(res, accessToken, refreshToken);

    res.status(201).json({
      success: true,
      applicationRef: result.application.applicationRef,
      status: result.application.status,
      appliedAt: result.application.appliedAt,
      uploadedDocumentsCount: result.application.uploadedDocuments.length,
      accessToken,
      refreshToken,
      user: {
        id: String(result.user._id),
        name: result.user.name,
        email: result.user.email,
        phone: result.user.phone,
        role: result.user.role,
      },
      application: {
        _id: result.application._id,
        applicationRef: result.application.applicationRef,
        status: result.application.status,
        appliedAt: result.application.appliedAt,
        uploadedDocuments: result.application.uploadedDocuments,
      },
    });
  }
);

router.post('/application-status', authRateLimiter, async (req, res) => {
  const parsed = z
    .object({
      applicationRef: z.string().trim().min(4).max(40),
      email: z.string().trim().email(),
    })
    .safeParse(req.body);

  if (!parsed.success) {
    throw new HttpError(
      400,
      'Provide both a valid application reference and email address.',
      'VALIDATION_ERROR'
    );
  }

  const statusSummary = await lookupPublicTier2ApplicationStatus(parsed.data);
  res.json({
    success: true,
    ...statusSummary,
  });
});

export default router;
