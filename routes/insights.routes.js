const express = require('express');
const router = express.Router();
const reviewInsightsService = require('../services/reviewInsights.service');
const { authenticate } = require('../middleware/auth.middleware');

/**
 * GET /api/insights
 * Get latest insights for authenticated user
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    
    const insights = await reviewInsightsService.getLatestInsights(userId);
    
    if (!insights) {
      return res.status(404).json({
        success: false,
        message: 'No insights found. Ensure you have connected reviews.'
      });
    }
    
    res.json({
      success: true,
      data: insights
    });
  } catch (error) {
    console.error('Error fetching insights:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch insights'
    });
  }
});

/**
 * GET /api/insights/history
 * Get insight history for authenticated user
 */
router.get('/history', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const limit = parseInt(req.query.limit) || 4;
    
    const insights = await reviewInsightsService.getInsightHistory(userId, limit);
    
    res.json({
      success: true,
      data: insights
    });
  } catch (error) {
    console.error('Error fetching insight history:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch insight history'
    });
  }
});

/**
 * POST /api/insights/generate
 * Manually trigger insight generation for authenticated user
 */
router.post('/generate', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    
    const insight = await reviewInsightsService.generateWeeklyInsights(userId);
    
    if (!insight) {
      return res.status(404).json({
        success: false,
        message: 'No reviews found to analyze'
      });
    }
    
    res.json({
      success: true,
      data: insight
    });
  } catch (error) {
    console.error('Error generating insights:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate insights'
    });
  }
});

module.exports = router;
