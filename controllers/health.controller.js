/**
 * Health Check Controller
 * Provides system health status for monitoring
 */

const mongoose = require('mongoose');
const config = require('../config/config');
const { replyQueue } = require('../queues/reply.queue');
const logger = require('../utils/logger');
const createRedisConnection = require('../config/redis');
const { getRuntimeMetricsSnapshot } = require('../utils/runtimeMetrics');

const runtimeRole = process.env.RUNTIME_ROLE || 'api';
const HEALTH_CHECK_TIMEOUT_MS = 1500;

const withTimeout = async (promise, label, timeoutMs = HEALTH_CHECK_TIMEOUT_MS) => {
  let timeoutHandle;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error(`${label} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
};

const getMongoHealth = () => {
  try {
    return mongoose.connection.readyState === 1 ? 'ok' : 'error';
  } catch (error) {
    return 'error';
  }
};

const getRedisHealth = async () => {
  let redisClient;
  try {
    redisClient = createRedisConnection();
    await withTimeout(redisClient.connect(), 'Redis connect');
    await withTimeout(redisClient.ping(), 'Redis ping');
    return 'ok';
  } catch (error) {
    return 'error';
  } finally {
    if (redisClient) {
      try {
        await withTimeout(redisClient.quit(), 'Redis quit', 500);
      } catch (cleanupError) {
        redisClient.disconnect();
      }
    }
  }
};

const getQueueHealth = async () => {
  try {
    const counts = await withTimeout(
      replyQueue.getJobCounts('waiting', 'active', 'completed', 'failed'),
      'Queue job counts'
    );
    const workers = await withTimeout(replyQueue.getWorkers(), 'Queue worker list');
    const activeWorkers = workers.filter((worker) => worker.status === 'active' || worker.status === 'ready').length;
    const queue = (counts.waiting || 0) > 0 && activeWorkers === 0 ? 'degraded' : 'ok';

    return {
      queue,
      queueStats: counts,
      queueWorkers: activeWorkers,
    };
  } catch (error) {
    return {
      queue: 'error',
    };
  }
};

const getLiveness = async (req, res) => {
  res.status(200).json({
    success: true,
    status: 'alive',
    role: runtimeRole,
    uptime: Math.round(process.uptime()),
    timestamp: Date.now(),
  });
};

const getReadiness = async (req, res) => {
  const database = getMongoHealth();
  const redis = await getRedisHealth();
  const queueHealth = await getQueueHealth();

  const readiness = {
    role: runtimeRole,
    database,
    redis,
    queue: queueHealth.queue,
    queueWorkers: queueHealth.queueWorkers ?? 0,
    timestamp: Date.now(),
  };

  const isReady = database === 'ok' && redis === 'ok' && queueHealth.queue !== 'error';

  res.status(isReady ? 200 : 503).json({
    success: isReady,
    ...readiness,
  });
};

/**
 * Get comprehensive system health
 */
const getHealth = async (req, res) => {
  const health = {
    server: 'ok',
    role: runtimeRole,
    database: 'unknown',
    redis: 'unknown',
    queue: 'unknown',
    runtime: getRuntimeMetricsSnapshot(),
    timestamp: Date.now()
  };

  // Check MongoDB
  health.database = getMongoHealth();

  // Check Redis
  health.redis = await getRedisHealth();

  // Check Queue
  Object.assign(health, await getQueueHealth());

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

const getRuntimeMetrics = async (req, res) => {
  try {
    const queueHealth = await getQueueHealth();

    res.status(200).json({
      success: true,
      role: runtimeRole,
      runtime: getRuntimeMetricsSnapshot(),
      queue: {
        status: queueHealth.queue,
        workers: queueHealth.queueWorkers ?? 0,
        stats: queueHealth.queueStats || {},
      },
      timestamp: Date.now(),
    });
  } catch (error) {
    logger.error('Failed to get runtime metrics', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to get runtime metrics'
    });
  }
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
  getLiveness,
  getReadiness,
  getHealth,
  getQueueMetrics,
  getRuntimeMetrics
};
