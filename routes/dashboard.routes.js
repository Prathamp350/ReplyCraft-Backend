/**
 * Dashboard Routes
 * Dashboard overview and stats
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const {
  getDashboardData,
  getStats,
  getChartData,
  getSentiment,
  getActivity
} = require('../controllers/dashboard.controller');

// Apply auth middleware to all routes
router.use(authenticate);

// Dashboard routes
router.get('/', getDashboardData);
router.get('/stats', getStats);
router.get('/chart', getChartData);
router.get('/sentiment', getSentiment);
router.get('/activity', getActivity);

module.exports = router;
