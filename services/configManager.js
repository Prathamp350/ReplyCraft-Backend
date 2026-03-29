const SystemConfig = require('../models/SystemConfig');
const baseConfig = require('../config/config');
const logger = require('../utils/logger');

let cachedConfig = null;

/**
 * Initializes the configuration. 
 * Fetches from the DB. If no config exists, creates the default from config.js.
 */
async function loadConfig() {
  try {
    let configDoc = await SystemConfig.findOne({ configId: 'global' });
    
    if (!configDoc) {
      configDoc = new SystemConfig({
        configId: 'global',
        plans: baseConfig.plans,
        extraStorage: baseConfig.extraStorage,
        watermarkText: baseConfig.watermarkText
      });
      await configDoc.save();
      logger.info('SystemConfig created in DB from defaults.');
    }

    cachedConfig = {
      ...baseConfig, // Keep standard connection URIs/Tokens
      plans: configDoc.plans,
      extraStorage: configDoc.extraStorage,
      watermarkText: configDoc.watermarkText
    };

    logger.info('Dynamic configuration loaded into memory.');
    return cachedConfig;
  } catch (error) {
    logger.error('Failed to load dynamic config:', error);
    // Fallback to static config immediately if the DB connection fails
    cachedConfig = { ...baseConfig };
    return cachedConfig;
  }
}

/**
 * Get synchronously configured plans and pricing
 * This method is safe to call instantly because loadConfig() runs on server startup.
 */
function getConfig() {
  if (!cachedConfig) {
    return baseConfig; 
  }
  return cachedConfig;
}

/**
 * Triggers a memory update after an admin changes plans in the DB
 */
async function refreshConfig() {
  await loadConfig();
  return cachedConfig;
}

module.exports = {
  loadConfig,
  getConfig,
  refreshConfig
};
