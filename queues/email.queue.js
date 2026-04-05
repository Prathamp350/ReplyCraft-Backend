/**
 * Email Queue
 * Handles asynchronous email sending via BullMQ
 */

const { Queue } = require('bullmq');
const IORedis = require('ioredis');
const config = require('../config/config');
const logger = require('../utils/logger');

const createRedisConnection = require('../config/redis');

// Get the cleaned, standardized Redis connection
const connection = createRedisConnection();

connection.on('error', (err) => {
  logger.error('Redis connection error in email queue', { error: err.message });
});

// Create the email queue
const emailQueue = new Queue('email', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000 // 5 seconds initial delay
    },
    removeOnComplete: true,
    removeOnFail: 100, // Keep last 100 failed jobs for debugging
    timeout: 30000 // 30 second timeout
  }
});

/**
 * Add an email job to the queue
 */
async function queueEmail(type, data) {
    const metrics = {
      waiting: await emailQueue.getWaitingCount(),
      active: await emailQueue.getActiveCount(),
      failed: await emailQueue.getFailedCount(),
      delayed: await emailQueue.getDelayedCount()
    };
    
    logger.info('Email queue metrics', metrics);
  const job = await emailQueue.add(type, {
    ...data,
    queuedAt: new Date().toISOString()
  }, {
    priority: getPriorityForType(type)
  });

  logger.info('Email queued', { type, jobId: job.id, to: data.to });
  
  return job;
}

/**
 * Get priority based on email type
 */
function getPriorityForType(type) {
  const priorities = {
    welcome: 2,
    limitReached: 3,
    integrationConnected: 2,
    planUpgrade: 1,
    subscriptionActivated: 1,
    subscriptionCanceled: 1,
    subscriptionReminder: 1,
    passwordReset: 1,
    test: 1,
    otp: 1
  };
  return priorities[type] || 2;
}

/**
 * Queue welcome email
 */
async function queueWelcomeEmail(user) {
  return queueEmail('welcome', {
    type: 'welcome',
    to: user.email,
    name: user.name,
    plan: user.plan || 'Free',
    dailyLimit: user.dailyUsage?.limit || 5
  });
}

/**
 * Queue limit reached email
 */
async function queueLimitReachedEmail(user) {
  return queueEmail('limitReached', {
    type: 'limitReached',
    to: user.email,
    name: user.name,
    used: user.dailyUsage?.used || 0,
    limit: user.dailyUsage?.limit || 5,
    remaining: user.dailyUsage?.remaining || 0
  });
}

/**
 * Queue integration connected email
 */
async function queueIntegrationConnectedEmail(user, platform) {
  return queueEmail('integrationConnected', {
    type: 'integrationConnected',
    to: user.email,
    name: user.name,
    platform: platform === 'google' ? 'Google Business Profile' : platform
  });
}

/**
 * Queue test email
 */
async function queueTestEmail(user) {
  return queueEmail('test', {
    type: 'test',
    to: user.email,
    name: user.name
  });
}

/**
 * Queue OTP email
 */
async function queueOtpEmail(email, name, otp, reqDetails = {}, reason = 'login') {
  let deviceData = {
    browser: 'Unknown',
    os: 'Unknown',
    city: 'Unknown',
    region: 'Unknown',
    loginDate: new Date().toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' })
  };

  if (reqDetails.userAgent) {
    try {
      const UAParser = require('ua-parser-js');
      const parser = new UAParser(reqDetails.userAgent);
      const result = parser.getResult();
      if (result.browser.name) deviceData.browser = `${result.browser.name} ${result.browser.version || ''}`;
      if (result.os.name) deviceData.os = `${result.os.name} ${result.os.version || ''}`;
    } catch (e) {
      logger.warn('Failed to parse user agent for email', { error: e.message });
    }
  }

  if (reqDetails.ip) {
    try {
      const axios = require('axios');
      // Handle local loopback for testing
      const ip = (reqDetails.ip === '::1' || reqDetails.ip === '127.0.0.1') ? '' : reqDetails.ip;
      if (ip) {
        const response = await axios.get(`http://ip-api.com/json/${ip}?fields=status,city,regionName`);
        if (response.data && response.data.status === 'success') {
          deviceData.city = response.data.city || 'Unknown';
          deviceData.region = response.data.regionName || 'Unknown';
        }
      } else {
        deviceData.city = 'Localhost';
        deviceData.region = 'Localhost';
      }
    } catch (e) {
      logger.warn('Failed to fetch GeoIP for email', { error: e.message });
    }
  }

  return queueEmail('otp', {
    type: 'otp',
    to: email,
    name: name || 'User',
    otp: otp,
    reason: reason,
    ...deviceData
  });
}

async function queuePlanUpgradeEmail(data) {
  return queueEmail('planUpgrade', {
    type: 'planUpgrade',
    ...data,
  });
}

async function queueSubscriptionActivatedEmail(data) {
  return queueEmail('subscriptionActivated', {
    type: 'subscriptionActivated',
    ...data,
  });
}

async function queueSubscriptionCanceledEmail(data) {
  return queueEmail('subscriptionCanceled', {
    type: 'subscriptionCanceled',
    ...data,
  });
}

async function queueSubscriptionReminderEmail(data) {
  return queueEmail('subscriptionReminder', {
    type: 'subscriptionReminder',
    ...data,
  });
}

/**
 * Get email queue stats
 */
async function getEmailQueueStats() {
  const counts = await emailQueue.getJobCounts('waiting', 'active', 'completed', 'failed');
  return counts;
}

module.exports = {
  emailQueue,
  queueEmail,
  queueWelcomeEmail,
  queueLimitReachedEmail,
  queueIntegrationConnectedEmail,
  queueTestEmail,
  queueOtpEmail,
  queuePlanUpgradeEmail,
  queueSubscriptionActivatedEmail,
  queueSubscriptionCanceledEmail,
  queueSubscriptionReminderEmail,
  getEmailQueueStats
};
