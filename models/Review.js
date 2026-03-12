const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
  reviewId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  // External review ID from the platform (for idempotency)
  externalReviewId: {
    type: String,
    index: true
  },
  // Platform-specific review ID (e.g., Google review name, Yelp review ID)
  platformReviewId: {
    type: String,
    index: true
  },
  // Platform-specific location ID (e.g., Google location ID, Yelp business ID)
  platformLocationId: {
    type: String
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  connectionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BusinessConnection'
  },
  platform: {
    type: String,
    enum: ['google', 'yelp', 'tripadvisor', 'appstore', 'playstore'],
    default: 'google'
  },
  entityType: {
    type: String,
    enum: ['location', 'business', 'app'],
    default: 'location'
  },
  reviewText: {
    type: String,
    required: true
  },
  rating: {
    type: Number,
    min: 1,
    max: 5
  },
  // Sentiment analysis result
  sentiment: {
    type: String,
    enum: ['positive', 'neutral', 'negative', 'unknown'],
    default: 'unknown'
  },
  author: {
    type: String
  },
  authorPhotoUrl: {
    type: String
  },
  // AI-generated reply text
  aiReply: {
    type: String,
    default: null
  },
  // Reply status for the inbox
  replyStatus: {
    type: String,
    enum: ['pending', 'approved', 'posted', 'rejected', 'failed'],
    default: 'pending'
  },
  // Original reply text (if edited by user)
  replyText: {
    type: String,
    default: null
  },
  replyPostedAt: {
    type: Date,
    default: null
  },
  fetchedAt: {
    type: Date,
    default: Date.now
  },
  // Legacy status field (kept for backward compatibility)
  status: {
    type: String,
    enum: ['pending', 'pending_approval', 'processed', 'ignored', 'rejected', 'failed'],
    default: 'pending'
  }
}, {
  timestamps: true
});

// Compound indexes for efficient queries
reviewSchema.index({ userId: 1, replyStatus: 1 });
reviewSchema.index({ userId: 1, platform: 1 });
reviewSchema.index({ userId: 1, createdAt: -1 });
reviewSchema.index({ connectionId: 1, createdAt: -1 });
reviewSchema.index({ reviewId: 1, platform: 1 }, { unique: true });

// IDEMPOTENCY: Compound unique index on platform + platformReviewId
reviewSchema.index({ platform: 1, platformReviewId: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('Review', reviewSchema);
