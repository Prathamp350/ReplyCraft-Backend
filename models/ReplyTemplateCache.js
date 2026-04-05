const mongoose = require('mongoose');

const replyTemplateCacheSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    aiConfigurationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AIConfiguration',
      default: null,
      index: true
    },
    platform: {
      type: String,
      enum: ['google', 'yelp', 'tripadvisor', 'appstore', 'playstore', 'generic'],
      default: 'generic',
      index: true
    },
    rating: {
      type: Number,
      min: 1,
      max: 5,
      index: true
    },
    normalizedReviewText: {
      type: String,
      required: true
    },
    reviewHash: {
      type: String,
      required: true,
      index: true
    },
    bloomSignature: {
      type: [Number],
      default: []
    },
    replyText: {
      type: String,
      required: true
    },
    sourceReviewId: {
      type: String,
      default: null
    },
    sourceConnectionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BusinessConnection',
      default: null
    },
    postCount: {
      type: Number,
      default: 0
    },
    wasPosted: {
      type: Boolean,
      default: false
    },
    lastUsedAt: {
      type: Date,
      default: Date.now
    }
  },
  {
    timestamps: true
  }
);

replyTemplateCacheSchema.index(
  { userId: 1, aiConfigurationId: 1, platform: 1, rating: 1, reviewHash: 1 },
  { unique: true }
);

module.exports = mongoose.model('ReplyTemplateCache', replyTemplateCacheSchema);
