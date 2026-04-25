const rateLimit = require('express-rate-limit');
const { getConfig } = require('../services/configManager');
const baseConfig = require('../config/config');
const createRedisConnection = require('../config/redis');
const logger = require('../utils/logger');

// In-memory store for per-minute rate limiting
const minuteRequestCounts = new Map();
let redisClient = null;
let redisReady = false;

try {
  redisClient = createRedisConnection();
  redisClient.on('ready', () => {
    redisReady = true;
  });
  redisClient.on('error', () => {
    redisReady = false;
  });
} catch (error) {
  redisClient = null;
}

/**
 * Create rate limiter based on user plan
 */
const createPlanRateLimiter = () => {
  return rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: (req) => {
      const plan = req.user?.plan || baseConfig.defaultPlan;
      return getConfig().plans[plan]?.perMinute || getConfig().plans.free.perMinute;
    },
    message: {
      success: false,
      error: 'Too many requests, please slow down'
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      return req.userId?.toString() || req.ip;
    },
    skip: (req) => {
      // Skip if no user (auth middleware will handle it)
      return !req.userId;
    }
  });
};

/**
 * Custom rate limiter using in-memory store
 * More control over per-user tracking
 */
const customRateLimiter = (req, res, next) => {
  if (!req.userId) {
    return next();
  }

  const userId = req.userId.toString();
  const now = Date.now();
  const windowStart = now - 60 * 1000; // 1 minute window
  const plan = req.user?.plan || baseConfig.defaultPlan;
  const limit = getConfig().plans[plan]?.perMinute || getConfig().plans.free.perMinute;

  const reject = () =>
    res.status(429).json({
      success: false,
      error: 'Too many requests, please slow down'
    });

  const applyMemoryLimit = () => {
    let requestTimes = minuteRequestCounts.get(userId) || [];
    requestTimes = requestTimes.filter((timestamp) => timestamp > windowStart);

    if (requestTimes.length >= limit) {
      logger.logRateLimit('Minute limit exceeded', { userId, plan, source: 'memory' });
      return reject();
    }

    requestTimes.push(now);
    minuteRequestCounts.set(userId, requestTimes);

    if (minuteRequestCounts.size > 10000) {
      cleanupMinuteCounts();
    }

    return next();
  };

  if (!redisClient || !redisReady) {
    return applyMemoryLimit();
  }

  const windowKey = `rl:reply:${userId}:${Math.floor(now / 60000)}`;
  redisClient
    .multi()
    .incr(windowKey)
    .pexpire(windowKey, 60 * 1000)
    .exec()
    .then((result) => {
      const currentCount = Number(result?.[0]?.[1] || 0);
      if (currentCount > limit) {
        logger.logRateLimit('Minute limit exceeded', { userId, plan, source: 'redis' });
        return reject();
      }

      return next();
    })
    .catch((error) => {
      logger.warn('[RateLimit] Redis limiter failed, falling back to memory', {
        error: error.message,
        userId,
      });
      redisReady = false;
      return applyMemoryLimit();
    });
};

/**
 * Clean up old minute request counts
 */
function cleanupMinuteCounts() {
  const now = Date.now();
  const windowStart = now - 60 * 1000;
  
  for (const [userId, requestTimes] of minuteRequestCounts.entries()) {
    const recent = requestTimes.filter(t => t > windowStart);
    if (recent.length === 0) {
      minuteRequestCounts.delete(userId);
    } else {
      minuteRequestCounts.set(userId, recent);
    }
  }
}

// Cleanup every 5 minutes
setInterval(cleanupMinuteCounts, 5 * 60 * 1000);

module.exports = {
  createPlanRateLimiter,
  customRateLimiter
};
