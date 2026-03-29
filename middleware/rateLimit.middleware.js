const rateLimit = require('express-rate-limit');
const { getConfig } = require('../services/configManager');
const baseConfig = require('../config/config');

// In-memory store for per-minute rate limiting
const minuteRequestCounts = new Map();

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
  
  // Get user's request history
  let requestTimes = minuteRequestCounts.get(userId) || [];
  
  // Filter out old requests
  requestTimes = requestTimes.filter(timestamp => timestamp > windowStart);
  
  const plan = req.user?.plan || baseConfig.defaultPlan;
  const limit = getConfig().plans[plan]?.perMinute || getConfig().plans.free.perMinute;
  
  // Check if limit exceeded
  if (requestTimes.length >= limit) {
    console.log(`[RateLimit] Minute limit exceeded for user: ${userId}, plan: ${plan}`);
    return res.status(429).json({
      success: false,
      error: 'Too many requests, please slow down'
    });
  }
  
  // Add current request
  requestTimes.push(now);
  minuteRequestCounts.set(userId, requestTimes);
  
  // Cleanup old entries periodically
  if (minuteRequestCounts.size > 10000) {
    cleanupMinuteCounts();
  }
  
  next();
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
