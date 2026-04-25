/**
 * Health Check Controller
 * Provides system health status for monitoring
 */

const mongoose = require('mongoose');
const config = require('../config/config');
const { replyQueue } = require('../queues/reply.queue');
const { emailQueue } = require('../queues/email.queue');
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
    redisClient.on('error', () => {});
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

const getQueueSnapshot = async (label, queue) => {
  try {
    const counts = await withTimeout(
      queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed'),
      `${label} queue counts`
    );
    const workers = await withTimeout(queue.getWorkers(), `${label} worker list`);
    const activeWorkers = workers.filter((worker) => worker.status === 'active' || worker.status === 'ready').length;
    const waiting = counts.waiting || 0;
    const failed = counts.failed || 0;
    const status = waiting > 0 && activeWorkers === 0 ? 'degraded' : failed > 25 ? 'degraded' : 'ok';

    return {
      name: label,
      status,
      workers: activeWorkers,
      visibleWorkers: activeWorkers,
      workerVisibility: activeWorkers > 0 ? 'visible' : 'not_visible_from_queue_probe',
      counts,
    };
  } catch (error) {
    return {
      name: label,
      status: 'error',
      workers: 0,
      visibleWorkers: 0,
      workerVisibility: 'unknown',
      counts: {},
      error: error.message,
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

const getAdminSystemHealth = async (req, res) => {
  try {
    const [redis, replyQueueHealth, emailQueueHealth] = await Promise.all([
      getRedisHealth(),
      getQueueSnapshot('reply-generation', replyQueue),
      getQueueSnapshot('email', emailQueue),
    ]);

    const database = getMongoHealth();
    const runtime = getRuntimeMetricsSnapshot();
    const services = [
      {
        name: 'API process',
        status: 'ok',
        detail: `Role ${runtimeRole}, uptime ${Math.round(process.uptime())}s`,
      },
      {
        name: 'MongoDB',
        status: database,
        detail: database === 'ok' ? 'Connected' : 'Mongoose is not connected',
      },
      {
        name: 'Redis',
        status: redis,
        detail: redis === 'ok' ? 'Ping successful' : 'Redis ping failed',
      },
      {
        name: 'Email worker',
        status: emailQueueHealth.status,
        detail: `${emailQueueHealth.visibleWorkers ?? 0} visible BullMQ worker(s), ${emailQueueHealth.counts.waiting || 0} waiting`,
      },
      {
        name: 'AI reply worker',
        status: replyQueueHealth.status,
        detail: `${replyQueueHealth.visibleWorkers ?? 0} visible BullMQ worker(s), ${replyQueueHealth.counts.waiting || 0} waiting`,
      },
    ];

    const worstStatus = services.some((service) => service.status === 'error')
      ? 'error'
      : services.some((service) => service.status === 'degraded')
        ? 'degraded'
        : 'ok';

    const recommendations = [];
    if (redis !== 'ok') {
      recommendations.push('Redis is not reachable. Check redis-server/ElastiCache and REDIS_HOST/REDIS_PORT.');
    }
    if (emailQueueHealth.status !== 'ok') {
      recommendations.push('Email queue is degraded. Ensure replycraft-workers is running and connected to Redis.');
    }
    if (replyQueueHealth.status !== 'ok') {
      recommendations.push('Reply queue is degraded. Ensure worker processes are running before scaling traffic.');
    }
    if (database !== 'ok') {
      recommendations.push('MongoDB is disconnected. Check MONGODB_URI, Atlas network access, and DNS.');
    }

    res.status(200).json({
      success: true,
      status: worstStatus,
      role: runtimeRole,
      generatedAt: new Date().toISOString(),
      services,
      queues: {
        email: emailQueueHealth,
        replyGeneration: replyQueueHealth,
      },
      runtime,
      environment: {
        nodeEnv: process.env.NODE_ENV || 'development',
        port: config.port,
        redisHost: process.env.REDIS_HOST || null,
        redisPort: process.env.REDIS_PORT || null,
      },
      security: {
        adminRoutesProtected: true,
        auth: 'JWT bearer token with server-side RBAC',
        allowedRoles: ['superadmin', 'admin'],
        note: 'Do not put HMAC/API-signing secrets in browser code. Use step-up auth for high-risk actions.',
      },
      recommendations,
    });
  } catch (error) {
    logger.error('Failed to get admin system health', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to get system health',
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
  getRuntimeMetrics,
  getAdminSystemHealth
};
