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
  getOrderSummary,
  validatePromo,
  getSubscriptionStatus,
  cancelSubscription,
  handleWebhook,
  getInvoices,
  getUsage,
  getBillingInfo
} = require('../controllers/billing.controller');

// Webhook - no auth required
router.post('/webhook', handleWebhook);

// Protected routes - require authentication
router.get('/plans', getPlans);
router.post('/order-summary', authenticate, getOrderSummary);
router.get('/', authenticate, getBillingInfo);
router.get('/subscription', authenticate, getSubscriptionStatus);
router.get('/usage', authenticate, getUsage);
router.get('/invoices', authenticate, getInvoices);
router.post('/create-order', authenticate, createOrder);
router.post('/promo/validate', authenticate, validatePromo);
router.post('/verify-payment', authenticate, verifyPayment);
router.post('/cancel', authenticate, cancelSubscription);

module.exports = router;
