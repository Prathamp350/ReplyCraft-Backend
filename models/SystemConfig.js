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
    lastUpdatedAt: { type: Date, default: null }
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
      lastUpdatedAt: null
    };
  }
  next();
});

module.exports = mongoose.model('SystemConfig', systemConfigSchema);
