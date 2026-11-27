import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { Types } from 'mongoose';
import { env } from '../config/env.js';
import { RefreshToken } from '../models/RefreshToken.js';
import { User, type IUser, type UserRole } from '../models/User.js';
import { HttpError } from '../utils/errors.js';

export interface AccessTokenPayload {
  sub: string;
  role: UserRole;
  businessId?: string;
}

const ACCESS_EXPIRES_IN = '15m';
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

function hashRefreshToken(rawToken: string): string {
  return crypto
    .createHmac('sha256', env.JWT_REFRESH_SECRET)
    .update(rawToken)
    .digest('hex');
}

export function signAccessToken(user: {
  _id: Types.ObjectId | string;
  role: UserRole;
  businessId?: Types.ObjectId | string;
}): string {
  const payload: AccessTokenPayload = {
    sub: String(user._id),
    role: user.role,
    ...(user.businessId ? { businessId: String(user.businessId) } : {}),
  };
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: ACCESS_EXPIRES_IN });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const decoded = jwt.verify(token, env.JWT_SECRET) as AccessTokenPayload;
  if (!decoded?.sub || (decoded.role !== 'SHIPPER' && decoded.role !== 'DRIVER')) {
    throw new HttpError(401, 'Invalid access token', 'INVALID_TOKEN');
  }
  return decoded;
}

export async function issueTokenPair(user: IUser) {
  const accessToken = signAccessToken(user);
  const refreshToken = crypto.randomBytes(40).toString('hex');
  const tokenHash = hashRefreshToken(refreshToken);

  await RefreshToken.create({
    userId: user._id,
    tokenHash,
    expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
  });

  return { accessToken, refreshToken };
}

export async function rotateRefreshToken(rawRefreshToken: string) {
  if (!rawRefreshToken) {
    throw new HttpError(401, 'Refresh token is required', 'MISSING_REFRESH_TOKEN');
  }

  const tokenHash = hashRefreshToken(rawRefreshToken);
  const existing = await RefreshToken.findOne({ tokenHash });

  if (!existing) {
    throw new HttpError(401, 'Invalid refresh token', 'INVALID_REFRESH_TOKEN');
  }

  if (existing.revokedAt) {
    // Reuse detection: revoke all active refresh tokens for this user
    await RefreshToken.updateMany(
      { userId: existing.userId, revokedAt: { $exists: false } },
      { $set: { revokedAt: new Date() } }
    );
    throw new HttpError(401, 'Refresh token was already revoked', 'TOKEN_REUSE_DETECTED');
  }

  if (existing.expiresAt.getTime() <= Date.now()) {
    throw new HttpError(401, 'Refresh token expired', 'REFRESH_TOKEN_EXPIRED');
  }

  const user = await User.findById(existing.userId);
  if (!user || !user.isActive) {
    throw new HttpError(401, 'User account unavailable', 'USER_UNAVAILABLE');
  }

  existing.revokedAt = new Date();
  await existing.save();

  const tokens = await issueTokenPair(user);
  return { user, ...tokens };
}

export async function revokeRefreshToken(rawRefreshToken?: string): Promise<void> {
  if (!rawRefreshToken) return;
  const tokenHash = hashRefreshToken(rawRefreshToken);
  await RefreshToken.updateOne(
    { tokenHash, revokedAt: { $exists: false } },
    { $set: { revokedAt: new Date() } }
  );
}
