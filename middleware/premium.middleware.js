/**
 * Premium Feature Middleware
 * Restricts access to features based on user plan
 * Enforces platform, storage, and reply limits
 */

const User = require('../models/User');
const BusinessConnection = require('../models/BusinessConnection');
const config = require('../config/config');
const logger = require('../utils/logger');

const PREMIUM_PLANS = config.validPlans.filter(p => p !== 'free');

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
 * Require a minimum plan tier
 * Usage: requirePlan('pro') — allows pro, business
 */
const requirePlan = (minPlan) => {
  const planOrder = { free: 0, starter: 1, pro: 2, business: 3 };
  const minOrder = planOrder[minPlan] || 0;

  return (req, res, next) => {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ success: false, error: 'Authentication required.' });
    }

    const userOrder = planOrder[user.plan] || 0;
    if (userOrder < minOrder) {
      return res.status(403).json({
        success: false,
        error: `This feature requires the ${config.plans[minPlan]?.name || minPlan} plan or higher.`,
        code: 'PLAN_REQUIRED',
        currentPlan: user.plan,
        requiredPlan: minPlan,
        upgradeUrl: '/dashboard/upgrade'
      });
    }

    next();
  };
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
      logger.warn('Monthly limit exceeded', {
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
 * Check if user can connect another platform
 * Use after authenticate middleware, before creating a new integration
 */
const checkPlatformLimit = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ success: false, error: 'Authentication required.' });
    }

    const planConfig = user.getPlanConfig();
    
    // Unlimited platforms for business
    if (planConfig.platformLimit === Infinity) {
      return next();
    }

    // Count active connections
    const activeCount = await BusinessConnection.countDocuments({
      userId: user._id,
      isActive: true
    });

    if (activeCount >= planConfig.platformLimit) {
      logger.warn('Platform limit reached', {
        userId: user._id,
        plan: user.plan,
        connected: activeCount,
        limit: planConfig.platformLimit
      });

      return res.status(403).json({
        success: false,
        error: `Your ${planConfig.name} plan supports up to ${planConfig.platformLimit} platform(s). Upgrade to connect more.`,
        code: 'PLATFORM_LIMIT_REACHED',
        connected: activeCount,
        limit: planConfig.platformLimit,
        upgradeUrl: '/dashboard/upgrade'
      });
    }

    req.platformUsage = { connected: activeCount, limit: planConfig.platformLimit };
    next();
  } catch (error) {
    logger.error('Platform limit check error', { error: error.message });
    next(); // Don't block on error
  }
};

/**
 * Check if user has available storage
 * Use after authenticate middleware, before storing data
 */
const checkStorageLimit = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ success: false, error: 'Authentication required.' });
    }

    const storageInfo = user.getStorageInfo();

    if (storageInfo.exceeded) {
      logger.warn('Storage limit exceeded', {
        userId: user._id,
        plan: user.plan,
        usedMB: storageInfo.usedMB,
        totalLimitMB: storageInfo.totalLimitMB
      });

      return res.status(403).json({
        success: false,
        error: 'Storage limit exceeded. Upgrade your plan or purchase additional storage.',
        code: 'STORAGE_LIMIT_EXCEEDED',
        usedMB: storageInfo.usedMB,
        totalLimitMB: storageInfo.totalLimitMB,
        canBuyExtra: storageInfo.canBuyExtra,
        upgradeUrl: '/dashboard/upgrade'
      });
    }

    req.storageInfo = storageInfo;
    next();
  } catch (error) {
    logger.error('Storage limit check error', { error: error.message });
    next(); // Don't block on error
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
  requirePlan,
  checkDailyLimit,
  checkPlatformLimit,
  checkStorageLimit,
  incrementUsage,
  PREMIUM_PLANS
};
