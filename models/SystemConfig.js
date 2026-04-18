const mongoose = require('mongoose');
const logger = require('../utils/logger');
// Default configuration to fall back on if database is empty
const defaultPlans = require('../config/config').plans;
const extStorage = require('../config/config').extraStorage;

const systemConfigSchema = new mongoose.Schema({
  // Unique singleton identifier
  configId: {
    type: String,
    default: 'global',
    unique: true
  },
  plans: {
    free: { type: Object },
    starter: { type: Object },
    pro: { type: Object },
    business: { type: Object }
  },
  extraStorage: {
    blockSizeMB: { type: Number, default: 100 },
    basePriceINR: { type: Number, default: 49 }
  },
  watermarkText: {
    type: String,
    default: '\n\n— Powered by ReplyCraft'
  },
  aiOps: {
    globalEnabled: { type: Boolean, default: false },
    marketingEnabled: { type: Boolean, default: true },
    supportEnabled: { type: Boolean, default: true },
    financeEnabled: { type: Boolean, default: true },
    emergencyStop: { type: Boolean, default: false },
    supportAutoEmail: { type: Boolean, default: false },
    marketingAutoSend: { type: Boolean, default: false },
    financeAutoSend: { type: Boolean, default: false },
    blockDestructiveActions: { type: Boolean, default: true },
    blockRoleChanges: { type: Boolean, default: true },
    blockPlanChanges: { type: Boolean, default: true },
    googleEnabled: { type: Boolean, default: true },
    bedrockEnabled: { type: Boolean, default: false },
    googleKeyOverrides: { type: Object, default: {} },
    flashModel: { type: String, default: process.env.GOOGLE_AI_FLASH_MODEL || 'gemini-2.5-flash' },
    proModel: { type: String, default: process.env.GOOGLE_AI_PRO_MODEL || process.env.GOOGLE_AI_MODEL || process.env.GOOGLE_AI_FLASH_MODEL || 'gemini-2.5-flash' },
    reviewModel: { type: String, default: process.env.GOOGLE_AI_REVIEW_MODEL || process.env.GOOGLE_AI_PRO_MODEL || process.env.GOOGLE_AI_MODEL || process.env.GOOGLE_AI_FLASH_MODEL || 'gemini-2.5-flash' },
    googleBackupModel: { type: String, default: process.env.GOOGLE_AI_BACKUP_MODEL || 'gemma-3-27b-it' },
    finalModel: { type: String, default: process.env.AI_FINAL_MODEL || process.env.BEDROCK_CLAUDE_MODEL || process.env.AWS_BEDROCK_MODEL || 'anthropic.claude-3-sonnet-20240229-v1:0' },
    bedrockModel: { type: String, default: process.env.BEDROCK_CLAUDE_MODEL || process.env.AWS_BEDROCK_MODEL || 'anthropic.claude-3-sonnet-20240229-v1:0' },
    bulkProvider: { type: String, default: process.env.AI_BULK_PROVIDER || 'google' },
    finalProvider: { type: String, default: process.env.AI_FINAL_PROVIDER || 'bedrock' },
    lastUpdatedAt: { type: Date, default: null }
  },
  staffUi: {
    sidebarPreset: {
      type: String,
      enum: ['midnight', 'ocean', 'emerald', 'royal'],
      default: 'midnight'
    },
    updatedAt: {
      type: Date,
      default: null
    }
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  }
}, {
  timestamps: true
});

// Middleware to ensure default plans are populated securely
systemConfigSchema.pre('save', function(next) {
  if (!this.plans || !this.plans.free) {
    this.plans = defaultPlans;
  }
  if (!this.extraStorage || !this.extraStorage.basePriceINR) {
    this.extraStorage = extStorage;
  }
  if (!this.aiOps) {
    this.aiOps = {
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
      proModel: process.env.GOOGLE_AI_PRO_MODEL || process.env.GOOGLE_AI_MODEL || process.env.GOOGLE_AI_FLASH_MODEL || 'gemini-2.5-flash',
      reviewModel: process.env.GOOGLE_AI_REVIEW_MODEL || process.env.GOOGLE_AI_PRO_MODEL || process.env.GOOGLE_AI_MODEL || process.env.GOOGLE_AI_FLASH_MODEL || 'gemini-2.5-flash',
      googleBackupModel: process.env.GOOGLE_AI_BACKUP_MODEL || 'gemma-3-27b-it',
      finalModel: process.env.AI_FINAL_MODEL || process.env.BEDROCK_CLAUDE_MODEL || process.env.AWS_BEDROCK_MODEL || 'anthropic.claude-3-sonnet-20240229-v1:0',
      bedrockModel: process.env.BEDROCK_CLAUDE_MODEL || process.env.AWS_BEDROCK_MODEL || 'anthropic.claude-3-sonnet-20240229-v1:0',
      bulkProvider: process.env.AI_BULK_PROVIDER || 'google',
      finalProvider: process.env.AI_FINAL_PROVIDER || 'bedrock',
      lastUpdatedAt: null
    };
  }
  if (!this.staffUi) {
    this.staffUi = {
      sidebarPreset: 'midnight',
      updatedAt: null,
    };
  }
  next();
});

module.exports = mongoose.model('SystemConfig', systemConfigSchema);
