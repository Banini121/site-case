import config from './config.js';
import { rateLog } from './logger.js';

class SlidingWindowLimiter {
  constructor({ windowMs, max, blockMs }) {
    this.windowMs = windowMs;
    this.max = max;
    this.blockMs = blockMs;
    this.store = new Map();
  }

  check(key, meta = {}) {
    const now = Date.now();
    const entry = this.store.get(key) || { hits: [], blockedUntil: 0 };
    if (entry.blockedUntil > now) {
      return { allowed: false, retryAfter: entry.blockedUntil - now };
    }

    entry.hits = entry.hits.filter((ts) => ts > now - this.windowMs);
    entry.hits.push(now);

    if (entry.hits.length > this.max) {
      entry.blockedUntil = now + this.blockMs;
      rateLog({ event: 'rate_block', key, meta });
      this.store.set(key, entry);
      return { allowed: false, retryAfter: entry.blockedUntil - now };
    }

    this.store.set(key, entry);
    return { allowed: true };
  }
}

export const perUserLimiter = new SlidingWindowLimiter({
  windowMs: config.rateLimitWindowMs,
  max: config.rateLimitMaxPerUser,
  blockMs: config.rateLimitWindowMs * 5
});

export const loginLimiter = new SlidingWindowLimiter({
  windowMs: config.rateLimitWindowMs,
  max: config.rateLimitLogin,
  blockMs: config.rateLimitWindowMs * 10
});

export const refreshLimiter = new SlidingWindowLimiter({
  windowMs: config.rateLimitWindowMs,
  max: config.rateLimitRefresh,
  blockMs: config.rateLimitWindowMs * 10
});

export const writeLimiter = new SlidingWindowLimiter({
  windowMs: config.rateLimitWindowMs,
  max: config.rateLimitWrite,
  blockMs: config.rateLimitWindowMs * 5
});
