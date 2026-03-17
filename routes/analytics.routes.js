const express = require('express');
const router = express.Router();
const { authenticate, authorizeRoles } = require('../middleware/auth.middleware');
const { requirePremium } = require('../middleware/premium.middleware');
const analyticsController = require('../controllers/analytics.controller');

// Apply auth middleware to all routes
router.use(authenticate);

// GET /api/analytics/overview - Get analytics overview
router.get('/overview', analyticsController.getOverview);

// GET /api/analytics/global - Get global platform analytics (Staff only)
router.get('/global', authorizeRoles('superadmin', 'admin', 'finance'), analyticsController.getGlobalAnalytics);

// GET /api/analytics/reviews - Get reviews with filters
router.get('/reviews', analyticsController.getReviews);

// GET /api/analytics/sentiment - Get sentiment analysis
router.get('/sentiment', analyticsController.getSentiment);

// GET /api/analytics/performance - Get reply performance metrics (Premium only)
router.get('/performance', requirePremium, analyticsController.getReplyPerformance);

module.exports = router;
