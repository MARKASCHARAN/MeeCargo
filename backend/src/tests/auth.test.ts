import { Types } from 'mongoose';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { requireBusinessProfile } from '../middleware/auth.js';
import { BusinessProfile } from '../models/BusinessProfile.js';
import { RefreshToken } from '../models/RefreshToken.js';
import { Trip } from '../models/Trip.js';
import { User } from '../models/User.js';
import {
  hashPassword,
  rotateRefreshToken,
  signAccessToken,
  verifyPassword,
} from '../services/authService.js';

describe('Stage 2 Auth, RBAC & Isolation (MC-004 to MC-006)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('hashes passwords securely and verifies matching passwords', async () => {
    const hash = await hashPassword('Demo@1234');
    expect(hash).not.toBe('Demo@1234');
    expect(hash.startsWith('$2')).toBe(true);
    expect(await verifyPassword('Demo@1234', hash)).toBe(true);
    expect(await verifyPassword('WrongPass', hash)).toBe(false);
  });

  it('rejects DISPATCHER role on registration', async () => {
    const app = createApp();
    const res = await request(app).post('/api/v1/auth/register').send({
      name: 'Dispatcher Attempt',
      email: 'disp@meecargo.demo',
      password: 'Password123',
      role: 'DISPATCHER',
    });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('registers a SHIPPER and returns access + refresh tokens without exposing passwordHash', async () => {
    const userId = new Types.ObjectId();
    vi.spyOn(User, 'findOne').mockResolvedValue(null);
    vi.spyOn(User, 'create').mockResolvedValue({
      _id: userId,
      name: 'Kiran Patel',
      email: 'kiran@textiles.demo',
      role: 'SHIPPER',
      isActive: true,
    } as never);
    vi.spyOn(RefreshToken, 'create').mockResolvedValue({} as never);

    const app = createApp();
    const res = await request(app).post('/api/v1/auth/register').send({
      name: 'Kiran Patel',
      email: 'kiran@textiles.demo',
      password: 'Password123',
      role: 'SHIPPER',
    });

    expect(res.status).toBe(201);
    expect(res.body.accessToken).toBeTypeOf('string');
    expect(res.body.refreshToken).toBeTypeOf('string');
    expect(res.body.user.role).toBe('SHIPPER');
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  it('rotates refresh tokens and revokes all user tokens on reuse detection', async () => {
    const userId = new Types.ObjectId();
    const saveMock = vi.fn().mockResolvedValue(undefined);
    const updateManyMock = vi.fn().mockResolvedValue({ modifiedCount: 2 });

    vi.spyOn(RefreshToken, 'findOne')
      .mockResolvedValueOnce({
        userId,
        expiresAt: new Date(Date.now() + 60_000),
        revokedAt: undefined,
        save: saveMock,
      } as never)
      .mockResolvedValueOnce({
        userId,
        expiresAt: new Date(Date.now() + 60_000),
        revokedAt: new Date(),
      } as never);

    vi.spyOn(User, 'findById').mockResolvedValue({
      _id: userId,
      name: 'Kiran Patel',
      email: 'kiran@textiles.demo',
      role: 'SHIPPER',
      isActive: true,
    } as never);
    vi.spyOn(RefreshToken, 'create').mockResolvedValue({} as never);
    vi.spyOn(RefreshToken, 'updateMany').mockImplementation(updateManyMock);

    const rotated = await rotateRefreshToken('valid-raw-token');
    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(rotated.accessToken).toBeTypeOf('string');

    await expect(rotateRefreshToken('reused-raw-token')).rejects.toThrow(
      /already revoked/
    );
    expect(updateManyMock).toHaveBeenCalledTimes(1);
  });

  it('enforces role authorization between SHIPPER and DRIVER endpoints', async () => {
    const shipperId = new Types.ObjectId();
    const driverId = new Types.ObjectId();

    vi.spyOn(User, 'findById').mockImplementation(((id: string) => ({
      select: vi.fn().mockResolvedValue(
        id === String(driverId)
          ? { _id: driverId, role: 'DRIVER', isActive: true }
          : { _id: shipperId, role: 'SHIPPER', isActive: true }
      ),
    })) as never);

    const driverToken = signAccessToken({ _id: driverId, role: 'DRIVER' });
    const shipperToken = signAccessToken({ _id: shipperId, role: 'SHIPPER' });

    const app = createApp();

    const driverToShipperRes = await request(app)
      .get('/api/v1/shipper/business')
      .set('Authorization', `Bearer ${driverToken}`);
    expect(driverToShipperRes.status).toBe(403);

    const shipperToDriverRes = await request(app)
      .get('/api/v1/driver/trips')
      .set('Authorization', `Bearer ${shipperToken}`);
    expect(shipperToDriverRes.status).toBe(403);
  });

  it('isolates business profiles by ownership/membership', async () => {
    const shipperId = new Types.ObjectId();
    const otherBusinessId = new Types.ObjectId();

    vi.spyOn(User, 'findById').mockImplementation((() => ({
      select: vi.fn().mockResolvedValue({
        _id: shipperId,
        role: 'SHIPPER',
        isActive: true,
      }),
    })) as never);

    vi.spyOn(BusinessProfile, 'findOne').mockResolvedValue(null);

    const shipperToken = signAccessToken({ _id: shipperId, role: 'SHIPPER' });
    const app = createApp();

    const res = await request(app)
      .get(`/api/v1/shipper/business/${otherBusinessId}`)
      .set('Authorization', `Bearer ${shipperToken}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('isolates driver trips so drivers cannot view trips assigned to other drivers', async () => {
    const driverId = new Types.ObjectId();
    const otherTripId = new Types.ObjectId();

    vi.spyOn(User, 'findById').mockImplementation((() => ({
      select: vi.fn().mockResolvedValue({
        _id: driverId,
        role: 'DRIVER',
        isActive: true,
      }),
    })) as never);

    const populateChain = {
      populate: vi.fn().mockReturnThis(),
      then: (resolve: (val: unknown) => void) => resolve(null),
    };
    vi.spyOn(Trip, 'findOne').mockReturnValue(populateChain as never);

    const driverToken = signAccessToken({ _id: driverId, role: 'DRIVER' });
    const app = createApp();

    const res = await request(app)
      .get(`/api/v1/driver/trips/${otherTripId}`)
      .set('Authorization', `Bearer ${driverToken}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('blocks shipment operations if shipper has no business profile', async () => {
    vi.spyOn(BusinessProfile, 'findOne').mockResolvedValue(null);
    const next = vi.fn();
    await requireBusinessProfile(
      { auth: { userId: String(new Types.ObjectId()), role: 'SHIPPER' } } as never,
      {} as never,
      next
    );
    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0][0];
    expect(err.status).toBe(403);
    expect(err.code).toBe('BUSINESS_PROFILE_REQUIRED');
  });
});
