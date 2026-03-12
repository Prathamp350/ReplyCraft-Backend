/**
 * Billing Routes
 * Razorpay payment and subscription management
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const {
  getPlans,
  createOrder,
  verifyPayment,
  getSubscriptionStatus,
  cancelSubscription,
  handleWebhook,
  getInvoices,
  getUsage,
  getBillingInfo
} = require('../controllers/billing.controller');

// Webhook - no auth required
router.post('/webhook', express.raw({ type: 'application/json' }), handleWebhook);

// Protected routes - require authentication
router.get('/plans', getPlans);
router.get('/', authenticate, getBillingInfo);
router.get('/subscription', authenticate, getSubscriptionStatus);
router.get('/usage', authenticate, getUsage);
router.get('/invoices', authenticate, getInvoices);
router.post('/create-order', authenticate, createOrder);
router.post('/verify-payment', authenticate, verifyPayment);
router.post('/cancel', authenticate, cancelSubscription);

module.exports = router;
