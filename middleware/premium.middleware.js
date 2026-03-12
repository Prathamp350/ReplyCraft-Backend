/**
 * Premium Feature Middleware
 * Restricts access to premium features based on user plan
 */

const User = require('../models/User');
const logger = require('../utils/logger');

const PREMIUM_PLANS = ['pro', 'ultra', 'enterprise'];

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
 * Middleware to check daily usage limit
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

    // Get plan limits
    const planLimits = {
      free: 5,
      go: 200,
      pro: 1000,
      ultra: 5000
    };
    
    const limit = planLimits[user.plan] || 5;
    const usage = user.dailyUsage?.count || 0;
    
    // Reset daily count if it's a new day
    const lastReset = user.dailyUsage?.lastReset;
    if (lastReset) {
      const today = new Date();
      const resetDate = new Date(lastReset);
      if (today.toDateString() !== resetDate.toDateString()) {
        // Reset count
        user.dailyUsage.count = 0;
        user.dailyUsage.lastReset = new Date();
        await user.save();
      }
    }

    if (usage >= limit) {
      logger.warn('Daily limit exceeded', {
        userId: user._id,
        usage,
        limit,
        plan: user.plan
      });
      
      return res.status(429).json({
        success: false,
        error: 'Daily usage limit exceeded.',
        code: 'DAILY_LIMIT_EXCEEDED',
        used: usage,
        limit: limit,
        remaining: 0,
        upgradeUrl: '/dashboard/upgrade'
      });
    }

    // Attach usage info to request
    req.usage = {
      used,
      limit,
      remaining: limit - usage
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
    
    if (!user.dailyUsage) {
      user.dailyUsage = { count: 0, lastReset: new Date() };
    }
    
    user.dailyUsage.count += count;
    await user.save();
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
