import rateLimit from 'express-rate-limit';

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many authentication attempts. Please try again later.',
    code: 'RATE_LIMITED',
  },
});

export const otpRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many OTP requests. Please wait before retrying.',
    code: 'RATE_LIMITED',
  },
});

export const publicTrackRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many tracking requests. Please try again shortly.',
    code: 'RATE_LIMITED',
  },
});
