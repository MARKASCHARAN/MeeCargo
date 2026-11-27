import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(5000),
  ORIGIN: z.string().url().default('http://localhost:5173'),
  MONGODB_URL: z.string().min(1, 'MONGODB_URL is required (see backend/.env.example)'),
  JWT_SECRET: z.string().min(8, 'JWT_SECRET must be at least 8 characters'),
  JWT_REFRESH_SECRET: z.string().min(8).default('meecargo-dev-refresh-secret-change-me'),
  VOLUMETRIC_DIVISOR: z.coerce.number().positive().default(5000),
  TOKEN_PERCENTAGE: z.coerce.number().min(5).max(50).default(15),
  PAYMENT_MODE: z.enum(['SIMULATED', 'TEST_GATEWAY']).default('SIMULATED'),
  ROUTING_PROVIDER: z.enum(['FIXTURE', 'OSRM']).default('FIXTURE'),
  OSRM_BASE_URL: z.string().url().default('https://router.project-osrm.org'),
  OPTIMIZER_URL: z.string().url().default('http://localhost:8000'),
  OPTIMIZER_TIMEOUT_MS: z.coerce.number().int().min(500).max(30000).default(5000),
  GEOCODING_PROVIDER: z.enum(['FIXTURE', 'NOMINATIM']).default('FIXTURE'),
  NOTIFICATION_PROVIDER: z.enum(['CONSOLE', 'WEBHOOK']).default('CONSOLE'),
  CO2_EMISSIONS_FACTOR_KG_PER_TON_KM: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.coerce.number().nonnegative().optional()
  ),
});

export type EnvConfig = z.infer<typeof envSchema>;

export function loadEnv(raw: NodeJS.ProcessEnv = process.env): EnvConfig {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || 'env'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export const env = loadEnv();
