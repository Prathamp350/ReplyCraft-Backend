const logger = require('../utils/logger');
const { queueLimitReachedEmail } = require('../queues/email.queue');
const Review = require('../models/Review');
const { generateReplyForReview } = require('../services/reviewReply.service');

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

    logger.logAI('AI reply generation started', { 
      userId: user._id, 
      reviewLength: review.length
    });

    const temporaryReview = new Review({
      reviewId: `direct_${user._id}_${Date.now()}`,
      userId: user._id,
      platform: 'google',
      reviewText: review,
      rating: 5,
      author: 'Customer'
    });

    const generated = await generateReplyForReview({
      review: temporaryReview,
      user,
      connection: null
    });
    const reply = generated.replyText;

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
      watermark: user.getPlanConfig().hasWatermark,
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
