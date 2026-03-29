/**
 * Billing Controller
 * Handles Razorpay payments and subscriptions
 * Uses centralized plan config from config/config.js
 */

const Razorpay = require('razorpay');
const User = require('../models/User');
const BusinessConnection = require('../models/BusinessConnection');
const config = require('../config/config');
const logger = require('../utils/logger');

// Initialize Razorpay
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || 'your_key_id',
  key_secret: process.env.RAZORPAY_KEY_SECRET || 'your_key_secret'
});

// Derive Razorpay plan config from centralized config
function getRazorpayPlan(planId) {
  const plan = config.plans[planId];
  if (!plan) return null;
  return {
    id: planId,
    name: plan.name,
    priceId: process.env[`RAZORPAY_PLAN_${planId.toUpperCase()}`] || `plan_${planId}`,
    price: plan.priceINR * 100, // paise
    monthlyLimit: plan.monthlyLimit,
    perMinute: plan.perMinute,
    platformLimit: plan.platformLimit,
    storageMB: plan.storageMB,
    hasWatermark: plan.hasWatermark,
  };
}

/**
 * Get available plans
 */
const getPlans = async (req, res) => {
  try {
    const plans = config.validPlans.map(key => {
      const plan = config.plans[key];
      return {
        id: key,
        name: plan.name,
        price: plan.priceINR,
        pricePaise: plan.priceINR * 100,
        monthlyLimit: plan.monthlyLimit,
        perMinute: plan.perMinute,
        platformLimit: plan.platformLimit === Infinity ? null : plan.platformLimit,
        storageMB: plan.storageMB,
        hasWatermark: plan.hasWatermark,
        features: plan.features,
      };
    });

    return res.status(200).json({
      success: true,
      plans
    });

  } catch (error) {
    logger.error('Failed to get plans', { error: error.message });
    return res.status(500).json({ success: false, error: 'Failed to get plans' });
  }
};

/**
 * Create Razorpay order for subscription
 */
const createOrder = async (req, res) => {
  try {
    const { plan: planType } = req.body;
    const user = req.user;

    // Validate plan
    if (!planType || !config.plans[planType]) {
      return res.status(400).json({
        success: false,
        error: `Invalid plan. Choose from: ${config.validPlans.join(', ')}`
      });
    }

    const rpPlan = getRazorpayPlan(planType);

    // Free plan doesn't need payment
    if (planType === 'free') {
      return res.status(400).json({
        success: false,
        error: 'Free plan is the default plan'
      });
    }

    // Create Razorpay order
    const options = {
      amount: rpPlan.price, // Amount in paise
      currency: 'INR',
      receipt: `receipt_${user._id}_${Date.now()}`,
      notes: {
        userId: user._id.toString(),
        plan: planType,
        email: user.email
      }
    };

    const order = await razorpay.orders.create(options);

    logger.logBilling('Razorpay order created', {
      orderId: order.id,
      userId: user._id,
      plan: planType,
      amount: rpPlan.price
    });

    return res.status(200).json({
      success: true,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: process.env.RAZORPAY_KEY_ID,
      plan: {
        id: rpPlan.id,
        name: rpPlan.name,
        monthlyLimit: rpPlan.monthlyLimit
      }
    });

  } catch (error) {
    logger.error('Failed to create order', {
      error: error.message,
      userId: req.userId
    });

    return res.status(500).json({
      success: false,
      error: 'Failed to create payment order'
    });
  }
};

/**
 * Verify payment and activate subscription
 */
const verifyPayment = async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, plan: planType } = req.body;
    const user = req.user;

    // Validate required fields
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({
        success: false,
        error: 'Payment verification failed: missing fields'
      });
    }

    // Validate plan
    if (!planType || !config.plans[planType]) {
      return res.status(400).json({
        success: false,
        error: 'Invalid plan'
      });
    }

    // Verify signature
    const crypto = require('crypto');
    const generatedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (generatedSignature !== razorpay_signature) {
      logger.error('Payment signature verification failed', {
        userId: user._id,
        orderId: razorpay_order_id
      });

      return res.status(400).json({
        success: false,
        error: 'Payment verification failed: invalid signature'
      });
    }

    // Payment verified - update user plan
    const plan = config.plans[planType];
    
    user.plan = planType;
    user.razorpayOrderId = razorpay_order_id;
    user.razorpayPaymentId = razorpay_payment_id;
    user.razorpaySubscriptionStatus = 'active';
    user.subscriptionStatus = 'active';
    user.subscriptionCurrentPeriodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
    user.planExpiresAt = user.subscriptionCurrentPeriodEnd;
    
    await user.save();

    logger.logBilling('Payment verified, plan activated', {
      userId: user._id,
      plan: planType,
      paymentId: razorpay_payment_id
    });

    return res.status(200).json({
      success: true,
      message: 'Payment successful! Plan activated.',
      plan: {
        id: planType,
        name: plan.name,
        monthlyLimit: plan.monthlyLimit
      },
      subscription: {
        status: 'active',
        currentPeriodEnd: user.subscriptionCurrentPeriodEnd
      }
    });

  } catch (error) {
    logger.error('Payment verification error', {
      error: error.message,
      userId: req.userId
    });

    return res.status(500).json({
      success: false,
      error: 'Payment verification failed'
    });
  }
};

/**
 * Get current subscription status
 */
const getSubscriptionStatus = async (req, res) => {
  try {
    const user = req.user;
    const plan = config.plans[user.plan] || config.plans.free;

    return res.status(200).json({
      success: true,
      plan: user.plan,
      status: user.razorpaySubscriptionStatus || (user.plan === 'free' ? 'active' : 'inactive'),
      currentPeriodEnd: user.subscriptionCurrentPeriodEnd 
        ? Math.floor(user.subscriptionCurrentPeriodEnd.getTime() / 1000) 
        : null,
      monthlyLimit: plan.monthlyLimit,
      perMinute: plan.perMinute,
      platformLimit: plan.platformLimit === Infinity ? null : plan.platformLimit,
      storageMB: plan.storageMB,
      hasWatermark: plan.hasWatermark,
      razorpayPaymentId: user.razorpayPaymentId || null
    });

  } catch (error) {
    logger.error('Failed to get subscription status', {
      error: error.message,
      userId: req.userId
    });

    return res.status(500).json({
      success: false,
      error: 'Failed to get subscription status'
    });
  }
};

/**
 * Cancel subscription (downgrade to free)
 */
const cancelSubscription = async (req, res) => {
  try {
    const user = req.user;

    if (user.plan === 'free') {
      return res.status(400).json({
        success: false,
        error: 'No active subscription to cancel'
      });
    }

    // Downgrade to free
    user.plan = 'free';
    user.razorpaySubscriptionStatus = 'canceled';
    user.subscriptionStatus = 'canceled';
    user.razorpayOrderId = null;
    user.razorpayPaymentId = null;
    user.subscriptionCurrentPeriodEnd = null;
    user.planExpiresAt = null;
    user.extraStorageMB = 0; // Reset extra storage
    
    await user.save();

    logger.logBilling('Subscription canceled', { userId: user._id });

    return res.status(200).json({
      success: true,
      message: 'Subscription canceled. You are now on the Free plan.',
      plan: 'free'
    });

  } catch (error) {
    logger.error('Cancel subscription error', {
      error: error.message,
      userId: req.userId
    });

    return res.status(500).json({
      success: false,
      error: 'Failed to cancel subscription'
    });
  }
};

/**
 * Create Razorpay webhook handler
 */
const handleWebhook = async (req, res) => {
  try {
    const crypto = require('crypto');
    const signature = req.headers['x-razorpay-signature'];

    // Verify webhook signature
    const rawPayload = Buffer.isBuffer(req.body)
      ? req.body
      : Buffer.from(JSON.stringify(req.body));

    const generatedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(rawPayload)
      .digest('hex');

    if (signature !== generatedSignature) {
      logger.error('Razorpay webhook signature verification failed');
      return res.status(400).json({ error: 'Invalid signature' });
    }

    const event = Buffer.isBuffer(req.body)
      ? JSON.parse(req.body.toString('utf8'))
      : req.body;
    const { event: eventType } = event;

    logger.info('Razorpay webhook received', { eventType });

    switch (eventType) {
      case 'payment.captured':
        break;
        
      case 'payment.failed':
        logger.warn('Payment failed', { 
          paymentId: event.payment?.entity?.id 
        });
        break;
        
      case 'subscription.activated':
        logger.info('Subscription activated', {
          subscriptionId: event.subscription?.entity?.id
        });
        break;
        
      case 'subscription.cancelled':
        const subscriptionId = event.subscription?.entity?.id;
        if (subscriptionId) {
          await User.updateOne(
            { razorpayOrderId: subscriptionId },
            { 
              plan: 'free',
              razorpaySubscriptionStatus: 'canceled',
              subscriptionStatus: 'canceled',
              extraStorageMB: 0
            }
          );
        }
        break;
        
      default:
        logger.info('Unhandled Razorpay event', { eventType });
    }

    return res.status(200).json({ received: true });

  } catch (error) {
    logger.error('Webhook error', { error: error.message });
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
};

// Plan order for sorting / comparison
const PLAN_ORDER = { free: 0, starter: 1, pro: 2, business: 3 };
const PLAN_ICONS = { free: 'zap', starter: 'rocket', pro: 'crown', business: 'sparkles' };

module.exports = {
  getPlans,
  createOrder,
  verifyPayment,
  getSubscriptionStatus,
  cancelSubscription,
  handleWebhook,

  getUsage: async (req, res) => {
    try {
      const user = req.user;
      const plan = config.plans[user.plan] || config.plans.free;
      const storageInfo = user.getStorageInfo();
      
      // Count connected platforms
      const platformsConnected = await BusinessConnection.countDocuments({
        userId: user._id,
        isActive: true
      });

      return res.status(200).json({
        success: true,
        aiRepliesUsed: user.monthlyUsage?.count || 0,
        aiRepliesLimit: plan.monthlyLimit,
        platformsConnected,
        platformsLimit: plan.platformLimit === Infinity ? null : plan.platformLimit,
        storageUsedMB: storageInfo.usedMB,
        storageLimitMB: storageInfo.totalLimitMB,
        storagePercentUsed: storageInfo.percentUsed,
        canBuyExtraStorage: plan.canBuyExtraStorage,
        hasWatermark: plan.hasWatermark,
      });
    } catch (error) {
      logger.error('Failed to get usage', { error: error.message });
      return res.status(500).json({ success: false, error: 'Failed to get usage' });
    }
  },

  getInvoices: async (req, res) => {
    try {
      return res.status(200).json({
        success: true,
        invoices: []
      });
    } catch (error) {
      logger.error('Failed to get invoices', { error: error.message });
      return res.status(500).json({ success: false, error: 'Failed to get invoices' });
    }
  },

  // Get full billing info for frontend
  getBillingInfo: async (req, res) => {
    try {
      const user = req.user;
      const userPlan = config.plans[user.plan] || config.plans.free;
      const storageInfo = user.getStorageInfo();

      // Count connected platforms
      const platformsConnected = await BusinessConnection.countDocuments({
        userId: user._id,
        isActive: true
      });

      // Format current plan for frontend
      const currentPlan = {
        id: user.plan,
        name: userPlan.name,
        price: userPlan.priceINR === 0 ? '₹0' : `₹${userPlan.priceINR}`,
        period: '/mo',
        repliesPerDay: `${userPlan.monthlyLimit.toLocaleString()}/month`,
        features: userPlan.features,
        icon: PLAN_ICONS[user.plan] || 'zap',
        popular: user.plan === 'starter',
        order: PLAN_ORDER[user.plan] || 0,
      };

      // All plans for comparison
      const allPlans = config.validPlans.map(key => {
        const p = config.plans[key];
        return {
          id: key,
          name: p.name,
          price: p.priceINR === 0 ? '₹0' : `₹${p.priceINR}`,
          period: '/mo',
          repliesPerDay: `${p.monthlyLimit.toLocaleString()}/month`,
          features: p.features,
          icon: PLAN_ICONS[key] || 'zap',
          popular: key === 'starter',
          order: PLAN_ORDER[key] || 0,
          platformLimit: p.platformLimit === Infinity ? null : p.platformLimit,
          storageMB: p.storageMB,
          hasWatermark: p.hasWatermark,
        };
      });

      const nextBillingDate = user.subscriptionCurrentPeriodEnd 
        ? new Date(user.subscriptionCurrentPeriodEnd).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
        : null;

      return res.status(200).json({
        success: true,
        currentPlan,
        allPlans,
        nextBillingDate,
        usage: {
          aiRepliesUsed: user.monthlyUsage?.count || 0,
          aiRepliesLimit: userPlan.monthlyLimit,
          platformsConnected,
          platformsLimit: userPlan.platformLimit === Infinity ? null : userPlan.platformLimit,
          storageUsedMB: storageInfo.usedMB,
          storageLimitMB: storageInfo.totalLimitMB,
          storagePercentUsed: storageInfo.percentUsed,
          canBuyExtraStorage: userPlan.canBuyExtraStorage,
        },
        invoices: []
      });
    } catch (error) {
      logger.error('Failed to get billing info', { error: error.message });
      return res.status(500).json({ success: false, error: 'Failed to get billing info' });
    }
  }
};
