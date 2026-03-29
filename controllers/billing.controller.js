/**
 * Billing Controller
 * Handles Razorpay payments and subscriptions
 * Uses centralized plan config from config/config.js
 */

const Razorpay = require('razorpay');
const crypto = require('crypto');
const User = require('../models/User');
const BusinessConnection = require('../models/BusinessConnection');
const PromoCode = require('../models/PromoCode');
const CheckoutQuote = require('../models/CheckoutQuote');

const baseConfig = require('../config/config');
const { getConfig } = require('../services/configManager');
const logger = require('../utils/logger');

const isPlaceholderValue = (value = '') =>
  !value || value.startsWith('your_') || value.includes('change_me');

const assertRazorpayConfigured = () => {
  if (
    isPlaceholderValue(process.env.RAZORPAY_KEY_ID) ||
    isPlaceholderValue(process.env.RAZORPAY_KEY_SECRET)
  ) {
    const error = new Error('Razorpay is not configured. Add valid RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.');
    error.statusCode = 503;
    throw error;
  }
};

const getRazorpayClient = () => {
  assertRazorpayConfigured();

  return new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
  });
};

// Derive Razorpay plan config from centralized config
function getRazorpayPlan(planId) {
  const plan = getConfig().plans[planId];
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

function getBillingMultiplier(billing = 'monthly') {
  return billing === 'yearly' ? 12 * 0.8 : 1;
}

async function buildOrderPricing(planType, billing = 'monthly', promoCode = '') {
  const rpPlan = getRazorpayPlan(planType);
  if (!rpPlan) {
    throw new Error('Invalid plan');
  }

  const multiplier = getBillingMultiplier(billing);
  const basePricePaise = Math.max(100, Math.round(rpPlan.price * multiplier));
  let finalPricePaise = basePricePaise;
  let appliedPromo = null;
  let discountPercent = 0;

  if (promoCode) {
    const promo = await PromoCode.findOne({ code: promoCode.trim().toUpperCase() });
    if (!promo || !promo.isValid()) {
      const error = new Error('Invalid or expired promo code.');
      error.statusCode = 400;
      throw error;
    }
    if (promo.applicablePlan !== 'all' && promo.applicablePlan !== planType) {
      const error = new Error(`Promo applies only to ${promo.applicablePlan} plan.`);
      error.statusCode = 400;
      throw error;
    }

    discountPercent = promo.discountPercent;
    finalPricePaise = Math.round(finalPricePaise * ((100 - promo.discountPercent) / 100));
    if (finalPricePaise < 100) finalPricePaise = 100;
    appliedPromo = promo.code;
  }

  return {
    rpPlan,
    billing,
    basePricePaise,
    finalPricePaise,
    appliedPromo,
    discountPercent,
  };
}

async function createCheckoutQuote({ userId, planType, billing = 'monthly', promoCode = '' }) {
  const pricing = await buildOrderPricing(planType, billing, promoCode);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  const quote = await CheckoutQuote.create({
    userId,
    plan: planType,
    billing,
    currency: 'INR',
    basePricePaise: pricing.basePricePaise,
    finalPricePaise: pricing.finalPricePaise,
    discountPercent: pricing.discountPercent,
    promoCode: pricing.appliedPromo,
    expiresAt,
  });

  return { quote, pricing };
}

async function getValidQuote(userId, quoteId) {
  const quote = await CheckoutQuote.findOne({
    _id: quoteId,
    userId,
    status: 'active',
    expiresAt: { $gt: new Date() },
  });

  if (!quote) {
    const error = new Error('This checkout quote has expired. Please refresh and try again.');
    error.statusCode = 410;
    throw error;
  }

  return quote;
}

/**
 * Get available plans
 */
const getPlans = async (req, res) => {
  try {
    const plans = baseConfig.validPlans.map(key => {
      const plan = getConfig().plans[key];
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
    const { plan: planType, billing = 'monthly', promoCode, quoteId } = req.body;
    const user = req.user;
    const razorpay = getRazorpayClient();

    // Validate plan
    if (!planType || !getConfig().plans[planType]) {
      return res.status(400).json({
        success: false,
        error: `Invalid plan. Choose from: ${baseConfig.validPlans.join(', ')}`
      });
    }

    // Free plan doesn't need payment
    if (planType === 'free') {
      return res.status(400).json({
        success: false,
        error: 'Free plan is the default plan'
      });
    }

    let rpPlan;
    let finalPricePaise;
    let appliedPromo;
    let basePricePaise;
    let discountPercent;
    let resolvedPlan = planType;
    let resolvedBilling = billing;
    let quote = null;

    if (quoteId) {
      quote = await getValidQuote(user._id, quoteId);
      rpPlan = getRazorpayPlan(quote.plan);
      finalPricePaise = quote.finalPricePaise;
      appliedPromo = quote.promoCode;
      basePricePaise = quote.basePricePaise;
      discountPercent = quote.discountPercent;
      resolvedPlan = quote.plan;
      resolvedBilling = quote.billing;
    } else {
      ({ rpPlan, finalPricePaise, appliedPromo, basePricePaise, discountPercent } =
        await buildOrderPricing(planType, billing, promoCode));
    }

    // Create Razorpay order
    const options = {
      amount: finalPricePaise, // Amount in paise
      currency: 'INR',
      receipt: `receipt_${user._id}_${Date.now()}`,
      notes: {
        userId: user._id.toString(),
        plan: resolvedPlan,
        billing: resolvedBilling,
        email: user.email,
        promoCode: appliedPromo || '',
        quoteId: quote?._id?.toString() || ''
      }
    };

    const order = await razorpay.orders.create(options);

    logger.logBilling('Razorpay order created', {
      orderId: order.id,
      userId: user._id,
      plan: resolvedPlan,
      amount: finalPricePaise
    });

    if (quote) {
      quote.razorpayOrderId = order.id;
      await quote.save();
    }

    return res.status(200).json({
      success: true,
      orderId: order.id,
      gateway: 'razorpay',
      amount: order.amount,
      currency: order.currency,
      keyId: process.env.RAZORPAY_KEY_ID,
      billing: resolvedBilling,
      baseAmount: basePricePaise,
      discountPercent,
      quoteId: quote?._id?.toString() || null,
      quoteExpiresAt: quote?.expiresAt || null,
      plan: {
        id: rpPlan.id,
        name: rpPlan.name,
        monthlyLimit: rpPlan.monthlyLimit
      }
    });

  } catch (error) {
    const statusCode = error.statusCode || 500;
    logger.error('Failed to create order', {
      error: error.message,
      userId: req.userId,
      planType: req.body?.plan,
      quoteId: req.body?.quoteId
    });

    return res.status(statusCode).json({
      success: false,
      error: error.message || 'Failed to create payment order'
    });
  }
};

/**
 * Verify payment and activate subscription
 */
const verifyPayment = async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, plan: planType, promoCode, quoteId } = req.body;
    const user = req.user;
    const razorpay = getRazorpayClient();

    // Validate required fields
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({
        success: false,
        error: 'Payment verification failed: missing fields'
      });
    }

    let quote = null;
    if (quoteId) {
      quote = await CheckoutQuote.findOne({ _id: quoteId, userId: user._id });
      if (quote && quote.status === 'used' && user.razorpayPaymentId === razorpay_payment_id) {
        const activePlan = getConfig().plans[user.plan] || getConfig().plans.free;
        return res.status(200).json({
          success: true,
          message: 'Payment already verified.',
          plan: {
            id: user.plan,
            name: activePlan.name,
            monthlyLimit: activePlan.monthlyLimit
          },
          subscription: {
            status: user.subscriptionStatus || 'active',
            currentPeriodEnd: user.subscriptionCurrentPeriodEnd
          }
        });
      }

      if (quote && quote.status === 'used') {
        return res.status(409).json({
          success: false,
          error: 'This checkout quote has already been used'
        });
      }
    }

    // Verify signature
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

    const [order, payment] = await Promise.all([
      razorpay.orders.fetch(razorpay_order_id),
      razorpay.payments.fetch(razorpay_payment_id)
    ]);

    if (!order || !payment) {
      return res.status(400).json({
        success: false,
        error: 'Unable to validate payment with Razorpay'
      });
    }

    if (payment.order_id !== razorpay_order_id) {
      return res.status(400).json({
        success: false,
        error: 'Payment does not belong to the supplied order'
      });
    }

    if (!['authorized', 'captured'].includes(payment.status)) {
      return res.status(400).json({
        success: false,
        error: `Payment is not complete. Current status: ${payment.status}`
      });
    }

    if (String(order.notes?.userId || '') !== String(user._id)) {
      return res.status(403).json({
        success: false,
        error: 'This payment order does not belong to the authenticated user'
      });
    }

    const resolvedPlanType = quote?.plan || order.notes?.plan || planType;
    if (!resolvedPlanType || !getConfig().plans[resolvedPlanType]) {
      return res.status(400).json({
        success: false,
        error: 'Invalid plan'
      });
    }

    const resolvedBilling = quote?.billing || order.notes?.billing || 'monthly';
    const resolvedPromoCode = quote?.promoCode || promoCode || null;
    const expectedAmountPaise = quote?.finalPricePaise || order.amount;

    if (Number(order.amount) !== Number(expectedAmountPaise)) {
      return res.status(400).json({
        success: false,
        error: 'Order amount does not match the locked checkout quote'
      });
    }

    // Payment verified - update user plan
    const plan = getConfig().plans[resolvedPlanType];
    const subscriptionEnd = new Date(
      Date.now() + (resolvedBilling === 'yearly' ? 365 : 30) * 24 * 60 * 60 * 1000
    );
    
    user.plan = resolvedPlanType;
    user.razorpayOrderId = razorpay_order_id;
    user.razorpayPaymentId = razorpay_payment_id;
    user.razorpaySubscriptionStatus = 'active';
    user.subscriptionStatus = 'active';
    user.subscriptionCurrentPeriodEnd = subscriptionEnd;
    user.planExpiresAt = user.subscriptionCurrentPeriodEnd;
    
    // Increment promo usage if appended
    if (resolvedPromoCode) {
      const promo = await PromoCode.findOne({ code: resolvedPromoCode.trim().toUpperCase() });
      if (promo) {
        promo.currentUses += 1;
        await promo.save();
        user.appliedPromoCode = promo.code;
      }
    } else {
      user.appliedPromoCode = null;
    }
    
    await user.save();

    if (quote) {
      quote.status = 'used';
      quote.razorpayOrderId = razorpay_order_id;
      await quote.save();
    }

    logger.logBilling('Payment verified, plan activated', {
      userId: user._id,
      plan: resolvedPlanType,
      billing: resolvedBilling,
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
    const statusCode = error.statusCode || 500;
    logger.error('Payment verification error', {
      error: error.message,
      userId: req.userId,
      orderId: req.body?.razorpay_order_id,
      paymentId: req.body?.razorpay_payment_id
    });

    return res.status(statusCode).json({
      success: false,
      error: error.message || 'Payment verification failed'
    });
  }
};

/**
 * Get current subscription status
 */
const getSubscriptionStatus = async (req, res) => {
  try {
    const user = req.user;
    const plan = getConfig().plans[user.plan] || getConfig().plans.free;

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
    const signature = req.headers['x-razorpay-signature'];
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

    if (isPlaceholderValue(webhookSecret)) {
      logger.error('Razorpay webhook secret is not configured');
      return res.status(503).json({ error: 'Webhook secret not configured' });
    }

    // Verify webhook signature
    const rawPayload = Buffer.isBuffer(req.rawBody)
      ? req.rawBody
      : Buffer.isBuffer(req.body)
        ? req.body
        : Buffer.from(JSON.stringify(req.body || {}));

    const generatedSignature = crypto
      .createHmac('sha256', webhookSecret)
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
  getOrderSummary: async (req, res) => {
    try {
      const { plan: planType, billing = 'monthly', promoCode } = req.body;

      if (!planType || !getConfig().plans[planType]) {
        return res.status(400).json({
          success: false,
          error: `Invalid plan. Choose from: ${baseConfig.validPlans.join(', ')}`
        });
      }

      const { quote, pricing } = await createCheckoutQuote({
        userId: req.user._id,
        planType,
        billing,
        promoCode,
      });
      const { rpPlan, basePricePaise, finalPricePaise, discountPercent } = pricing;

      return res.status(200).json({
        success: true,
        quoteId: quote._id.toString(),
        expiresAt: quote.expiresAt,
        planId: rpPlan.id,
        planName: rpPlan.name,
        billing,
        basePrice: Math.round(basePricePaise / 100),
        currency: 'INR',
        currencySymbol: '₹',
        discount: Math.round((basePricePaise - finalPricePaise) / 100),
        discountLabel: discountPercent > 0 ? `${discountPercent}% off` : '',
        tax: 0,
        taxLabel: '',
        total: Math.round(finalPricePaise / 100),
        period: billing === 'yearly' ? 'year' : 'month',
        features: getConfig().plans[planType].features,
      });
    } catch (error) {
      const statusCode = error.statusCode || 500;
      logger.error('Failed to get order summary', { error: error.message });
      return res.status(statusCode).json({
        success: false,
        error: error.message || 'Failed to get order summary'
      });
    }
  },

  validatePromo: async (req, res) => {
    try {
      const { code, plan } = req.body;
      if (!code) return res.status(400).json({ success: false, error: 'Promo code required' });

      const promo = await PromoCode.findOne({ code: code.trim().toUpperCase() });
      if (!promo) return res.status(404).json({ success: false, error: 'Invalid Promo Code' });
      if (!promo.isValid()) return res.status(400).json({ success: false, error: 'Promo code is expired or maximum uses reached.' });
      
      if (plan && promo.applicablePlan !== 'all' && promo.applicablePlan !== plan) {
        return res.status(400).json({ success: false, error: `This promo applies to the ${promo.applicablePlan} plan only.` });
      }

      return res.status(200).json({
        success: true,
        valid: true,
        discountPercent: promo.discountPercent,
        discountLabel: `${promo.discountPercent}% off`,
        message: 'Promo applied successfully!'
      });
    } catch (error) {
      logger.error('Validate Promo Error', { error: error.message });
      return res.status(500).json({ success: false, error: 'Promo validation failed' });
    }
  },



  getUsage: async (req, res) => {
    try {
      const user = req.user;
      const plan = getConfig().plans[user.plan] || getConfig().plans.free;
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
      const userPlan = getConfig().plans[user.plan] || getConfig().plans.free;
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
      const allPlans = baseConfig.validPlans.map(key => {
        const p = getConfig().plans[key];
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
