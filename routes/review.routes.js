/**
 * Review Routes
 * Handles review inbox operations
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const { requirePremium, checkDailyLimit } = require('../middleware/premium.middleware');
const {
  getReviews,
  getReview,
  approveReply,
  updateReply,
  sendReply,
  generateReply,
  rejectReply
} = require('../controllers/review.controller');

// All routes require authentication
router.get('/', authenticate, getReviews);
router.get('/:id', authenticate, getReview);

// Actions - some require premium
router.post('/:id/generate', authenticate, requirePremium, checkDailyLimit, generateReply);
router.post('/:id/approve', authenticate, approveReply);
router.put('/:id/edit', authenticate, updateReply);
router.post('/:id/send', authenticate, sendReply);
router.post('/:id/reject', authenticate, rejectReply);

module.exports = router;
