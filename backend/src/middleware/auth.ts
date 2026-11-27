import type { NextFunction, Request, Response } from 'express';
import { BusinessProfile, type IBusinessProfile } from '../models/BusinessProfile.js';
import { User, type UserRole } from '../models/User.js';
import { verifyAccessToken } from '../services/authService.js';
import { HttpError } from '../utils/errors.js';

export interface AuthContext {
  userId: string;
  role: UserRole;
  businessId?: string;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
      businessProfile?: IBusinessProfile;
    }
  }
}

export async function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    const bearerToken = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : undefined;
    const token = bearerToken || (req.cookies?.mc_access_token as string | undefined);

    if (!token) {
      throw new HttpError(401, 'Authentication required', 'UNAUTHORIZED');
    }

    const payload = verifyAccessToken(token);
    const user = await User.findById(payload.sub).select('role businessId isActive');
    if (!user || !user.isActive) {
      throw new HttpError(401, 'User account not found or inactive', 'UNAUTHORIZED');
    }

    req.auth = {
      userId: String(user._id),
      role: user.role,
      ...(user.businessId ? { businessId: String(user.businessId) } : {}),
    };
    next();
  } catch (error) {
    if (error instanceof HttpError) {
      next(error);
      return;
    }
    next(new HttpError(401, 'Invalid or expired authentication token', 'UNAUTHORIZED'));
  }
}

export function requireRole(...allowedRoles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) {
      next(new HttpError(401, 'Authentication required', 'UNAUTHORIZED'));
      return;
    }
    if (!allowedRoles.includes(req.auth.role)) {
      next(
        new HttpError(
          403,
          `Role ${req.auth.role} is not authorized to access this resource`,
          'FORBIDDEN'
        )
      );
      return;
    }
    next();
  };
}

export async function requireBusinessProfile(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.auth || req.auth.role !== 'SHIPPER') {
      next(new HttpError(403, 'Shipper role required', 'FORBIDDEN'));
      return;
    }

    const business = await BusinessProfile.findOne({
      isActive: true,
      $or: [{ ownerId: req.auth.userId }, { memberUserIds: req.auth.userId }],
    });

    if (!business) {
      next(
        new HttpError(
          403,
          'A shipper business profile is required before creating or managing shipments.',
          'BUSINESS_PROFILE_REQUIRED'
        )
      );
      return;
    }

    req.businessProfile = business;
    next();
  } catch (error) {
    next(error);
  }
}
