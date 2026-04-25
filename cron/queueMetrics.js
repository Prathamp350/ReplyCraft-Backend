/**
 * Queue Metrics Monitoring
 * Logs queue statistics every 5 minutes
 */

const cron = require('node-cron');
const { replyQueue } = require('../queues/reply.queue');
const logger = require('../utils/logger');
const { withCronLock } = require('../utils/cronLock');

/**
 * Get and log queue metrics
 */
async function logQueueMetrics() {
  return withCronLock('queue-metrics', async () => {
  try {
    // Get job counts
    const counts = await replyQueue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
    
    // Get worker info
    const workers = await replyQueue.getWorkers();
    
    // Log metrics
    logger.info('[QueueMetrics]', {
      pending: counts.waiting || 0,
      active: counts.active || 0,
      completed: counts.completed || 0,
      failed: counts.failed || 0,
      delayed: counts.delayed || 0,
      workerCount: workers.length
    });

    // Log worker status
    if (workers.length > 0) {
      workers.forEach(worker => {
        logger.info('[QueueWorker]', {
          workerId: worker.id,
          status: worker.status
        });
      });
    }

    // Warn if there are many failed jobs
    if (counts.failed > 10) {
      logger.warn('High number of failed jobs in queue', { failedCount: counts.failed });
    }

    // Warn if queue is backing up
    if (counts.waiting > 100) {
      logger.warn('Queue is backing up', { waitingCount: counts.waiting });
    }

    return counts;
  } catch (error) {
    logger.error('Failed to log queue metrics', { error: error.message });
    return null;
  }
  }, { ttlMs: 4 * 60 * 1000 });
}

// Run every 5 minutes
cron.schedule('*/5 * * * *', logQueueMetrics);

// Also run on startup (after a short delay to ensure everything is initialized)
setTimeout(logQueueMetrics, 15000);

module.exports = {
  logQueueMetrics
};
