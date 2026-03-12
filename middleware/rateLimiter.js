/**
 * Rate Limiting Configuration
 * Global rate limiting for API endpoints
 */

const rateLimit = require('express-rate-limit');
const logger = require('../utils/logger');

// General API rate limiter - 100 requests per 15 minutes
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: {
    success: false,
    message: 'Too many requests, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next, options) => {
    logger.logRateLimit('General rate limit exceeded', {
      ip: req.ip,
      path: req.path,
      method: req.method
    });
    res.status(options.statusCode).json(options.message);
  }
});

// Strict limiter for auth endpoints - 100 requests per 15 minutes for easier local testing
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: {
    success: false,
    message: 'Too many authentication attempts, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next, options) => {
    logger.logRateLimit('Auth rate limit exceeded', {
      ip: req.ip,
      path: req.path,
      email: req.body.email
    });
    res.status(options.statusCode).json(options.message);
  }
});

// AI generation limiter - 20 requests per hour per user
const aiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20,
  keyGenerator: (req) => {
    // Use user ID if authenticated, otherwise use IP
    return req.userId || req.ip;
  },
  message: {
    success: false,
    message: 'AI generation limit exceeded. Please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next, options) => {
    logger.logRateLimit('AI rate limit exceeded', {
      userId: req.userId,
      ip: req.ip
    });
    res.status(options.statusCode).json(options.message);
  }
});

module.exports = {
  generalLimiter,
  authLimiter,
  aiLimiter
};
