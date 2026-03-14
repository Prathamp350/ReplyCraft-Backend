const { Queue } = require('bullmq');
const IORedis = require('ioredis');
const logger = require('../utils/logger');

const createRedisConnection = require('../config/redis');

// Get the cleaned, standardized Redis connection
const connection = createRedisConnection();

connection.on('error', (err) => {
  logger.error('Redis connection error in reply queue', { error: err.message });
});

// Create the reply queue
const replyQueue = new Queue('reply-generation', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000
    },
    timeout: 60000, // 60 second timeout
    // IDEMPOTENCY: Remove job if it completes within 24 hours
    removeOnComplete: {
      count: 100,
      age: 24 * 3600 // 24 hours
    },
    removeOnFail: {
      count: 100
    }
  }
});

/**
 * Add a reply generation job to the queue
 * IDEMPOTENCY: Uses jobId based on platform + reviewId to prevent duplicate jobs
 */
async function queueReplyGeneration(data) {
  const { reviewId, userId, platform, entityType, reviewText, rating } = data;

  // IDEMPOTENCY KEY: Create unique job ID to prevent duplicate jobs
  const jobId = `${platform || 'unknown'}-${reviewId || Date.now()}`;

  const job = await replyQueue.add('generateReply', {
    reviewId,
    userId,
    platform,
    entityType,
    reviewText,
    rating,
    queuedAt: new Date().toISOString()
  }, {
    jobId, // Use unique job ID for deduplication
    priority: rating <= 2 ? 1 : 2 // Higher priority for negative reviews
  });

  logger.logAI('Job added to queue', { 
    jobId: job.id, 
    reviewId, 
    platform,
    priority: rating <= 2 ? 'high' : 'normal'
  });
  
  return job;
}

/**
 * Add bulk reply generation jobs
 * IDEMPOTENCY: Uses unique job IDs to prevent duplicates
 */
async function queueBulkReplyGeneration(jobs) {
  const bulkJobs = jobs.map((data, index) => {
    // Create unique job ID for deduplication
    const jobId = `${data.platform || 'unknown'}-${data.reviewId || `${Date.now()}-${index}`}`;
    
    return {
      name: 'generateReply',
      data: {
        ...data,
        queuedAt: new Date().toISOString()
      },
      jobId, // Unique job ID prevents duplicates
      priority: data.rating <= 2 ? 1 : 2
    };
  });

  const results = await replyQueue.addBulk(bulkJobs);
  
  logger.logAI('Bulk jobs added to queue', { count: results.length });
  
  return results;
}

/**
 * Get queue statistics
 */
async function getQueueStats() {
  const counts = await replyQueue.getJobCounts('waiting', 'active', 'completed', 'failed');
  return counts;
}

/**
 * Clean old completed/failed jobs
 */
async function cleanOldJobs() {
  await replyQueue.clean(1000 * 60 * 60 * 24, 100); // Clean jobs older than 24 hours
  logger.info('Old jobs cleaned from queue');
}

module.exports = {
  replyQueue,
  queueReplyGeneration,
  queueBulkReplyGeneration,
  getQueueStats,
  cleanOldJobs
};
