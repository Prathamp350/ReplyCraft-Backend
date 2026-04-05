const mongoose = require('mongoose');

const trackingEventSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true
    },
    sessionId: {
      type: String,
      default: null,
      index: true
    },
    eventType: {
      type: String,
      required: true,
      index: true
    },
    pagePath: {
      type: String,
      default: '/'
    },
    referrer: {
      type: String,
      default: ''
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    consent: {
      analytics: { type: Boolean, default: false },
      essential: { type: Boolean, default: true }
    },
    ipAddress: {
      type: String,
      default: null
    },
    userAgent: {
      type: String,
      default: ''
    }
  },
  {
    timestamps: true
  }
);

trackingEventSchema.index({ userId: 1, createdAt: -1 });
trackingEventSchema.index({ sessionId: 1, createdAt: -1 });
trackingEventSchema.index({ eventType: 1, createdAt: -1 });

module.exports = mongoose.model('TrackingEvent', trackingEventSchema);
