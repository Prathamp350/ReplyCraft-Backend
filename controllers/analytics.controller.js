const mongoose = require('mongoose');
const Review = require('../models/Review');

/**
 * Get analytics overview
 */
const getOverview = async (req, res) => {
  try {
    const userId = req.userId;

    // Aggregate analytics
    const analytics = await Review.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(userId) } },
      {
        $group: {
          _id: null,
          totalReviews: { $sum: 1 },
          processedReplies: {
            $sum: { $cond: [{ $eq: ['$status', 'processed'] }, 1, 0] }
          },
          pendingReplies: {
            $sum: { $cond: [{ $eq: ['$status', 'pending_approval'] }, 1, 0] }
          },
          ignoredReviews: {
            $sum: { $cond: [{ $eq: ['$status', 'ignored'] }, 1, 0] }
          },
          rejectedReviews: {
            $sum: { $cond: [{ $eq: ['$status', 'rejected'] }, 1, 0] }
          },
          failedReplies: {
            $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] }
          },
          averageRating: { $avg: '$rating' },
          positiveReviews: {
            $sum: { $cond: [{ $gte: ['$rating', 4] }, 1, 0] }
          },
          neutralReviews: {
            $sum: { $cond: [{ $eq: ['$rating', 3] }, 1, 0] }
          },
          negativeReviews: {
            $sum: { $cond: [{ $lte: ['$rating', 2] }, 1, 0] }
          },
          oneStar: { $sum: { $cond: [{ $eq: ['$rating', 1] }, 1, 0] } },
          twoStars: { $sum: { $cond: [{ $eq: ['$rating', 2] }, 1, 0] } },
          threeStars: { $sum: { $cond: [{ $eq: ['$rating', 3] }, 1, 0] } },
          fourStars: { $sum: { $cond: [{ $eq: ['$rating', 4] }, 1, 0] } },
          fiveStars: { $sum: { $cond: [{ $eq: ['$rating', 5] }, 1, 0] } }
        }
      }
    ]);

    const data = analytics[0] || {
      totalReviews: 0,
      processedReplies: 0,
      pendingReplies: 0,
      ignoredReviews: 0,
      rejectedReviews: 0,
      failedReplies: 0,
      averageRating: 0,
      positiveReviews: 0,
      neutralReviews: 0,
      negativeReviews: 0,
      oneStar: 0,
      twoStars: 0,
      threeStars: 0,
      fourStars: 0,
      fiveStars: 0
    };

    return res.status(200).json({
      success: true,
      overview: {
        totalReviews: data.totalReviews,
        processedReplies: data.processedReplies,
        pendingReplies: data.pendingReplies,
        ignoredReviews: data.ignoredReviews,
        rejectedReviews: data.rejectedReviews,
        failedReplies: data.failedReplies,
        averageRating: data.averageRating ? parseFloat(data.averageRating.toFixed(1)) : 0,
        positiveReviews: data.positiveReviews,
        neutralReviews: data.neutralReviews,
        negativeReviews: data.negativeReviews,
        ratingBreakdown: {
          fiveStars: data.fiveStars,
          fourStars: data.fourStars,
          threeStars: data.threeStars,
          twoStars: data.twoStars,
          oneStar: data.oneStar
        }
      }
    });

  } catch (error) {
    console.error('Get Overview Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to get analytics overview'
    });
  }
};

/**
 * Get reviews with pagination and filters
 */
const getReviews = async (req, res) => {
  try {
    const userId = req.userId;
    const { 
      status, 
      platform, 
      rating, 
      sentiment,
      limit = 50, 
      offset = 0,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    // Build query
    const query = { userId: userId };

    if (status) {
      query.status = status;
    }

    if (platform) {
      query.platform = platform;
    }

    if (rating) {
      query.rating = parseInt(rating);
    }

    // Sentiment filter based on rating
    if (sentiment) {
      if (sentiment === 'positive') {
        query.rating = { $gte: 4 };
      } else if (sentiment === 'neutral') {
        query.rating = 3;
      } else if (sentiment === 'negative') {
        query.rating = { $lte: 2 };
      }
    }

    // Sort options
    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'asc' ? 1 : -1;

    const reviews = await Review.find(query)
      .populate('connectionId', 'locationName platform')
      .sort(sortOptions)
      .skip(parseInt(offset))
      .limit(parseInt(limit));

    const total = await Review.countDocuments(query);

    return res.status(200).json({
      success: true,
      reviews,
      pagination: {
        total,
        limit: parseInt(limit),
        offset: parseInt(offset),
        pages: Math.ceil(total / parseInt(limit))
      }
    });

  } catch (error) {
    console.error('Get Reviews Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to get reviews'
    });
  }
};

/**
 * Get sentiment analysis
 */
const getSentiment = async (req, res) => {
  try {
    const userId = req.userId;
    const { period = 'all' } = req.query;

    // Build date filter based on period
    let dateFilter = {};
    const now = new Date();
    
    if (period === 'today') {
      const startOfDay = new Date(now.setHours(0, 0, 0, 0));
      dateFilter = { createdAt: { $gte: startOfDay } };
    } else if (period === 'week') {
      const weekAgo = new Date(now.setDate(now.getDate() - 7));
      dateFilter = { createdAt: { $gte: weekAgo } };
    } else if (period === 'month') {
      const monthAgo = new Date(now.setMonth(now.getMonth() - 1));
      dateFilter = { createdAt: { $gte: monthAgo } };
    }

    // Aggregate sentiment data
    const sentimentData = await Review.aggregate([
      { 
        $match: { 
          userId: new mongoose.Types.ObjectId(userId),
          ...dateFilter
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          positive: { $sum: { $cond: [{ $gte: ['$rating', 4] }, 1, 0] } },
          neutral: { $sum: { $cond: [{ $eq: ['$rating', 3] }, 1, 0] } },
          negative: { $sum: { $cond: [{ $lte: ['$rating', 2] }, 1, 0] } },
          noRating: { $sum: { $cond: [{ $eq: ['$rating', null] }, 1, 0] } }
        }
      }
    ]);

    const data = sentimentData[0] || {
      total: 0,
      positive: 0,
      neutral: 0,
      negative: 0,
      noRating: 0
    };

    // Calculate percentages
    const total = data.total || 1;
    const positivePercent = ((data.positive / total) * 100).toFixed(1);
    const neutralPercent = ((data.neutral / total) * 100).toFixed(1);
    const negativePercent = ((data.negative / total) * 100).toFixed(1);

    // Determine overall sentiment
    let overallSentiment = 'neutral';
    if (parseFloat(positivePercent) > 60) {
      overallSentiment = 'positive';
    } else if (parseFloat(negativePercent) > 40) {
      overallSentiment = 'negative';
    }

    return res.status(200).json({
      success: true,
      sentiment: {
        period,
        total: data.total,
        breakdown: {
          positive: data.positive,
          neutral: data.neutral,
          negative: data.negative
        },
        percentages: {
          positive: parseFloat(positivePercent),
          neutral: parseFloat(neutralPercent),
          negative: parseFloat(negativePercent)
        },
        overallSentiment
      }
    });

  } catch (error) {
    console.error('Get Sentiment Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to get sentiment analysis'
    });
  }
};

/**
 * Get reply performance metrics
 */
const getReplyPerformance = async (req, res) => {
  try {
    const userId = req.userId;
    const { period = 'month' } = req.query;

    // Build date filter
    let dateFilter = {};
    const now = new Date();
    
    if (period === 'week') {
      const weekAgo = new Date(now.setDate(now.getDate() - 7));
      dateFilter = { createdAt: { $gte: weekAgo } };
    } else if (period === 'month') {
      const monthAgo = new Date(now.setMonth(now.getMonth() - 1));
      dateFilter = { createdAt: { $gte: monthAgo } };
    } else if (period === 'year') {
      const yearAgo = new Date(now.setFullYear(now.getFullYear() - 1));
      dateFilter = { createdAt: { $gte: yearAgo } };
    }

    // Aggregate reply performance by day
    const performance = await Review.aggregate([
      {
        $match: {
          userId: new mongoose.Types.ObjectId(userId),
          ...dateFilter,
          status: { $in: ['processed', 'pending_approval', 'ignored'] }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
          },
          totalReviews: { $sum: 1 },
          processed: { $sum: { $cond: [{ $eq: ['$status', 'processed'] }, 1, 0] } },
          pending: { $sum: { $cond: [{ $eq: ['$status', 'pending_approval'] }, 1, 0] } },
          ignored: { $sum: { $cond: [{ $eq: ['$status', 'ignored'] }, 1, 0] } }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // Calculate totals
    const totals = performance.reduce((acc, day) => ({
      totalReviews: acc.totalReviews + day.totalReviews,
      processed: acc.processed + day.processed,
      pending: acc.pending + day.pending,
      ignored: acc.ignored + day.ignored
    }), { totalReviews: 0, processed: 0, pending: 0, ignored: 0 });

    return res.status(200).json({
      success: true,
      performance: {
        period,
        totals,
        daily: performance
      }
    });

  } catch (error) {
    console.error('Get Reply Performance Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to get reply performance'
    });
  }
};

module.exports = {
  getOverview,
  getReviews,
  getSentiment,
  getReplyPerformance
};
