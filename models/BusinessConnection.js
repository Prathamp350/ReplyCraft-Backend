const mongoose = require('mongoose');

const businessConnectionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  platform: {
    type: String,
    enum: ['google', 'yelp', 'tripadvisor', 'appstore', 'playstore'],
    required: true,
    default: 'google'
  },
  // Platform account identifier
  accountId: {
    type: String,
    required: true
  },
  // Location/Business/App identifier
  locationId: {
    type: String,
    required: true
  },
  locationName: {
    type: String
  },
  // OAuth tokens (for platforms that use OAuth)
  accessToken: {
    type: String
  },
  refreshToken: {
    type: String
  },
  tokenExpiry: {
    type: Date
  },
  // API keys (for platforms that use API key auth)
  apiKey: {
    type: String
  },
  apiSecret: {
    type: String
  },
  // Additional platform-specific configuration
  config: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  // Connection status
  status: {
    type: String,
    enum: ['active', 'inactive', 'expired', 'error'],
    default: 'active'
  },
  // Error message if connection failed
  errorMessage: {
    type: String,
    default: null
  },
  // Is connection enabled for fetching
  isActive: {
    type: Boolean,
    default: true
  },
  // Linked AI Persona to handle these replies
  aiConfigurationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AIConfiguration',
    default: null
  }
}, {
  timestamps: true
});

// Index for efficient queries
businessConnectionSchema.index({ userId: 1, platform: 1 });
businessConnectionSchema.index({ locationId: 1 });
businessConnectionSchema.index({ platform: 1, isActive: 1 });
businessConnectionSchema.index({ status: 1 });

module.exports = mongoose.model('BusinessConnection', businessConnectionSchema);
