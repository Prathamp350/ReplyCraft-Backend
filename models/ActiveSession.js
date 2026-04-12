const mongoose = require('mongoose');

const activeSessionSchema = new mongoose.Schema(
  {
    sessionId: {
      type: String,
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    userName: {
      type: String,
      default: null,
    },
    userEmail: {
      type: String,
      default: null,
    },
    plan: {
      type: String,
      default: 'free',
      index: true,
    },
    subscriptionStatus: {
      type: String,
      default: null,
      index: true,
    },
    businessName: {
      type: String,
      default: null,
    },
    pagePath: {
      type: String,
      default: '/',
    },
    referrer: {
      type: String,
      default: '',
    },
    eventType: {
      type: String,
      default: 'page_view',
      index: true,
    },
    ipAddress: {
      type: String,
      default: null,
    },
    userAgent: {
      type: String,
      default: '',
    },
    deviceType: {
      type: String,
      default: 'desktop',
    },
    browserLanguage: {
      type: String,
      default: null,
    },
    timezone: {
      type: String,
      default: null,
    },
    countryCode: {
      type: String,
      default: 'US',
      uppercase: true,
      index: true,
    },
    country: {
      type: String,
      default: 'United States',
      index: true,
    },
    state: {
      type: String,
      default: null,
      index: true,
    },
    city: {
      type: String,
      default: null,
    },
    screen: {
      width: { type: Number, default: null },
      height: { type: Number, default: null },
    },
    lastSeenAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  },
  {
    timestamps: true,
  }
);

activeSessionSchema.index({ sessionId: 1, userId: 1 }, { unique: true });
activeSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
activeSessionSchema.index({ countryCode: 1, lastSeenAt: -1 });

module.exports = mongoose.model('ActiveSession', activeSessionSchema);
