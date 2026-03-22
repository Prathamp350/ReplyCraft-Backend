/**
 * Premium Feature Middleware
 * Restricts access to premium features based on user plan
 */

const User = require('../models/User');
const logger = require('../utils/logger');

const PREMIUM_PLANS = ['starter', 'pro', 'business'];

/**
 * Middleware to check if user has premium subscription
 * Use after authenticate middleware
 */
const requirePremium = async (req, res, next) => {
  try {
    const user = req.user;
    
    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required.'
      });
    }

    if (!PREMIUM_PLANS.includes(user.plan)) {
      logger.warn('Premium feature access denied', {
        userId: user._id,
        plan: user.plan,
        path: req.path
      });
      
      return res.status(403).json({
        success: false,
        error: 'Premium subscription required to access this feature.',
        code: 'PREMIUM_REQUIRED',
        currentPlan: user.plan,
        upgradeUrl: '/dashboard/upgrade'
      });
    }

    next();
  } catch (error) {
    logger.error('Premium check error', { error: error.message });
    return res.status(500).json({
      success: false,
      error: 'Authorization check failed.'
    });
  }
};

/**
 * Middleware to check current usage limit
 * Use after authenticate middleware
 */
const checkDailyLimit = async (req, res, next) => {
  try {
    const user = req.user;
    
    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required.'
      });
    }

    const usageInfo = typeof user.checkMonthlyLimit === 'function'
      ? user.checkMonthlyLimit()
      : { used: user.monthlyUsage?.count || 0, limit: 30, remaining: 30, exceeded: false };

    if (user.isModified('monthlyUsage')) {
      await user.save();
    }

    if (usageInfo.exceeded) {
      logger.warn('Daily limit exceeded', {
        userId: user._id,
        usage: usageInfo.used,
        limit: usageInfo.limit,
        plan: user.plan
      });
      
      return res.status(429).json({
        success: false,
        error: 'Usage limit exceeded.',
        code: 'USAGE_LIMIT_EXCEEDED',
        used: usageInfo.used,
        limit: usageInfo.limit,
        remaining: usageInfo.remaining,
        upgradeUrl: '/dashboard/upgrade'
      });
    }

    // Attach usage info to request
    req.usage = {
      used: usageInfo.used,
      limit: usageInfo.limit,
      remaining: usageInfo.remaining
    };
    
    next();
  } catch (error) {
    logger.error('Daily limit check error', { error: error.message });
    // Don't block request on error
    next();
  }
};

/**
 * Increment daily usage count
 * Call after successful AI reply generation
 */
const incrementUsage = async (userId, count = 1) => {
  try {
    const user = await User.findById(userId);
    if (!user) return;
    
    if (typeof user.incrementUsage === 'function') {
      for (let i = 0; i < count; i += 1) {
        await user.incrementUsage();
      }
    }
  } catch (error) {
    logger.error('Failed to increment usage', { error: error.message, userId });
  }
};

module.exports = {
  requirePremium,
  checkDailyLimit,
  incrementUsage,
  PREMIUM_PLANS
};
