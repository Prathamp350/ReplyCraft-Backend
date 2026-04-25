const mongoose = require('mongoose');

const config = require('../config/config');
const logger = require('../utils/logger');
const { loadConfig } = require('../services/configManager');
const { validateEnvironment } = require('../config/validateEnv');

const cronModules = [
  './resetUsage',
  './queueMetrics',
  './subscriptionNotifications',
];

const startCronRuntime = async () => {
  try {
    const envCheck = validateEnvironment({ role: 'cron' });
    envCheck.warnings.forEach((warning) => logger.warn('[EnvValidation]', { warning }));

    await mongoose.connect(config.mongodb.uri);
    logger.info('[Cron] Connected to MongoDB');

    await loadConfig();

    cronModules.forEach((modulePath) => require(modulePath));

    logger.info('[Cron] Scheduled jobs registered', {
      jobs: cronModules.length,
    });
  } catch (error) {
    logger.error('[Cron] Failed to start cron runtime', {
      error: error.message,
      stack: error.stack,
      validationErrors: error.validationErrors,
    });
    process.exit(1);
  }
};

startCronRuntime();
