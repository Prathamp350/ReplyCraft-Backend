const AIConfiguration = require('../models/AIConfiguration');
const RestaurantProfile = require('../models/RestaurantProfile');
const googleAiService = require('./googleAi.service');
const promptService = require('./prompt.service');
const cleanReplyUtil = require('../utils/cleanReply');
const { getConfig } = require('./configManager');
const { findReusableReply } = require('./replyReuse.service');

async function getActiveAIConfiguration(userId, connection) {
  if (connection?.aiConfigurationId) {
    const assigned = await AIConfiguration.findOne({
      _id: connection.aiConfigurationId,
      userId,
      isActive: true,
    });

    if (assigned) {
      return assigned;
    }
  }

  const defaultConfig = await AIConfiguration.findOne({
    userId,
    isActive: true,
    isDefault: true,
  });

  if (defaultConfig) {
    return defaultConfig;
  }

  return AIConfiguration.findOne({
    userId,
    isActive: true,
  }).sort({ createdAt: 1 });
}

async function getRestaurantProfile(userId) {
  try {
    return await RestaurantProfile.findOne({
      userId,
      isActive: true,
    });
  } catch (error) {
    return null;
  }
}

async function generateReplyForReview({ review, user, connection = null }) {
  const [aiConfiguration, restaurantProfile] = await Promise.all([
    getActiveAIConfiguration(user._id, connection),
    getRestaurantProfile(user._id),
  ]);

  const configuredReplyMode = aiConfiguration?.replyMode || 'manual';
  const manualApprovalThreshold =
    user.plan !== 'free' &&
    restaurantProfile?.manualApprovalBelowRatingEnabled &&
    Number.isFinite(restaurantProfile?.manualApprovalBelowRating)
      ? Number(restaurantProfile.manualApprovalBelowRating)
      : null;

  const requiresManualApproval =
    manualApprovalThreshold !== null &&
    Number.isFinite(review.rating) &&
    review.rating <= manualApprovalThreshold;

  const reusableReply = await findReusableReply({
    userId: user._id,
    aiConfigurationId: aiConfiguration?._id || null,
    platform: review.platform,
    rating: review.rating,
    reviewText: review.reviewText,
  });

  if (reusableReply) {
    let cachedReply = reusableReply.replyText;
    const planConfig = user.getPlanConfig();

    if (planConfig.hasWatermark && !cachedReply.endsWith(getConfig().watermarkText)) {
      cachedReply += getConfig().watermarkText;
    }

    return {
      replyText: cachedReply,
      aiConfiguration,
      restaurantProfile,
      replyMode: configuredReplyMode,
      effectiveReplyMode:
        configuredReplyMode === 'auto' && requiresManualApproval ? 'manual' : configuredReplyMode,
      replyDelayMinutes: aiConfiguration?.replyDelayMinutes || 0,
      requiresManualApproval,
      manualApprovalThreshold,
      reusedFromCache: true,
      cacheMatchType: reusableReply.matchType,
      cacheId: reusableReply.cacheId,
    };
  }

  const prompt = promptService.buildPrompt(review.reviewText, restaurantProfile, aiConfiguration, {
    author: review.author,
    rating: review.rating,
    platform: review.platform,
    businessName: connection?.locationName || aiConfiguration?.businessName || user.businessName,
  });

  const rawReply = await googleAiService.generateText({
    prompt,
    systemInstruction: aiConfiguration?.systemPrompt,
    taskType: 'review_reply',
    quality: 'standard',
    ...(process.env.GOOGLE_AI_TUNED_MODEL
      ? { model: process.env.GOOGLE_AI_TUNED_MODEL }
      : {}),
  });

  let replyText = cleanReplyUtil.cleanReply(rawReply);
  const planConfig = user.getPlanConfig();

  if (planConfig.hasWatermark) {
    replyText += getConfig().watermarkText;
  }

  return {
    replyText,
    aiConfiguration,
    restaurantProfile,
    replyMode: configuredReplyMode,
    effectiveReplyMode:
      configuredReplyMode === 'auto' && requiresManualApproval ? 'manual' : configuredReplyMode,
    replyDelayMinutes: aiConfiguration?.replyDelayMinutes || 0,
    requiresManualApproval,
    manualApprovalThreshold,
    reusedFromCache: false,
    cacheMatchType: null,
    cacheId: null,
  };
}

module.exports = {
  generateReplyForReview,
  getActiveAIConfiguration,
};
