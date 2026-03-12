const express = require('express');
const router = express.Router();
const googleController = require('../controllers/google.controller');
const { authenticate } = require('../middleware/auth.middleware');

// Apply auth middleware to all routes
router.use(authenticate);

// GET /api/google/connect - Initiate OAuth flow
router.get('/connect', googleController.connect);

// GET /api/google/callback - OAuth callback
router.get('/callback', googleController.handleCallback);

// GET /api/google/connections - List user's connections
router.get('/connections', googleController.listConnections);

// DELETE /api/google/connections/:connectionId - Disconnect
router.delete('/connections/:connectionId', googleController.disconnect);

// GET /api/google/reviews - Get all reviews
router.get('/reviews', googleController.getAllReviews);

// GET /api/google/connections/:connectionId/reviews - Get reviews for connection
router.get('/connections/:connectionId/reviews', googleController.getReviews);

module.exports = router;
