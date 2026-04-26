/**
 * Rate Limiting Configuration
 * Production: Uses Redis for distributed rate limiting.
 * Development: Falls back to in-memory limiting if Redis is offline.
 */

const { rateLimit } = require('express-rate-limit');
const Redis = require('ioredis');
const logger = require('../utils/logger');
const config = require('../config/config');
const isTest = process.env.NODE_ENV === 'test';

let RedisStore;
let redisClient;
let useRedis = false;

// Attempt to establish Redis connection (lazy — won't crash if offline)
try {
  if (!isTest) {
    const { RedisStore: RS } = require('rate-limit-redis');
    RedisStore = RS;

    redisClient = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      lazyConnect: true,        // Don't connect on construction
      enableOfflineQueue: false, // Don't queue commands when offline
      maxRetriesPerRequest: 1,   // Fail fast — don't hang for 20 retries
      retryStrategy: () => null  // Disable automatic reconnect in dev
    });

    redisClient.on('error', (err) => {
      if (useRedis) {
        logger.warn('Redis Rate Limiter Error - falling back to memory', { error: err.message });
        useRedis = false;
      }
    });

    redisClient.connect().then(() => {
      useRedis = true;
      logger.info('Redis Rate Limiter connected');
    }).catch(() => {
      logger.warn('[RateLimiter] Redis offline - using in-memory fallback for rate limiting');
    });
  }

} catch (e) {
  if (!isTest) {
    logger.warn('[RateLimiter] rate-limit-redis not available - using in-memory fallback');
  }
}

/**
 * Build a rate limiter that uses Redis if available, memory otherwise
 */
const makeLimiter = ({ windowMs, limit, keyGenerator, message, prefix, logLabel, skip }) => {
  const opts = {
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message },
    handler: (req, res, next, options) => {
      logger.logRateLimit(logLabel || 'Rate limit exceeded', {
        ip: req.headers['cf-connecting-ip'] || req.ip,
        path: req.path,
        userId: req.user?._id || req.userId
      });
      res.status(options.statusCode).json(options.message);
    }
  };

  if (keyGenerator) opts.keyGenerator = keyGenerator;
  if (skip) opts.skip = skip;

  if (useRedis && RedisStore && redisClient) {
    opts.store = new RedisStore({
      sendCommand: (...args) => redisClient.call(...args),
      prefix: prefix || 'rl:'
    });
  }

  return rateLimit(opts);
};

const GENERAL_LIMIT_SKIP_ROUTES = new Set([
  '/health',
  '/api/health',
  '/api/health/queue',
  '/api/tracking/events',
  '/api/auth/me',
  '/api/profile',
  '/api/integrations',
  '/api/ai-config',
]);

const shouldSkipGeneralLimit = (req) => {
  if (GENERAL_LIMIT_SKIP_ROUTES.has(req.path)) {
    return true;
  }

  if (req.path === '/api/integrations/google/connect') {
    return true;
  }

  return false;
};

// General API rate limiter - tuned to avoid throttling normal dashboard polling
const generalLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 400,
  prefix: 'rl:general:',
  message: 'Too many requests, please try again later.',
  logLabel: 'General rate limit exceeded',
  skip: shouldSkipGeneralLimit
});

// Strict limiter for auth endpoints - 20 requests per 15 minutes
const authLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  prefix: 'rl:auth:',
  message: 'Too many authentication attempts, please try again later.',
  logLabel: 'Auth rate limit exceeded'
});

// AI endpoint: 10 requests per minute per user
const aiLimiter = makeLimiter({
  windowMs: 60 * 1000,
  limit: 10,
  prefix: 'rl:ai:',
  message: 'Rate limit: Max 10 AI generation requests per minute.',
  logLabel: 'AI rate limit exceeded',
  keyGenerator: (req) => req.user?._id?.toString() || req.userId || req.headers['cf-connecting-ip'] || req.ip
});

// Public support assistant: intentionally strict because it can spend AI tokens.
const publicSupportAiLimiter = makeLimiter({
  windowMs: 10 * 60 * 1000,
  limit: 6,
  prefix: 'rl:public-support-ai:',
  message: 'Too many support assistant requests. Please wait a few minutes or create a support ticket.',
  logLabel: 'Public support assistant rate limit exceeded',
  keyGenerator: (req) => req.headers['cf-connecting-ip'] || req.ip
});

module.exports = {
  generalLimiter,
  authLimiter,
  aiLimiter,
  publicSupportAiLimiter
};
