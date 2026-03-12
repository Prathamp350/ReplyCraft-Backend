/**
 * Billing Controller
 * Handles Razorpay payments and subscriptions
 */

const Razorpay = require('razorpay');
const User = require('../models/User');
const logger = require('../utils/logger');

// Initialize Razorpay
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || 'your_key_id',
  key_secret: process.env.RAZORPAY_KEY_SECRET || 'your_key_secret'
});

// Plan configuration (in paise - multiply by 100)
const PLANS = {
  free: {
    id: 'free',
    name: 'Free',
    priceId: 'plan_free',
    price: 0, // ₹0
    dailyLimit: 5,
    perMinute: 2
  },
  go: {
    id: 'go',
    name: 'Go',
    priceId: process.env.RAZORPAY_PLAN_GO || 'plan_go',
    price: 29900, // ₹299
    dailyLimit: 200,
    perMinute: 10
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    priceId: process.env.RAZORPAY_PLAN_PRO || 'plan_pro',
    price: 79900, // ₹799
    dailyLimit: 1000,
    perMinute: 30
  },
  ultra: {
    id: 'ultra',
    name: 'Ultra',
    priceId: process.env.RAZORPAY_PLAN_ULTRA || 'plan_ultra',
    price: 199900, // ₹1999
    dailyLimit: 5000,
    perMinute: 100
  }
};

/**
 * Get available plans
 */
const getPlans = async (req, res) => {
  try {
    const plans = Object.entries(PLANS).map(([key, plan]) => ({
      id: key,
      name: plan.name,
      price: plan.price / 100, // Convert to rupees
      pricePaise: plan.price,
      dailyLimit: plan.dailyLimit,
      perMinute: plan.perMinute
    }));

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
    if (!planType || !PLANS[planType]) {
      return res.status(400).json({
        success: false,
        error: 'Invalid plan. Choose from: free, go, pro, ultra'
      });
    }

    const plan = PLANS[planType];

    // Free plan doesn't need payment
    if (planType === 'free') {
      return res.status(400).json({
        success: false,
        error: 'Free plan is the default plan'
      });
    }

    // Create Razorpay order
    const options = {
      amount: plan.price, // Amount in paise
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
      amount: plan.price
    });

    return res.status(200).json({
      success: true,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: process.env.RAZORPAY_KEY_ID,
      plan: {
        id: plan.id,
        name: plan.name,
        dailyLimit: plan.dailyLimit
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
    if (!planType || !PLANS[planType]) {
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
    const plan = PLANS[planType];
    
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
        id: plan.id,
        name: plan.name,
        dailyLimit: plan.dailyLimit
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
    const plan = PLANS[user.plan] || PLANS.free;

    return res.status(200).json({
      success: true,
      plan: user.plan,
      status: user.razorpaySubscriptionStatus || (user.plan === 'free' ? 'active' : 'inactive'),
      currentPeriodEnd: user.subscriptionCurrentPeriodEnd 
        ? Math.floor(user.subscriptionCurrentPeriodEnd.getTime() / 1000) 
        : null,
      dailyLimit: plan.dailyLimit,
      perMinute: plan.perMinute,
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
    const generatedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(JSON.stringify(req.body))
      .digest('hex');

    if (signature !== generatedSignature) {
      logger.error('Razorpay webhook signature verification failed');
      return res.status(400).json({ error: 'Invalid signature' });
    }

    const event = req.body;
    const { event: eventType } = event;

    logger.info('Razorpay webhook received', { eventType });

    switch (eventType) {
      case 'payment.captured':
        // Payment successful - already handled in verifyPayment
        break;
        
      case 'payment.failed':
        // Handle failed payment
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
        // Handle subscription cancellation
        const subscriptionId = event.subscription?.entity?.id;
        if (subscriptionId) {
          await User.updateOne(
            { razorpayOrderId: subscriptionId },
            { 
              plan: 'free',
              razorpaySubscriptionStatus: 'canceled',
              subscriptionStatus: 'canceled'
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

module.exports = {
  getPlans,
  createOrder,
  verifyPayment,
  getSubscriptionStatus,
  cancelSubscription,
  handleWebhook,
  PLANS,
  getUsage: async (req, res) => {
    try {
      const user = req.user;
      const plan = PLANS[user.plan] || PLANS.free;
      
      return res.status(200).json({
        success: true,
        aiRepliesUsed: user.dailyUsage?.count || 0,
        aiRepliesLimit: plan.dailyLimit,
        platformsConnected: 0,
        platformsLimit: null,
        storageUsedGb: 0,
        storageLimitGb: 10
      });
    } catch (error) {
      logger.error('Failed to get usage', { error: error.message });
      return res.status(500).json({ success: false, error: 'Failed to get usage' });
    }
  },
  getInvoices: async (req, res) => {
    try {
      const user = req.user;
      
      // In a real app, you'd have an Invoice model
      // For now, return empty array
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
      const plan = PLANS[user.plan] || PLANS.free;

      // Format plan for frontend
      const currentPlan = {
        id: plan.id,
        name: plan.name,
        price: plan.price === 0 ? '$0' : `$${plan.price / 100}`,
        period: '/mo',
        repliesPerDay: plan.dailyLimit === 5 ? '5/day' : 
                       plan.dailyLimit === 200 ? '200/day' : 
                       plan.dailyLimit === 1000 ? '1,000/day' : '5,000/day',
        features: getPlanFeatures(plan.id),
        icon: getPlanIcon(plan.id),
        popular: plan.id === 'pro',
        order: plan.id === 'free' ? 0 : plan.id === 'go' ? 1 : plan.id === 'pro' ? 2 : 3
      };

      // All plans
      const allPlans = Object.entries(PLANS).map(([key, p]) => ({
        id: p.id,
        name: p.name,
        price: p.price === 0 ? '$0' : `$${p.price / 100}`,
        period: '/mo',
        repliesPerDay: p.dailyLimit === 5 ? '5/day' : 
                       p.dailyLimit === 200 ? '200/day' : 
                       p.dailyLimit === 1000 ? '1,000/day' : '5,000/day',
        features: getPlanFeatures(p.id),
        icon: getPlanIcon(p.id),
        popular: p.id === 'pro',
        order: p.id === 'free' ? 0 : p.id === 'go' ? 1 : p.id === 'pro' ? 2 : 3
      }));

      const nextBillingDate = user.subscriptionCurrentPeriodEnd 
        ? new Date(user.subscriptionCurrentPeriodEnd).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
        : null;

      return res.status(200).json({
        success: true,
        currentPlan,
        allPlans,
        nextBillingDate,
        usage: {
          aiRepliesUsed: user.dailyUsage?.count || 0,
          aiRepliesLimit: plan.dailyLimit,
          platformsConnected: 0,
          platformsLimit: null,
          storageUsedGb: 0,
          storageLimitGb: 10
        },
        invoices: []
      });
    } catch (error) {
      logger.error('Failed to get billing info', { error: error.message });
      return res.status(500).json({ success: false, error: 'Failed to get billing info' });
    }
  }
};

// Helper functions
function getPlanFeatures(planId) {
  const features = {
    free: ['5 AI replies/day', '1 platform', 'Basic analytics', 'Email support'],
    go: ['200 AI replies/day', '3 platforms', 'Advanced analytics', 'Priority support'],
    pro: ['1,000 AI replies/day', 'Unlimited platforms', 'Full analytics suite', 'Dedicated support', 'Custom templates'],
    ultra: ['5,000 AI replies/day', 'Unlimited platforms', 'White-label reports', 'API access', 'Account manager']
  };
  return features[planId] || features.free;
}

function getPlanIcon(planId) {
  const icons = {
    free: 'zap',
    go: 'rocket',
    pro: 'crown',
    ultra: 'sparkles'
  };
  return icons[planId] || 'zap';
}
