const { Worker, Job } = require('bullmq');
const IORedis = require('ioredis');
const Review = require('../models/Review');
const User = require('../models/User');
const RestaurantProfile = require('../models/RestaurantProfile');
const ollamaService = require('../services/ollama.service');
const promptService = require('../services/prompt.service');
const cleanReplyUtil = require('../utils/cleanReply');
const config = require('../config/config');
const logger = require('../utils/logger');

// Import platform services
const googleReviewsService = require('../services/googleReviews.service');

const createRedisConnection = require('../config/redis');

let aiWorker = null;

// Only start if Redis is available
const connection = createRedisConnection();

connection.on('error', () => {}); // suppress — handled by retryStrategy

connection.on('ready', () => {
  logger.info('[AIWorker] Redis connected — starting AI Worker');
});

const isRedisReachable = () => connection.status === 'ready';

// Defer worker creation until after initial connection attempt
setTimeout(() => {
  if (!isRedisReachable()) {
    logger.warn('[AIWorker] Redis not available — AI Worker disabled (dev mode)');
    return;
  }

  aiWorker = new Worker('reply-generation', async (job) => {
    await processReplyJob(job);
  }, {
    connection,
    concurrency: 3,
    limiter: { max: 10, duration: 1000 }
  });

  aiWorker.on('completed', (job) => logger.logAI('Job completed', { jobId: job.id }));
  aiWorker.on('failed', (job, err) => logger.error('Job failed', { jobId: job?.id, error: err.message }));
  aiWorker.on('error', (error) => logger.error('Worker error', { error: error.message }));

  logger.info('[AIWorker] AI Worker started', { concurrency: 3 });
}, 3000);

/**
 * Process a reply generation job
 */
async function processReplyJob(job) {
  const { reviewId, userId, platform, entityType, reviewText, rating } = job.data;
  
  logger.logAI('AI job started', { jobId: job.id, reviewId, platform });

  try {
    // Fetch review from database
    const review = await Review.findOne({ reviewId });
    
    if (!review) {
      logger.logAI('Review not found, skipping', { reviewId });
      return;
    }

    // Check if already processed
    if (review.status === 'processed' || review.status === 'pending_approval') {
      logger.logAI('Review already processed, skipping', { reviewId, status: review.status });
      return;
    }

    // Get user
    const user = await User.findById(userId);
    
    if (!user || !user.isActive) {
      logger.warn('[AIWorker] User not found or inactive', { userId });
      await Review.findByIdAndUpdate(review._id, { status: 'failed' });
      return;
    }

    // Fetch restaurant profile for reply settings
    let restaurantProfile = null;
    try {
      restaurantProfile = await RestaurantProfile.findOne({ 
        userId, 
        isActive: true 
      });
    } catch (error) {
      logger.info('No restaurant profile found, using defaults', { userId });
    }

    // Determine reply mode
    const replyMode = restaurantProfile?.replyMode || 'auto';

    // Check monthly usage limit
    const usageInfo = user.checkMonthlyLimit();
    
    if (usageInfo.exceeded) {
      logger.warn('Monthly AI usage limit exceeded', { userId, limit: usageInfo.limit, used: usageInfo.used });
      await Review.findByIdAndUpdate(review._id, { status: 'ignored' });
      return;
    }

    // Generate AI reply
    const prompt = promptService.buildPrompt(reviewText, restaurantProfile);
    const rawReply = await ollamaService.generateReply(config.ollama.defaultModel, prompt);
    let replyText = cleanReplyUtil.cleanReply(rawReply);

    if (user.plan === 'free') {
      replyText += '\n\n*Powered by ReplyCraft*';
    }

    // Handle based on reply mode and platform
    if (replyMode === 'auto') {
      // Post reply to platform
      await postReplyToPlatform(platform, review, replyText);
      
      await Review.findByIdAndUpdate(review._id, {
        replyText,
        status: 'processed',
        replyPostedAt: new Date()
      });
      
      logger.logAI('AI reply generated and posted', { reviewId, status: 'processed' });
    } else {
      // Manual mode - save for approval
      await Review.findByIdAndUpdate(review._id, {
        replyText,
        status: 'pending_approval'
      });
      
      logger.logAI('AI reply generated, awaiting approval', { reviewId, status: 'pending_approval' });
    }

    // Increment usage
    await user.incrementUsage();
    
    logger.logAI('AI job completed', { reviewId, replyMode });
    
    return { success: true, reviewId, status: replyMode === 'auto' ? 'processed' : 'pending_approval' };

  } catch (error) {
    logger.error('AI job failed', { jobId: job.id, reviewId, error: error.message, stack: error.stack });
    
    // Update review status to failed
    try {
      await Review.findOneAndUpdate(
        { reviewId },
        { status: 'failed' }
      );
    } catch (updateError) {
      logger.error('Failed to update review status', { reviewId, error: updateError.message });
    }
    
    throw error; // Re-throw to trigger retry
  }
}

/**
 * Post reply to the appropriate platform
 */
async function postReplyToPlatform(platform, review, replyText) {
  switch (platform) {
    case 'google':
      await postToGoogle(review, replyText);
      break;
    case 'yelp':
      await postToYelp(review, replyText);
      break;
    case 'tripadvisor':
      await postToTripAdvisor(review, replyText);
      break;
    case 'appstore':
    case 'playstore':
      // App store reviews typically don't support replies via API
      logger.info(`Platform ${platform} doesn't support API replies`);
      break;
    default:
      logger.warn(`Unknown platform: ${platform}`);
  }
}

/**
 * Post reply to Google
 */
async function postToGoogle(review, replyText) {
  try {
    const BusinessConnection = require('../models/BusinessConnection');
    const connection = await BusinessConnection.findById(review.connectionId);
    
    if (connection && connection.isActive) {
      await googleReviewsService.postReply(connection, review.reviewId, replyText);
      logger.logAI('Reply posted to Google', { reviewId: review.reviewId });
    }
  } catch (error) {
    logger.error('Error posting to Google', { reviewId: review.reviewId, error: error.message });
    throw error;
  }
}

/**
 * Post reply to Yelp
 */
async function postToYelp(review, replyText) {
  // TODO: Implement Yelp API integration
  logger.info('Yelp integration not implemented yet');
}

/**
 * Post reply to TripAdvisor
 */
async function postToTripAdvisor(review, replyText) {
  // TODO: Implement TripAdvisor API integration
  logger.info('TripAdvisor integration not implemented yet');
}

// Graceful shutdown
const gracefulShutdown = async () => {
  logger.info('AI Worker shutting down gracefully');
  if (aiWorker) await aiWorker.close();
  process.exit(0);
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

module.exports = {
  aiWorker,
  processReplyJob
};
