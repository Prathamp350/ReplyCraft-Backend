const { Worker } = require('bullmq');
const Review = require('../models/Review');
const User = require('../models/User');
const BusinessConnection = require('../models/BusinessConnection');
const platformManager = require('../integrations/platformManager');
const { generateReplyForReview } = require('../services/reviewReply.service');
const { queueReplyGeneration } = require('../queues/reply.queue');
const { storeReplyTemplate } = require('../services/replyReuse.service');
const logger = require('../utils/logger');
const createRedisConnection = require('../config/redis');

let aiWorker = null;

const connection = createRedisConnection();

connection.on('error', () => {});

connection.on('ready', () => {
  logger.info('[AIWorker] Redis connected, starting AI worker');
});

const isRedisReachable = () => connection.status === 'ready';

setTimeout(() => {
  if (!isRedisReachable()) {
    logger.warn('[AIWorker] Redis not available, AI worker disabled');
    return;
  }

  aiWorker = new Worker(
    'reply-generation',
    async (job) => {
      await processReplyJob(job);
    },
    {
      connection,
      concurrency: 3,
      limiter: { max: 10, duration: 1000 },
    }
  );

  aiWorker.on('completed', (job) => logger.logAI('Job completed', { jobId: job.id }));
  aiWorker.on('failed', (job, err) => logger.error('Job failed', { jobId: job?.id, error: err.message }));
  aiWorker.on('error', (error) => logger.error('Worker error', { error: error.message }));

  logger.info('[AIWorker] AI worker started', { concurrency: 3 });
}, 3000);

async function processReplyJob(job) {
  const {
    reviewId,
    userId,
    platform,
    action = 'generateReply',
    replyText: queuedReplyText = null,
  } = job.data;

  logger.logAI('AI job started', { jobId: job.id, reviewId, platform, action });

  try {
    const review = await Review.findOne({ reviewId, userId });

    if (!review) {
      logger.logAI('Review not found, skipping', { reviewId, userId });
      return;
    }

    if (action === 'generateReply' && review.replyStatus === 'posted') {
      logger.logAI('Review already posted, skipping generation', { reviewId });
      return;
    }

    const user = await User.findById(userId);

    if (!user || !user.isActive) {
      logger.warn('[AIWorker] User not found or inactive', { userId });
      await Review.findByIdAndUpdate(review._id, { status: 'failed', replyStatus: 'failed' });
      return;
    }

    const connectionDoc = review.connectionId
      ? await BusinessConnection.findById(review.connectionId)
      : null;

    const usageInfo = user.checkMonthlyLimit();
    if (usageInfo.exceeded) {
      logger.warn('Monthly AI usage limit exceeded', {
        userId,
        limit: usageInfo.limit,
        used: usageInfo.used,
      });
      await Review.findByIdAndUpdate(review._id, { status: 'ignored', replyStatus: 'failed' });
      return;
    }

    if (action === 'postReply') {
      const outgoingReply = queuedReplyText || review.replyText || review.aiReply;

      if (!outgoingReply) {
        throw new Error('No reply text available to post.');
      }

      if (!connectionDoc || !connectionDoc.isActive) {
        throw new Error('Active connection not found for reply posting.');
      }

      await platformManager.postReply(connectionDoc, review.platformReviewId, outgoingReply);

      review.replyText = outgoingReply;
      review.replyStatus = 'posted';
      review.status = 'processed';
      review.replyPostedAt = new Date();
      await review.save();

      await storeReplyTemplate({
        userId: review.userId,
        aiConfigurationId: connectionDoc?.aiConfigurationId || null,
        platform: review.platform,
        rating: review.rating,
        reviewText: review.reviewText,
        replyText: outgoingReply,
        sourceReviewId: review.reviewId,
        sourceConnectionId: review.connectionId,
        wasPosted: true
      });

      logger.logAI('Reply posted from queue', { reviewId, platform });
      return { success: true, reviewId, status: 'posted' };
    }

    const generated = await generateReplyForReview({
      review,
      user,
      connection: connectionDoc,
    });

    review.aiReply = generated.replyText;
    review.replyText = generated.replyMode === 'auto' ? generated.replyText : review.replyText;
    review.sentiment =
      review.rating >= 4 ? 'positive' : review.rating <= 2 ? 'negative' : 'neutral';

    const storedBytes =
      Buffer.byteLength(review.reviewText || '', 'utf8') +
      Buffer.byteLength(generated.replyText || '', 'utf8');

    await storeReplyTemplate({
      userId: review.userId,
      aiConfigurationId: generated.aiConfiguration?._id || connectionDoc?.aiConfigurationId || null,
      platform: review.platform,
      rating: review.rating,
      reviewText: review.reviewText,
      replyText: generated.replyText,
      sourceReviewId: review.reviewId,
      sourceConnectionId: review.connectionId,
      wasPosted: false
    });

    if (generated.effectiveReplyMode === 'auto' && connectionDoc?.isActive) {
      if (generated.replyDelayMinutes > 0) {
        review.replyStatus = 'approved';
        review.status = 'pending_approval';
        await review.save();

        await queueReplyGeneration({
          reviewId: review.reviewId,
          userId: userId.toString(),
          platform: review.platform,
          entityType: review.entityType,
          reviewText: review.reviewText,
          rating: review.rating,
          replyText: generated.replyText,
          action: 'postReply',
          delayMs: generated.replyDelayMinutes * 60 * 1000,
        });
      } else {
        await platformManager.postReply(connectionDoc, review.platformReviewId, generated.replyText);
        review.replyStatus = 'posted';
        review.status = 'processed';
        review.replyPostedAt = new Date();
        await review.save();

        await storeReplyTemplate({
          userId: review.userId,
          aiConfigurationId: generated.aiConfiguration?._id || connectionDoc?.aiConfigurationId || null,
          platform: review.platform,
          rating: review.rating,
          reviewText: review.reviewText,
          replyText: generated.replyText,
          sourceReviewId: review.reviewId,
          sourceConnectionId: review.connectionId,
          wasPosted: true
        });
      }
    } else {
      review.replyStatus = 'pending';
      review.status = 'pending_approval';
      await review.save();
    }

    await user.incrementUsage();
    await user.addStorageUsage(storedBytes);

    logger.logAI('AI job completed', {
      reviewId,
      replyMode: generated.effectiveReplyMode,
      requiresManualApproval: generated.requiresManualApproval,
      status: review.replyStatus,
    });

    return { success: true, reviewId, status: review.replyStatus };
  } catch (error) {
    logger.error('AI job failed', {
      jobId: job.id,
      reviewId,
      error: error.message,
      stack: error.stack,
    });

    try {
      await Review.findOneAndUpdate(
        { reviewId },
        { status: 'failed', replyStatus: 'failed' }
      );
    } catch (updateError) {
      logger.error('Failed to update review status', {
        reviewId,
        error: updateError.message,
      });
    }

    throw error;
  }
}

const gracefulShutdown = async () => {
  logger.info('AI worker shutting down gracefully');
  if (aiWorker) await aiWorker.close();
  process.exit(0);
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

module.exports = {
  aiWorker,
  processReplyJob,
};
