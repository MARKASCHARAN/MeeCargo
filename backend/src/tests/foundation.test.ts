import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { loadEnv } from '../config/env.js';
import { isValidLngLat } from '../models/common.js';
import { createApp } from '../app.js';

describe('Stage 1 Foundation (MC-001 & MC-002)', () => {
  it('validates required environment variables at startup', () => {
    expect(() =>
      loadEnv({
        MONGODB_URL: '',
        JWT_SECRET: 'short',
      } as unknown as NodeJS.ProcessEnv)
    ).toThrow(/Invalid environment configuration/);

    const valid = loadEnv({
      NODE_ENV: 'test',
      PORT: '5001',
      ORIGIN: 'http://localhost:5173',
      MONGODB_URL: 'mongodb://localhost:27017/meecargo',
      JWT_SECRET: 'super-secret-jwt-key-for-testing',
    } as unknown as NodeJS.ProcessEnv);

    expect(valid.PORT).toBe(5001);
    expect(valid.VOLUMETRIC_DIVISOR).toBe(5000);
    expect(valid.PAYMENT_MODE).toBe('SIMULATED');
  });

  it('enforces valid [longitude, latitude] GeoJSON coordinates', () => {
    expect(isValidLngLat([73.1812, 22.3072])).toBe(true); // Vadodara [lng, lat]
    expect(isValidLngLat([22.3072, 73.1812])).toBe(true); // Valid bounds numerically
    expect(isValidLngLat([181, 22])).toBe(false); // Invalid longitude
    expect(isValidLngLat([73, 95])).toBe(false); // Invalid latitude
    expect(isValidLngLat([73])).toBe(false);
  });

  it('exposes /api/v1/health reporting service metadata and DB state', async () => {
    const app = createApp();
    const res = await request(app).get('/api/v1/health');
    expect([200, 503]).toContain(res.status);
    expect(res.body.service).toBe('meecargo-api');
    expect(res.body.modes).toEqual({
      payment: 'SIMULATED',
      routing: 'FIXTURE',
      notifications: 'CONSOLE',
    });
    expect(res.body.db).toHaveProperty('connected');
    expect(res.body.db).toHaveProperty('replicaSetSupported');
  });
});
