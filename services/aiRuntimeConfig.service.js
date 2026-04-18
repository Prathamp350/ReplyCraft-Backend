const SystemConfig = require('../models/SystemConfig');

const defaultAiOpsConfig = {
  globalEnabled: false,
  marketingEnabled: true,
  supportEnabled: true,
  financeEnabled: true,
  emergencyStop: false,
  supportAutoEmail: false,
  marketingAutoSend: false,
  financeAutoSend: false,
  blockDestructiveActions: true,
  blockRoleChanges: true,
  blockPlanChanges: true,
  googleEnabled: true,
  bedrockEnabled: false,
  googleKeyOverrides: {},
  flashModel: process.env.GOOGLE_AI_FLASH_MODEL || 'gemini-2.5-flash',
  proModel:
    process.env.GOOGLE_AI_PRO_MODEL ||
    process.env.GOOGLE_AI_MODEL ||
    process.env.GOOGLE_AI_FLASH_MODEL ||
    'gemini-2.5-flash',
  reviewModel:
    process.env.GOOGLE_AI_REVIEW_MODEL ||
    process.env.GOOGLE_AI_PRO_MODEL ||
    process.env.GOOGLE_AI_MODEL ||
    process.env.GOOGLE_AI_FLASH_MODEL ||
    'gemini-2.5-flash',
  googleBackupModel: process.env.GOOGLE_AI_BACKUP_MODEL || 'gemma-3-27b-it',
  finalModel:
    process.env.AI_FINAL_MODEL ||
    process.env.BEDROCK_CLAUDE_MODEL ||
    process.env.AWS_BEDROCK_MODEL ||
    'anthropic.claude-3-sonnet-20240229-v1:0',
  bedrockModel:
    process.env.BEDROCK_CLAUDE_MODEL ||
    process.env.AWS_BEDROCK_MODEL ||
    'anthropic.claude-3-sonnet-20240229-v1:0',
  bulkProvider: process.env.AI_BULK_PROVIDER || 'google',
  finalProvider: process.env.AI_FINAL_PROVIDER || 'bedrock',
  lastUpdatedAt: null,
};

async function getSystemConfig() {
  let config = await SystemConfig.findOne({ configId: 'global' });
  if (!config) {
    config = await SystemConfig.create({ configId: 'global' });
  }
  return config;
}

async function getAiRuntimeConfig() {
  const config = await getSystemConfig();
  return {
    ...defaultAiOpsConfig,
    ...(config.aiOps || {}),
  };
}

async function updateAiRuntimeConfig(patch, userId = null) {
  const config = await getSystemConfig();
  config.aiOps = {
    ...defaultAiOpsConfig,
    ...(config.aiOps || {}),
    ...patch,
    lastUpdatedAt: new Date(),
  };

  if (userId) {
    config.updatedBy = userId;
  }

  await config.save();
  return config.aiOps;
}

module.exports = {
  defaultAiOpsConfig,
  getSystemConfig,
  getAiRuntimeConfig,
  updateAiRuntimeConfig,
};
