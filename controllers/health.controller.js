/**
 * Health Check Controller
 * Provides system health status for monitoring
 */

const mongoose = require('mongoose');
const Redis = require('ioredis');
const config = require('../config/config');
const { replyQueue } = require('../queues/reply.queue');
const logger = require('../utils/logger');

// Create Redis connection for health check
const createRedisConnection = () => {
  return new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT) || 6379,
    lazyConnect: true,
    connectionName: 'health-check'
  });
};

/**
 * Get comprehensive system health
 */
const getHealth = async (req, res) => {
  const health = {
    server: 'ok',
    database: 'unknown',
    redis: 'unknown',
    queue: 'unknown',
    timestamp: Date.now()
  };

  // Check MongoDB
  try {
    const mongoStatus = mongoose.connection.readyState;
    health.database = mongoStatus === 1 ? 'ok' : 'error';
  } catch (error) {
    health.database = 'error';
  }

  // Check Redis
  let redisClient;
  try {
    redisClient = createRedisConnection();
    await redisClient.connect();
    await redisClient.ping();
    health.redis = 'ok';
  } catch (error) {
    health.redis = 'error';
  } finally {
    if (redisClient) {
      try {
        await redisClient.quit();
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  }

  // Check Queue
  try {
    const counts = await replyQueue.getJobCounts('waiting', 'active', 'completed', 'failed');
    health.queue = counts ? 'ok' : 'error';
    health.queueStats = counts;
  } catch (error) {
    health.queue = 'error';
  }

  // Return appropriate status code
  const allHealthy = health.server === 'ok' && 
                    health.database === 'ok' && 
                    health.redis === 'ok' && 
                    health.queue === 'ok';

  res.status(allHealthy ? 200 : 503).json({
    success: true,
    ...health
  });
};

/**
 * Get detailed queue metrics
 */
const getQueueMetrics = async (req, res) => {
  try {
    const counts = await replyQueue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
    
    // Get workers info
    const workers = await replyQueue.getWorkers();
    
    // Get waiting jobs (first 10)
    const waitingJobs = await replyQueue.getWaiting(0, 10);
    const recentCompleted = await replyQueue.getCompleted(0, 10);
    const recentFailed = await replyQueue.getFailed(0, 10);

    res.status(200).json({
      success: true,
      counts,
      workers: workers.map(w => ({
        id: w.id,
        status: w.status,
        timestamp: w.timestamp
      })),
      recentJobs: {
        waiting: waitingJobs.map(j => ({ id: j.id, data: { reviewId: j.data.reviewId } })),
        completed: recentCompleted.map(j => ({ id: j.id, finishedOn: j.finishedOn })),
        failed: recentFailed.map(j => ({ id: j.id, failedReason: j.failedReason }))
      }
    });
  } catch (error) {
    logger.error('Failed to get queue metrics', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to get queue metrics'
    });
  }
};

module.exports = {
  getHealth,
  getQueueMetrics
};
