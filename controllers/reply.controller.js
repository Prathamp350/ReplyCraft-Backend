const ollamaService = require('../services/ollama.service');
const promptService = require('../services/prompt.service');
const cleanReplyUtil = require('../utils/cleanReply');
const config = require('../config/config');
const RestaurantProfile = require('../models/RestaurantProfile');
const logger = require('../utils/logger');
const { queueLimitReachedEmail } = require('../queues/email.queue');

/**
 * Generate professional reply to customer review (direct AI generation)
 */
const generateReply = async (req, res) => {
  try {
    const { review, model } = req.body;
    const user = req.user;

    // Validate required field
    if (!review || typeof review !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Review text is required'
      });
    }

    // Validate review is not empty
    if (review.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Review text cannot be empty'
      });
    }

    // Validate review length based on plan tier
    const maxLength = user.plan === 'free' ? 1000 : 5000;
    if (review.length > maxLength) {
      return res.status(400).json({
        success: false,
        error: `Review text is too long (max ${maxLength} characters for ${user.plan} plan)`
      });
    }

    // Check monthly usage limit
    const usageInfo = user.checkMonthlyLimit();
    
    if (usageInfo.exceeded) {
      logger.logWarn('Monthly AI usage limit exceeded', { 
        userId: user._id, 
        plan: user.plan,
        limit: usageInfo.limit,
        used: usageInfo.used
      });

      // Queue limit reached email (async, doesn't block API)
      queueLimitReachedEmail({
        name: user.name,
        email: user.email,
        plan: user.plan,
        monthlyUsage: usageInfo
      }).catch(err => {
        logger.error('Failed to queue limit reached email', { error: err.message, userId: user._id });
      });

      return res.status(429).json({
        success: false,
        message: 'Monthly AI usage limit reached. Upgrade your plan for more generation.',
        usage: usageInfo,
        upgradeUrl: '/dashboard/upgrade'
      });
    }

    // Check storage limit before generating
    const storageInfo = user.getStorageInfo();
    if (storageInfo.exceeded) {
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

    // Validate model if provided
    const requestedModel = model && config.allowedModels.includes(model.toLowerCase())
      ? model.toLowerCase()
      : config.ollama.defaultModel;

    // Fetch restaurant profile if exists
    let restaurantProfile = null;
    try {
      restaurantProfile = await RestaurantProfile.findOne({ 
        userId: user._id, 
        isActive: true 
      });
    } catch (error) {
      // Continue without profile if lookup fails
      logger.info('No restaurant profile found, using defaults', { userId: user._id });
    }

    // Build prompt with restaurant context
    const prompt = promptService.buildPrompt(review, restaurantProfile);

    logger.logAI('AI reply generation started', { 
      userId: user._id, 
      model: requestedModel,
      reviewLength: review.length
    });

    // Get response from Ollama
    const rawReply = await ollamaService.generateReply(requestedModel, prompt);

    // Clean the response
    let reply = cleanReplyUtil.cleanReply(rawReply);

    // Append watermark for Free plan users
    const planConfig = user.getPlanConfig();
    if (planConfig.hasWatermark) {
      reply = reply + config.watermarkText;
    }

    // Increment usage counter
    await user.incrementUsage();

    // Track storage usage (approximate: bytes of reply + review stored)
    const storedBytes = Buffer.byteLength(reply, 'utf8') + Buffer.byteLength(review, 'utf8');
    await user.addStorageUsage(storedBytes);

    // Get updated usage
    const updatedUsage = user.checkMonthlyLimit();

    logger.logAI('AI reply generated successfully', { 
      userId: user._id, 
      remaining: updatedUsage.remaining,
      watermark: planConfig.hasWatermark,
      storedBytes
    });

    // Return success response
    return res.status(200).json({
      success: true,
      reply,
      usage: {
        used: updatedUsage.used,
        limit: updatedUsage.limit,
        remaining: updatedUsage.remaining
      }
    });

  } catch (error) {
    logger.error('Generate Reply Error', { error: error.message, stack: error.stack, userId: req.userId });

    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to generate reply'
    });
  }
};

module.exports = {
  generateReply
};
