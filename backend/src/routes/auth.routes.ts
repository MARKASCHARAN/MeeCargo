import { Router, type Response } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { requireAuth } from '../middleware/auth.js';
import { authRateLimiter } from '../middleware/rateLimiters.js';
import { BusinessProfile } from '../models/BusinessProfile.js';
import { DriverProfile } from '../models/DriverProfile.js';
import { User } from '../models/User.js';
import {
  hashPassword,
  issueTokenPair,
  revokeRefreshToken,
  rotateRefreshToken,
  verifyPassword,
} from '../services/authService.js';
import {
  submitOrResubmitTier2Application,
  tier2ApplicationSubmissionSchema,
} from '../services/tier2ApplicationService.js';
import { HttpError } from '../utils/errors.js';

const router = Router();

const registerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email(),
  phone: z.string().trim().min(8).max(20).optional(),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
  role: z.enum(['SHIPPER', 'DRIVER']),
  tier2Application: tier2ApplicationSubmissionSchema.omit({ fullName: true, phone: true }).optional(),
});

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
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

function clearAuthCookies(res: Response) {
  res.clearCookie('mc_access_token');
  res.clearCookie('mc_refresh_token');
}

router.post('/register', authRateLimiter, async (req, res) => {
  if (req.body?.role === 'PLATFORM_OWNER') {
    throw new HttpError(
      403,
      'Platform Owner is a singleton platform account provisioned by setup/seed and cannot be publicly registered.',
      'PLATFORM_OWNER_REGISTRATION_FORBIDDEN'
    );
  }
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(400, 'Invalid registration payload', 'VALIDATION_ERROR', parsed.error.flatten());
  }

  const { name, email, phone, password, role, tier2Application } = parsed.data;
  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) {
    throw new HttpError(409, 'An account with this email already exists', 'EMAIL_EXISTS');
  }

  const passwordHash = await hashPassword(password);
  const user = await User.create({
    name,
    email: email.toLowerCase(),
    ...(phone ? { phone } : {}),
    passwordHash,
    role,
  });

  if (role === 'DRIVER') {
    await DriverProfile.create({
      userId: user._id,
      name: user.name,
      phone: phone ?? 'Not provided',
      availabilityStatus: 'OFFLINE',
      fleetTier: 'TIER_2',
      tier2ApplicationStatus: 'PENDING',
    });

    if (tier2Application && phone) {
      await submitOrResubmitTier2Application({
        driverUserId: String(user._id),
        input: {
          fullName: user.name,
          phone,
          ...tier2Application,
        },
      });
    }
  }

  const { accessToken, refreshToken } = await issueTokenPair(user);
  setAuthCookies(res, accessToken, refreshToken);

  res.status(201).json({
    success: true,
    accessToken,
    refreshToken,
    user: {
      id: String(user._id),
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      businessId: user.businessId ? String(user.businessId) : undefined,
    },
  });
});

router.post('/login', authRateLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(400, 'Invalid login credentials format', 'VALIDATION_ERROR');
  }

  const { email, password } = parsed.data;
  const user = await User.findOne({ email: email.toLowerCase() }).select('+passwordHash');
  if (!user || !user.isActive) {
    throw new HttpError(401, 'Invalid email or password', 'INVALID_CREDENTIALS');
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    throw new HttpError(401, 'Invalid email or password', 'INVALID_CREDENTIALS');
  }

  const { accessToken, refreshToken } = await issueTokenPair(user);
  setAuthCookies(res, accessToken, refreshToken);

  res.json({
    success: true,
    accessToken,
    refreshToken,
    user: {
      id: String(user._id),
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      businessId: user.businessId ? String(user.businessId) : undefined,
    },
  });
});

router.post('/refresh', async (req, res) => {
  const rawToken =
    (req.body?.refreshToken as string | undefined) ||
    (req.cookies?.mc_refresh_token as string | undefined);

  const result = await rotateRefreshToken(rawToken ?? '');
  setAuthCookies(res, result.accessToken, result.refreshToken);

  res.json({
    success: true,
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    user: {
      id: String(result.user._id),
      name: result.user.name,
      email: result.user.email,
      role: result.user.role,
      businessId: result.user.businessId ? String(result.user.businessId) : undefined,
    },
  });
});

router.post('/logout', async (req, res) => {
  const rawToken =
    (req.body?.refreshToken as string | undefined) ||
    (req.cookies?.mc_refresh_token as string | undefined);

  await revokeRefreshToken(rawToken);
  clearAuthCookies(res);
  res.json({ success: true });
});

router.get('/me', requireAuth, async (req, res) => {
  const user = await User.findById(req.auth!.userId);
  if (!user) {
    throw new HttpError(404, 'User not found', 'NOT_FOUND');
  }

  const businessProfile =
    user.role === 'SHIPPER'
      ? await BusinessProfile.findOne({
          isActive: true,
          $or: [{ ownerId: user._id }, { memberUserIds: user._id }],
        })
      : null;

  const driverProfile =
    user.role === 'DRIVER'
      ? await DriverProfile.findOne({ userId: user._id }).populate('vehicleId')
      : null;

  res.json({
    success: true,
    user: {
      id: String(user._id),
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      businessId: businessProfile ? String(businessProfile._id) : undefined,
    },
    businessProfile,
    driverProfile,
  });
});

export default router;
