const mongoose = require('mongoose');

const insightSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  // Top issues/negative themes from reviews
  topComplaints: [{
    keyword: { type: String },
    count: { type: Number },
    examples: [{ type: String }]
  }],
  // Top positive themes from reviews
  topPraises: [{
    keyword: { type: String },
    count: { type: Number },
    examples: [{ type: String }]
  }],
  // Frequently occurring keywords
  commonKeywords: [{
    keyword: { type: String },
    count: { type: Number }
  }],
  // Summary statistics
  reviewCount: {
    type: Number,
    default: 0
  },
  averageRating: {
    type: Number,
    default: 0
  },
  positivePercentage: {
    type: Number,
    default: 0
  },
  negativePercentage: {
    type: Number,
    default: 0
  },
  neutralPercentage: {
    type: Number,
    default: 0
  },
  // Platform breakdown
  platformBreakdown: {
    google: { type: Number, default: 0 },
    yelp: { type: Number, default: 0 },
    tripadvisor: { type: Number, default: 0 },
    appstore: { type: Number, default: 0 },
    playstore: { type: Number, default: 0 }
  },
  // Time period
  periodStart: {
    type: Date,
    required: true
  },
  periodEnd: {
    type: Date,
    required: true
  },
  // AI-generated summary
  summary: {
    type: String,
    default: null
  },
  generatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Index for querying user's insights
insightSchema.index({ userId: 1, generatedAt: -1 });

module.exports = mongoose.model('Insight', insightSchema);
