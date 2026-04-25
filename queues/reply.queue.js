const { Queue } = require('bullmq');
const logger = require('../utils/logger');

const createRedisConnection = require('../config/redis');
const isTest = process.env.NODE_ENV === 'test';

const createMockReplyQueue = () => ({
  add: async (name, data, options = {}) => ({
    id: options.jobId || `mock-${Date.now()}`,
    name,
    data,
  }),
  addBulk: async (jobs) =>
    jobs.map((job, index) => ({
      id: job.jobId || `mock-${index}`,
      name: job.name,
      data: job.data,
    })),
  getJobCounts: async () => ({
    waiting: 0,
    active: 0,
    completed: 0,
    failed: 0,
    delayed: 0,
  }),
  getWorkers: async () => [],
  getWaiting: async () => [],
  getCompleted: async () => [],
  getFailed: async () => [],
  clean: async () => undefined,
});

const replyQueue = isTest
  ? createMockReplyQueue()
  : (() => {
      const connection = createRedisConnection();

      connection.on('error', (err) => {
        logger.error('Redis connection error in reply queue', { error: err.message });
      });

      return new Queue('reply-generation', {
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
    })();

/**
 * Add a reply generation job to the queue
 * IDEMPOTENCY: Uses jobId based on platform + reviewId to prevent duplicate jobs
 */
async function queueReplyGeneration(data) {
  const {
    reviewId,
    userId,
    platform,
    entityType,
    reviewText,
    rating,
    action = 'generateReply',
    replyText = null,
    delayMs = 0
  } = data;

  // IDEMPOTENCY KEY: Create unique job ID to prevent duplicate jobs
  const jobId = `${userId || 'unknown-user'}-${platform || 'unknown'}-${reviewId || Date.now()}-${action}`;

  const job = await replyQueue.add('generateReply', {
    reviewId,
    userId,
    platform,
    entityType,
    reviewText,
    rating,
    action,
    replyText,
    queuedAt: new Date().toISOString()
  }, {
    jobId, // Use unique job ID for deduplication
    priority: rating <= 2 ? 1 : 2, // Higher priority for negative reviews
    ...(delayMs > 0 ? { delay: delayMs } : {})
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
    const action = data.action || 'generateReply';
    const jobId = `${data.userId || 'unknown-user'}-${data.platform || 'unknown'}-${data.reviewId || `${Date.now()}-${index}`}-${action}`;
    
    return {
      name: 'generateReply',
      data: {
        ...data,
        queuedAt: new Date().toISOString()
      },
      jobId, // Unique job ID prevents duplicates
      priority: data.rating <= 2 ? 1 : 2,
      ...(data.delayMs > 0 ? { delay: data.delayMs } : {})
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
