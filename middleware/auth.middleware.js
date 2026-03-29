/**
 * Unified Authentication Middleware
 * Supports both Firebase ID tokens and JWT tokens
 * Extracts user from database and attaches to request
 */

const jwt = require('jsonwebtoken');
const config = require('../config/config');
const User = require('../models/User');
const logger = require('../utils/logger');

/**
 * Main authentication middleware
 * Accepts either Firebase ID token or JWT token
 */
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required. No token provided.'
      });
    }
    
    const token = authHeader.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Token is required.'
      });
    }

    let user = null;
    let authMethod = 'jwt';

    try {
        const decoded = jwt.verify(token, config.jwt.secret);
        
        user = await User.findById(decoded.userId);
        
        if (!user) {
          return res.status(401).json({
            success: false,
            error: 'Invalid token. User not found.'
          });
        }
        
      } catch (jwtError) {
        return res.status(401).json({
          success: false,
          error: 'Invalid or expired token. Please login again.'
        });
      }

    // Check if user is active
    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        error: 'Account is deactivated. Please contact support.'
      });
    }

    // Check and sync subscription status
    await user.syncSubscriptionStatus();

    // Normalize monthly usage counters when the month rolls over.
    if (typeof user.checkMonthlyLimit === 'function') {
      user.checkMonthlyLimit();
      if (user.isModified('monthlyUsage')) {
        await user.save();
      }
    }

    // Attach user to request
    req.user = user;
    req.userId = user._id;
    req.authMethod = authMethod;

    next();
    
  } catch (error) {
    logger.error('Authentication Middleware Error', { 
      error: error.message, 
      stack: error.stack 
    });
    
    return res.status(500).json({
      success: false,
      error: 'Authentication error. Please try again.'
    });
  }
};

/**
 * Require premium subscription (any paid plan)
 * Use after authenticate middleware
 */
const requirePremium = (req, res, next) => {
  const user = req.user;
  
  if (!user) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required.'
    });
  }

  // All paid plans from centralized config
  const paidPlans = config.validPlans.filter(p => p !== 'free');
  
  if (!paidPlans.includes(user.plan)) {
    return res.status(403).json({
      success: false,
      error: 'Premium subscription required.',
      code: 'PREMIUM_REQUIRED',
      currentPlan: user.plan
    });
  }

  next();
};

/**
 * Check daily usage limit
 * Use after authenticate middleware
 */
const checkUsageLimit = async (req, res, next) => {
  const user = req.user;
  
  if (!user) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required.'
    });
  }

  const usage = user.checkMonthlyLimit();
  
  if (usage.exceeded) {
    return res.status(429).json({
      success: false,
      error: 'Monthly usage limit exceeded.',
      code: 'USAGE_LIMIT_EXCEEDED',
      used: usage.used,
      limit: usage.limit,
      remaining: usage.remaining
    });
  }

  // Attach usage info to request
  req.usage = usage;
  
  next();
};

/**
 * Authorize specific roles
 * Use after authenticate middleware
 */
const authorizeRoles = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: `Access denied. Requires one of these roles: ${roles.join(', ')}`
      });
    }
    next();
  };
};

module.exports = {
  authenticate,
  requirePremium,
  checkUsageLimit,
  authorizeRoles
};
