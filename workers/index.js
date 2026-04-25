const mongoose = require('mongoose');

const config = require('../config/config');
const logger = require('../utils/logger');
const { loadConfig } = require('../services/configManager');
const { validateEnvironment } = require('../config/validateEnv');

const workerModules = [
  './reviewFetcher',
  './aiWorker',
  './emailWorker',
  './googleReviewFetcher',
  './insightWorker',
];

const startWorkers = async () => {
  try {
    const envCheck = validateEnvironment({ role: 'workers' });
    envCheck.warnings.forEach((warning) => logger.warn('[EnvValidation]', { warning }));

    await mongoose.connect(config.mongodb.uri);
    logger.info('[Workers] Connected to MongoDB');

    await loadConfig();

    workerModules.forEach((modulePath) => require(modulePath));

    logger.info('[Workers] Worker runtime started', {
      workers: workerModules.length,
    });
  } catch (error) {
    logger.error('[Workers] Failed to start worker runtime', {
      error: error.message,
      stack: error.stack,
      validationErrors: error.validationErrors,
    });
    process.exit(1);
  }
};

startWorkers();
