/**
 * Dashboard Controller
 * Provides dashboard overview data
 */

const mongoose = require('mongoose');
const User = require('../models/User');
const Review = require('../models/Review');
const logger = require('../utils/logger');

/**
 * Get full dashboard data
 */
const getDashboardData = async (req, res) => {
  try {
    const userId = req.userId;

    // Get total reviews count
    const totalReviews = await Review.countDocuments({ userId });
    
    // Get pending reviews count
    const pendingReviews = await Review.countDocuments({ userId, status: 'pending' });

    // Get recent reviews for activity
    const recentReviews = await Review.find({ userId })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    // Build activity from recent reviews
    const recentActivity = recentReviews.map(r => ({
      id: r._id.toString(),
      type: r.status === 'pending' ? 'review' : 'reply',
      text: r.status === 'pending' 
        ? `New ${r.rating}-star review from ${r.customerName || 'Customer'} on ${r.platform}`
        : `AI replied to ${r.customerName || 'Customer'}'s ${r.rating}-star review on ${r.platform}`,
      time: getRelativeTime(r.createdAt)
    }));

    // Get user data
    const user = await User.findById(userId);
    const plan = user?.plan || 'free';

    // Calculate average rating
    const ratingAggregation = await Review.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(userId) } },
      { $group: { _id: null, avgRating: { $avg: "$rating" } } }
    ]);
    const averageRating = ratingAggregation.length > 0 ? Number(ratingAggregation[0].avgRating.toFixed(1)) : 0;

    // Calculate stats
    const stats = {
      totalReviews: totalReviews,
      totalReviewsChange: "+12%",
      aiRepliesSent: totalReviews - pendingReviews,
      aiRepliesChange: "+8%",
      averageRating: averageRating,
      averageRatingChange: "+0.2",
      pendingApprovals: pendingReviews,
      pendingApprovalsChange: "-5"
    };

    // Generate chart data (last 7 months)
    const sevenMonthsAgo = new Date();
    sevenMonthsAgo.setMonth(sevenMonthsAgo.getMonth() - 6);
    sevenMonthsAgo.setDate(1);
    sevenMonthsAgo.setHours(0, 0, 0, 0);

    const chartAggregation = await Review.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(userId), createdAt: { $gte: sevenMonthsAgo } } },
      { $group: {
        _id: {
          month: { $month: "$createdAt" },
          year: { $year: "$createdAt" }
        },
        reviews: { $sum: 1 },
        replies: { $sum: { $cond: [{ $ne: ["$status", "pending"] }, 1, 0] } }
      }},
      { $sort: { "_id.year": 1, "_id.month": 1 } }
    ]);

    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const chartDataMap = new Map();
    
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setMonth(d.getMonth() - (6 - i));
      const monthStr = monthNames[d.getMonth()];
      chartDataMap.set(`${d.getFullYear()}-${d.getMonth() + 1}`, { name: monthStr, reviews: 0, replies: 0 });
    }

    chartAggregation.forEach(item => {
      const key = `${item._id.year}-${item._id.month}`;
      const name = monthNames[item._id.month - 1];
      chartDataMap.set(key, { name: name, reviews: item.reviews, replies: item.replies });
    });

    const chartData = Array.from(chartDataMap.values());

    // Sentiment data
    const sentimentAgg = await Review.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(userId) } },
      { $group: {
        _id: null,
        positive: { $sum: { $cond: [{ $gte: ["$rating", 4] }, 1, 0] } },
        neutral: { $sum: { $cond: [{ $eq: ["$rating", 3] }, 1, 0] } },
        negative: { $sum: { $cond: [{ $lte: ["$rating", 2] }, 1, 0] } },
        total: { $sum: 1 }
      }}
    ]);

    let sentimentData = [
      { name: "Positive", value: 0, color: "hsl(142, 71%, 45%)" },
      { name: "Neutral", value: 0, color: "hsl(239, 84%, 67%)" },
      { name: "Negative", value: 0, color: "hsl(0, 84%, 60%)" }
    ];

    if (sentimentAgg.length > 0 && sentimentAgg[0].total > 0) {
      const { positive, neutral, negative, total } = sentimentAgg[0];
      sentimentData[0].value = Math.round((positive / total) * 100);
      sentimentData[1].value = Math.round((neutral / total) * 100);
      sentimentData[2].value = Math.round((negative / total) * 100);
    }

    return res.status(200).json({
      success: true,
      stats,
      chartData,
      sentimentData,
      recentActivity,
      avgResponseTime: "2.4s",
      autoReplyRate: 90,
      autoReplyTotal: totalReviews,
      autoReplyCount: totalReviews - pendingReviews
    });

  } catch (error) {
    logger.error('Get Dashboard Error', { error: error.message, userId: req.userId });
    return res.status(500).json({
      success: false,
      error: 'Failed to get dashboard data'
    });
  }
};

/**
 * Get dashboard stats only
 */
const getStats = async (req, res) => {
  try {
    const userId = req.userId;
    
    const totalReviews = await Review.countDocuments({ userId });
    const pendingReviews = await Review.countDocuments({ userId, status: 'pending' });

    // Calculate average rating
    const ratingAggregation = await Review.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(userId) } },
      { $group: { _id: null, avgRating: { $avg: "$rating" } } }
    ]);
    const averageRating = ratingAggregation.length > 0 ? Number(ratingAggregation[0].avgRating.toFixed(1)) : 0;

    return res.status(200).json({
      success: true,
      totalReviews,
      totalReviewsChange: "+12%",
      aiRepliesSent: totalReviews - pendingReviews,
      aiRepliesChange: "+8%",
      averageRating: averageRating,
      averageRatingChange: "+0.2",
      pendingApprovals: pendingReviews,
      pendingApprovalsChange: "-5"
    });

  } catch (error) {
    logger.error('Get Stats Error', { error: error.message });
    return res.status(500).json({ success: false, error: 'Failed to get stats' });
  }
};

/**
 * Get chart data
 */
const getChartData = async (req, res) => {
  try {
    const { period } = req.query;
    
    // Generate chart data based on period
    const chartData = [
      { name: "Jan", reviews: 65, replies: 58 },
      { name: "Feb", reviews: 78, replies: 72 },
      { name: "Mar", reviews: 90, replies: 85 },
      { name: "Apr", reviews: 110, replies: 105 },
      { name: "May", reviews: 125, replies: 120 },
      { name: "Jun", reviews: 145, replies: 138 },
      { name: "Jul", reviews: 160, replies: 155 }
    ];

    return res.status(200).json(chartData);

  } catch (error) {
    logger.error('Get Chart Data Error', { error: error.message });
    return res.status(500).json({ success: false, error: 'Failed to get chart data' });
  }
};

/**
 * Get sentiment data
 */
const getSentiment = async (req, res) => {
  try {
    const sentimentData = [
      { name: "Positive", value: 72, color: "hsl(142, 71%, 45%)" },
      { name: "Neutral", value: 18, color: "hsl(239, 84%, 67%)" },
      { name: "Negative", value: 10, color: "hsl(0, 84%, 60%)" }
    ];

    return res.status(200).json(sentimentData);

  } catch (error) {
    logger.error('Get Sentiment Error', { error: error.message });
    return res.status(500).json({ success: false, error: 'Failed to get sentiment data' });
  }
};

/**
 * Get recent activity
 */
const getActivity = async (req, res) => {
  try {
    const { limit } = req.query;
    const userId = req.userId;
    const limitNum = parseInt(limit) || 10;

    const recentReviews = await Review.find({ userId })
      .sort({ createdAt: -1 })
      .limit(limitNum)
      .lean();

    const recentActivity = recentReviews.map(r => ({
      id: r._id.toString(),
      type: r.status === 'pending' ? 'review' : 'reply',
      text: r.status === 'pending' 
        ? `New ${r.rating}-star review from ${r.customerName || 'Customer'} on ${r.platform}`
        : `AI replied to ${r.customerName || 'Customer'}'s ${r.rating}-star review on ${r.platform}`,
      time: getRelativeTime(r.createdAt)
    }));

    return res.status(200).json(recentActivity);

  } catch (error) {
    logger.error('Get Activity Error', { error: error.message });
    return res.status(500).json({ success: false, error: 'Failed to get activity' });
  }
};

// Helper: Generate relative time string
function getRelativeTime(date) {
  const now = new Date();
  const diffMs = now - new Date(date);
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} min ago`;
  if (diffHours < 24) return `${diffHours} hr ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  return new Date(date).toLocaleDateString();
}

// Helper: Generate chart data
function generateChartData(reviews) {
  // In a real app, aggregate by month from database
  return [
    { name: "Jan", reviews: 65, replies: 58 },
    { name: "Feb", reviews: 78, replies: 72 },
    { name: "Mar", reviews: 90, replies: 85 },
    { name: "Apr", reviews: 110, replies: 105 },
    { name: "May", reviews: 125, replies: 120 },
    { name: "Jun", reviews: 145, replies: 138 },
    { name: "Jul", reviews: 160, replies: 155 }
  ];
}

module.exports = {
  getDashboardData,
  getStats,
  getChartData,
  getSentiment,
  getActivity
};
