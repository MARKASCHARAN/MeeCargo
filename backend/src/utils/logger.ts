const SENSITIVE_KEY_PATTERN =
  /(password|token|secret|otp|providerref|paymentref|refundref|phone|email|gstin|authorization|cookie)/i;

export function redactSensitiveData(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || value === undefined) return value;
  if (typeof value === 'string') {
    if (value.startsWith('Bearer ')) return 'Bearer [REDACTED]';
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveData(item, depth + 1));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(k)) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = redactSensitiveData(v, depth + 1);
      }
    }
    return out;
  }
  return value;
}

export const logger = {
  info(message: string, meta?: unknown) {
    if (meta !== undefined) {
      console.log(message, redactSensitiveData(meta));
    } else {
      console.log(message);
    }
  },
  warn(message: string, meta?: unknown) {
    if (meta !== undefined) {
      console.warn(message, redactSensitiveData(meta));
    } else {
      console.warn(message);
    }
  },
  error(message: string, meta?: unknown) {
    if (meta !== undefined) {
      console.error(message, redactSensitiveData(meta));
    } else {
      console.error(message);
    }
  },
};
