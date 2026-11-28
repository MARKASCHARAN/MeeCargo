import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    env: {
      NODE_ENV: 'test',
      PORT: '5000',
      ORIGIN: 'http://localhost:5173',
      MONGODB_URL: 'mongodb://localhost:27017/meecargo_test?replicaSet=rs0',
      JWT_SECRET: 'meecargo-test-jwt-secret-key',
      JWT_REFRESH_SECRET: 'meecargo-test-refresh-secret-key',
    },
  },
});
