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
const Invoice = require('../models/Invoice');
const RazorpayWebhookEvent = require('../models/RazorpayWebhookEvent');

const baseConfig = require('../config/config');
const { getConfig } = require('../services/configManager');
const logger = require('../utils/logger');
const {
  queuePlanUpgradeEmail,
  queueSubscriptionActivatedEmail,
  queueSubscriptionCanceledEmail
} = require('../queues/email.queue');

const PLAN_ORDER = { free: 0, starter: 1, pro: 2, business: 3 };
const PLAN_ICONS = { free: 'zap', starter: 'rocket', pro: 'crown', business: 'sparkles' };

const isPlaceholderValue = (value = '') =>
  !value || value.startsWith('your_') || value.includes('change_me');

const getGatewayErrorDetails = (error) => {
  const gatewayPayload =
    error?.error ||
    error?.response?.data?.error ||
    error?.response?.data ||
    null;

  const gatewayDescription =
    gatewayPayload?.description ||
    gatewayPayload?.reason ||
    gatewayPayload?.message ||
    gatewayPayload?.field ||
    null;

  return {
    message: gatewayDescription || error?.message || 'Unknown payment gateway error',
    code: gatewayPayload?.code || error?.code || null,
    source: gatewayPayload?.source || null,
    step: gatewayPayload?.step || null,
    field: gatewayPayload?.field || null,
    metadata: gatewayPayload,
  };
};

const formatInvoiceAmount = (amountPaise, currency = 'INR') => {
  const amount = Number(amountPaise || 0) / 100;

  if (currency === 'INR') {
    return `Rs. ${amount.toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }

  return `${currency} ${amount.toFixed(2)}`;
};

const formatPlanEndDate = (date) =>
  new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

const buildInvoiceDownloadUrl = (req, invoiceId) =>
  `${req.protocol}://${req.get('host')}/api/billing/invoices/${invoiceId}/download`;

const createInvoiceNumber = () =>
  `RC-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

const getPlanIntervalEnd = (billing = 'monthly') =>
  new Date(Date.now() + (billing === 'yearly' ? 365 : 30) * 24 * 60 * 60 * 1000);

async function activatePaidPlan({
  user,
  planType,
  billing,
  orderId,
  paymentId,
  quote = null,
  orderAmountPaise,
  currency = 'INR',
  customerPhone = null,
}) {
  const existingInvoice = await Invoice.findOne({ paymentId });
  const plan = getConfig().plans[planType];

  if (!plan) {
    const error = new Error('Invalid plan for activation');
    error.statusCode = 400;
    throw error;
  }

  if (existingInvoice) {
    return {
      alreadyProcessed: true,
      invoice: existingInvoice,
      plan,
      subscriptionEnd: user.subscriptionCurrentPeriodEnd,
    };
  }

  const isInCycleUpgrade =
    isPaidPlan(user.plan) &&
    getPlanRank(planType) > getPlanRank(user.plan) &&
    user.subscriptionCurrentPeriodEnd &&
    new Date(user.subscriptionCurrentPeriodEnd) > new Date();

  const subscriptionStart = isInCycleUpgrade
    ? (user.subscriptionCurrentPeriodStart || new Date())
    : new Date();
  const subscriptionEnd = isInCycleUpgrade
    ? user.subscriptionCurrentPeriodEnd
    : getPlanIntervalEnd(billing);

  user.plan = planType;
  user.razorpayOrderId = orderId;
  user.razorpayPaymentId = paymentId;
  user.razorpaySubscriptionStatus = 'active';
  user.subscriptionStatus = 'active';
  user.subscriptionCurrentPeriodStart = subscriptionStart;
  user.subscriptionCurrentPeriodEnd = subscriptionEnd;
  user.planExpiresAt = subscriptionEnd;
  user.billingInterval = billing;
  user.currentPlanPricePaise = getPlanBasePricePaise(planType, billing);
  user.cancelAtPeriodEnd = false;
  user.scheduledPlan = null;
  user.scheduledBillingInterval = null;
  user.scheduledChangeReason = null;
  user.lastPlanChangeAt = new Date();

  if (quote?.promoCode) {
    const promo = await PromoCode.findOne({ code: quote.promoCode.trim().toUpperCase() });
    if (promo) {
      promo.currentUses += 1;
      await promo.save();
      user.appliedPromoCode = promo.code;
    }
  } else {
    user.appliedPromoCode = null;
  }

  await user.save();

  const invoice = await Invoice.create({
    userId: user._id,
    invoiceNumber: createInvoiceNumber(),
    orderId,
    paymentId,
    planId: planType,
    planName: plan.name,
    billing,
    status: 'paid',
    currency,
    baseAmountPaise: quote?.basePricePaise || orderAmountPaise,
    discountAmountPaise: Math.max(0, (quote?.basePricePaise || orderAmountPaise) - (quote?.finalPricePaise || orderAmountPaise)),
    totalAmountPaise: quote?.finalPricePaise || orderAmountPaise,
    promoCode: quote?.promoCode || null,
    customerName: user.name,
    customerEmail: user.email,
    customerPhone: customerPhone || user.phoneNumber || null,
    paidAt: new Date(),
  });

  if (quote && quote.status !== 'used') {
    quote.status = 'used';
    quote.razorpayOrderId = orderId;
    await quote.save();
  }

  queuePlanUpgradeEmail({
    to: user.email,
    name: user.name,
    planName: plan.name,
    invoiceNumber: invoice.invoiceNumber,
    orderId,
    paymentId,
    billingLabel: billing === 'yearly' ? 'Yearly billing' : 'Monthly billing',
    amountPaid: formatInvoiceAmount(invoice.totalAmountPaise, invoice.currency),
    monthlyLimit: `${plan.monthlyLimit.toLocaleString()} replies / month`,
    storage: `${plan.storageMB} MB included`,
    planEndsAt: formatPlanEndDate(subscriptionEnd),
  }).catch((queueError) => {
    logger.error('Failed to queue plan upgrade email', {
      error: queueError.message,
      userId: user._id,
      invoiceNumber: invoice.invoiceNumber
    });
  });

  queueSubscriptionActivatedEmail({
    to: user.email,
    name: user.name,
    planName: plan.name,
    billingLabel: billing === 'yearly' ? 'Yearly billing' : 'Monthly billing',
    amountPaid: formatInvoiceAmount(invoice.totalAmountPaise, invoice.currency),
    invoiceNumber: invoice.invoiceNumber,
    planEndsAt: formatPlanEndDate(subscriptionEnd),
  }).catch((queueError) => {
    logger.error('Failed to queue subscription activated email', {
      error: queueError.message,
      userId: user._id,
    });
  });

  return {
    alreadyProcessed: false,
    invoice,
    plan,
    subscriptionEnd,
  };
}

const buildInvoiceHtml = (invoice) => {
  const paidDate = new Date(invoice.paidAt || invoice.createdAt);
  const dateLabel = paidDate.toLocaleString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Invoice ${invoice.invoiceNumber}</title>
</head>
<body style="margin:0;padding:32px;background:#f4f7fb;font-family:Arial,Helvetica,sans-serif;color:#162033;">
  <div style="max-width:760px;margin:0 auto;background:#ffffff;border-radius:20px;overflow:hidden;border:1px solid #e8edf6;">
    <div style="padding:28px 32px;background:linear-gradient(135deg,#12203d,#355cff);color:#ffffff;">
      <div style="font-size:14px;letter-spacing:0.12em;text-transform:uppercase;opacity:0.85;">ReplyCraft Invoice</div>
      <h1 style="margin:12px 0 0;font-size:28px;">${invoice.invoiceNumber}</h1>
      <p style="margin:10px 0 0;font-size:14px;line-height:1.7;opacity:0.92;">Paid on ${dateLabel}</p>
    </div>
    <div style="padding:32px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        <tr><td style="padding:10px 0;color:#657089;">Customer</td><td align="right" style="padding:10px 0;font-weight:700;">${invoice.customerName}</td></tr>
        <tr><td style="padding:10px 0;color:#657089;">Email</td><td align="right" style="padding:10px 0;font-weight:700;">${invoice.customerEmail}</td></tr>
        <tr><td style="padding:10px 0;color:#657089;">Order ID</td><td align="right" style="padding:10px 0;font-weight:700;">${invoice.orderId}</td></tr>
        <tr><td style="padding:10px 0;color:#657089;">Payment ID</td><td align="right" style="padding:10px 0;font-weight:700;">${invoice.paymentId}</td></tr>
        <tr><td style="padding:10px 0;color:#657089;">Plan</td><td align="right" style="padding:10px 0;font-weight:700;">${invoice.planName} (${invoice.billing})</td></tr>
        <tr><td style="padding:10px 0;color:#657089;">Base amount</td><td align="right" style="padding:10px 0;font-weight:700;">${formatInvoiceAmount(invoice.baseAmountPaise, invoice.currency)}</td></tr>
        <tr><td style="padding:10px 0;color:#657089;">Discount</td><td align="right" style="padding:10px 0;font-weight:700;">-${formatInvoiceAmount(invoice.discountAmountPaise, invoice.currency)}</td></tr>
        <tr><td style="padding:16px 0 0;color:#162033;font-size:16px;font-weight:700;border-top:1px solid #e8edf6;">Total paid</td><td align="right" style="padding:16px 0 0;font-size:20px;font-weight:800;border-top:1px solid #e8edf6;">${formatInvoiceAmount(invoice.totalAmountPaise, invoice.currency)}</td></tr>
      </table>
    </div>
  </div>
</body>
</html>`;
};

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

function getBillingCycleDays(billing = 'monthly') {
  return billing === 'yearly' ? 365 : 30;
}

function getPlanRank(planId) {
  return PLAN_ORDER[planId] || 0;
}

function getPlanBasePricePaise(planId, billing = 'monthly') {
  const plan = getConfig().plans[planId];
  if (!plan) return 0;

  return Math.max(0, Math.round((plan.priceINR || 0) * 100 * getBillingMultiplier(billing)));
}

function isPaidPlan(planId) {
  return !!planId && planId !== 'free';
}

function getCurrentPlanBasePricePaise(user) {
  if (!isPaidPlan(user.plan)) {
    return 0;
  }

  return user.currentPlanPricePaise || getPlanBasePricePaise(user.plan, user.billingInterval || 'monthly');
}

function getRemainingTimeRatio(user) {
  if (!user.subscriptionCurrentPeriodEnd) {
    return 1;
  }

  const now = Date.now();
  const periodEnd = new Date(user.subscriptionCurrentPeriodEnd).getTime();
  if (periodEnd <= now) {
    return 0;
  }

  const fallbackStart = periodEnd - getBillingCycleDays(user.billingInterval || 'monthly') * 24 * 60 * 60 * 1000;
  const periodStart = user.subscriptionCurrentPeriodStart
    ? new Date(user.subscriptionCurrentPeriodStart).getTime()
    : fallbackStart;

  const total = Math.max(1, periodEnd - periodStart);
  const remaining = Math.max(0, periodEnd - now);

  return Math.max(0, Math.min(1, remaining / total));
}

function getRemainingUsageRatio(user) {
  if (!isPaidPlan(user.plan)) {
    return 1;
  }

  const currentPlan = getConfig().plans[user.plan] || getConfig().plans.free;
  const limit = Number(currentPlan.monthlyLimit || 0);
  if (limit <= 0) {
    return 1;
  }

  const used = Math.max(0, Number(user.monthlyUsage?.count || 0));
  return Math.max(0, Math.min(1, (limit - Math.min(used, limit)) / limit));
}

function buildPlanChangeDecision(user, targetPlan, targetBilling = 'monthly') {
  const currentPlan = user.plan || 'free';
  const currentBilling = user.billingInterval || 'monthly';
  const currentRank = getPlanRank(currentPlan);
  const targetRank = getPlanRank(targetPlan);
  const currentBasePricePaise = getCurrentPlanBasePricePaise(user);
  const targetBasePricePaise = getPlanBasePricePaise(targetPlan, targetBilling);
  const timeRatio = getRemainingTimeRatio(user);
  const usageRatio = getRemainingUsageRatio(user);
  const fairUseRatio = Math.max(0, Math.min(timeRatio, usageRatio));

  const result = {
    currentPlan,
    targetPlan,
    currentBilling,
    targetBilling,
    currentRank,
    targetRank,
    timeRatio,
    usageRatio,
    fairUseRatio,
    targetBasePricePaise,
    currentBasePricePaise,
    remainingTargetCostPaise: targetBasePricePaise,
    prorationCreditPaise: 0,
    promoDiscountPaise: 0,
    totalDiscountPaise: 0,
    payableNowPaise: targetBasePricePaise,
    action: 'pay_full',
    effectiveAt: null,
    reason: 'new_subscription',
  };

  if (targetPlan === currentPlan && targetBilling === currentBilling) {
    result.action = 'noop';
    result.payableNowPaise = 0;
    result.remainingTargetCostPaise = 0;
    result.reason = 'already_on_plan';
    return result;
  }

  if (!isPaidPlan(currentPlan) || !user.subscriptionCurrentPeriodEnd || user.subscriptionCurrentPeriodEnd <= new Date()) {
    return result;
  }

  if (targetRank < currentRank || (targetRank === currentRank && targetBilling !== currentBilling)) {
    result.action = 'schedule_change';
    result.payableNowPaise = 0;
    result.remainingTargetCostPaise = 0;
    result.reason = targetPlan === 'free' ? 'cancel_at_period_end' : 'downgrade_at_period_end';
    result.effectiveAt = user.subscriptionCurrentPeriodEnd;
    return result;
  }

  if (targetRank === currentRank) {
    result.action = 'noop';
    result.payableNowPaise = 0;
    result.remainingTargetCostPaise = 0;
    result.reason = 'already_on_equivalent_plan';
    return result;
  }

  result.action = 'upgrade_now';
  result.reason = 'prorated_upgrade';
  result.effectiveAt = new Date();
  result.remainingTargetCostPaise = Math.round(targetBasePricePaise * fairUseRatio);
  result.prorationCreditPaise = Math.round(currentBasePricePaise * fairUseRatio);
  result.totalDiscountPaise = result.prorationCreditPaise;
  result.payableNowPaise = Math.max(100, result.remainingTargetCostPaise - result.prorationCreditPaise);

  return result;
}

async function buildOrderPricing(user, planType, billing = 'monthly', promoCode = '') {
  const rpPlan = getRazorpayPlan(planType);
  if (!rpPlan) {
    throw new Error('Invalid plan');
  }

  const decision = buildPlanChangeDecision(user, planType, billing);
  if (decision.action === 'noop') {
    const error = new Error('You are already on this plan.');
    error.statusCode = 400;
    throw error;
  }

  if (decision.action === 'schedule_change') {
    const error = new Error('This plan change is applied from the billing page and takes effect at the end of the current billing cycle.');
    error.statusCode = 400;
    throw error;
  }

  const basePricePaise = Math.max(0, decision.remainingTargetCostPaise);
  let finalPricePaise = Math.max(0, decision.payableNowPaise);
  let appliedPromo = null;
  let discountPercent = 0;
  let promoDiscountPaise = 0;

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
    promoDiscountPaise = Math.round(finalPricePaise * (promo.discountPercent / 100));
    finalPricePaise = Math.max(100, finalPricePaise - promoDiscountPaise);
    appliedPromo = promo.code;
  }

  return {
    rpPlan,
    billing,
    basePricePaise,
    finalPricePaise,
    appliedPromo,
    discountPercent,
    promoDiscountPaise,
    prorationCreditPaise: decision.prorationCreditPaise,
    chargeType: decision.action,
    pricingMode: decision.reason,
    currentPlanId: user.plan,
    fairUseRatio: decision.fairUseRatio,
    remainingTimeRatio: decision.timeRatio,
    remainingUsageRatio: decision.usageRatio,
    effectiveAt: decision.effectiveAt,
  };
}

async function createCheckoutQuote({ userId, planType, billing = 'monthly', promoCode = '' }) {
  const user = await User.findById(userId);
  if (!user) {
    const error = new Error('User not found');
    error.statusCode = 404;
    throw error;
  }

  const pricing = await buildOrderPricing(user, planType, billing, promoCode);
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
    prorationCreditPaise: pricing.prorationCreditPaise,
    promoDiscountPaise: pricing.promoDiscountPaise,
    pricingMode: pricing.pricingMode,
    chargeType: pricing.chargeType,
    currentPlan: pricing.currentPlanId,
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

    const decision = buildPlanChangeDecision(user, planType, billing);
    if (decision.action === 'noop') {
      return res.status(400).json({
        success: false,
        error: 'You are already on this plan.'
      });
    }

    if (decision.action === 'schedule_change') {
      return res.status(400).json({
        success: false,
        error: 'This plan change is scheduled from the billing page and does not require immediate payment.'
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
        await buildOrderPricing(user, planType, billing, promoCode));
    }

    // Create Razorpay order
    const shortUserId = String(user._id).slice(-8);
    const shortTimestamp = Date.now().toString().slice(-10);
    const options = {
      amount: finalPricePaise, // Amount in paise
      currency: 'INR',
      receipt: `rc_${shortUserId}_${shortTimestamp}`,
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
    const gatewayError = getGatewayErrorDetails(error);
    logger.error('Failed to create order', {
      error: gatewayError.message,
      gatewayCode: gatewayError.code,
      gatewaySource: gatewayError.source,
      gatewayStep: gatewayError.step,
      gatewayField: gatewayError.field,
      gatewayMetadata: gatewayError.metadata,
      userId: req.userId,
      planType: req.body?.plan,
      quoteId: req.body?.quoteId,
      razorpayKeyPrefix: (process.env.RAZORPAY_KEY_ID || '').slice(0, 8)
    });

    return res.status(statusCode).json({
      success: false,
      error: gatewayError.message || 'Failed to create payment order'
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

    const { invoice, plan, subscriptionEnd } = await activatePaidPlan({
      user,
      planType: resolvedPlanType,
      billing: resolvedBilling,
      orderId: razorpay_order_id,
      paymentId: razorpay_payment_id,
      quote,
      orderAmountPaise: order.amount,
      currency: order.currency || 'INR',
      customerPhone: user.phoneNumber || null,
    });

    logger.logBilling('Payment verified, plan activated', {
      userId: user._id,
      plan: resolvedPlanType,
      billing: resolvedBilling,
      paymentId: razorpay_payment_id,
      invoiceNumber: invoice.invoiceNumber
    });

    return res.status(200).json({
      success: true,
      message: 'Payment successful! Plan activated.',
      plan: {
        id: resolvedPlanType,
        name: plan.name,
        monthlyLimit: plan.monthlyLimit
      },
      subscription: {
        status: 'active',
        currentPeriodEnd: subscriptionEnd
      }
    });

  } catch (error) {
    const statusCode = error.statusCode || 500;
    const gatewayError = getGatewayErrorDetails(error);
    logger.error('Payment verification error', {
      error: gatewayError.message,
      gatewayCode: gatewayError.code,
      gatewaySource: gatewayError.source,
      gatewayStep: gatewayError.step,
      gatewayField: gatewayError.field,
      gatewayMetadata: gatewayError.metadata,
      userId: req.userId,
      orderId: req.body?.razorpay_order_id,
      paymentId: req.body?.razorpay_payment_id
    });

    return res.status(statusCode).json({
      success: false,
      error: gatewayError.message || 'Payment verification failed'
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
      razorpayPaymentId: user.razorpayPaymentId || null,
      billingInterval: user.billingInterval || 'monthly',
      cancelAtPeriodEnd: !!user.cancelAtPeriodEnd,
      scheduledPlan: user.scheduledPlan || null,
      scheduledBillingInterval: user.scheduledBillingInterval || null
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
 * Cancel subscription at period end
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

    user.cancelAtPeriodEnd = true;
    user.scheduledPlan = 'free';
    user.scheduledBillingInterval = 'monthly';
    user.scheduledChangeReason = 'cancel';
    user.subscriptionStatus = 'active';
    user.razorpaySubscriptionStatus = 'active';
    
    await user.save();

    logger.logBilling('Subscription canceled', { userId: user._id });

    queueSubscriptionCanceledEmail({
      to: user.email,
      name: user.name,
      canceledAt: new Date().toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })
    }).catch((queueError) => {
      logger.error('Failed to queue subscription canceled email', {
        error: queueError.message,
        userId: user._id
      });
    });

    return res.status(200).json({
      success: true,
      message: 'Subscription will end on the current billing period end date.',
      plan: user.plan,
      cancelAtPeriodEnd: true,
      effectiveAt: user.subscriptionCurrentPeriodEnd
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
    const eventId = req.headers['x-razorpay-event-id'];

    logger.info('Razorpay webhook received', { eventType, eventId: eventId || null });

    if (eventId) {
      const reserveResult = await RazorpayWebhookEvent.findOneAndUpdate(
        { eventId },
        {
          $setOnInsert: {
            eventId,
            eventType,
            paymentId: event.payload?.payment?.entity?.id || null,
            orderId: event.payload?.payment?.entity?.order_id || null,
            status: 'processing',
            processedAt: null,
            lastError: null,
          },
        },
        {
          upsert: true,
          new: true,
          rawResult: true,
        }
      );

      const existingRecord = reserveResult.value;
      const wasInserted = !reserveResult.lastErrorObject.updatedExisting;

      if (!wasInserted && existingRecord?.status === 'processed') {
        logger.info('Skipping already processed Razorpay webhook event', { eventId, eventType });
        return res.status(200).json({ received: true, duplicate: true });
      }

      if (!wasInserted && existingRecord?.status === 'processing') {
        logger.warn('Razorpay webhook event is already processing', { eventId, eventType });
        return res.status(202).json({ received: true, processing: true });
      }
    }

    switch (eventType) {
      case 'payment.captured': {
        const paymentEntity = event.payload?.payment?.entity;
        const orderId = paymentEntity?.order_id;
        const paymentId = paymentEntity?.id;

        if (orderId && paymentId) {
          const razorpay = getRazorpayClient();
          const [order, payment] = await Promise.all([
            razorpay.orders.fetch(orderId),
            razorpay.payments.fetch(paymentId)
          ]);

          const userId = order?.notes?.userId;
          const planType = order?.notes?.plan;
          const billing = order?.notes?.billing || 'monthly';
          const quoteId = order?.notes?.quoteId;

          if (userId && planType) {
            const user = await User.findById(userId);
            if (user) {
              const quote = quoteId ? await CheckoutQuote.findOne({ _id: quoteId, userId }) : null;
              await activatePaidPlan({
                user,
                planType,
                billing,
                orderId,
                paymentId,
                quote,
                orderAmountPaise: order.amount,
                currency: order.currency || 'INR',
                customerPhone: payment.contact || null,
              });
            }
          }
        }
        break;
      }

      case 'payment.failed': {
        const paymentEntity = event.payload?.payment?.entity;
        const orderId = paymentEntity?.order_id;
        const userIdFromNotes = paymentEntity?.notes?.userId;

        if (userIdFromNotes) {
          await User.updateOne(
            { _id: userIdFromNotes },
            { subscriptionStatus: 'past_due', razorpaySubscriptionStatus: 'past_due' }
          );
        } else if (orderId) {
          const razorpay = getRazorpayClient();
          const order = await razorpay.orders.fetch(orderId);
          if (order?.notes?.userId) {
            await User.updateOne(
              { _id: order.notes.userId },
              { subscriptionStatus: 'past_due', razorpaySubscriptionStatus: 'past_due' }
            );
          }
        }

        logger.warn('Payment failed', { 
          paymentId: paymentEntity?.id 
        });
        break;
      }

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

    if (eventId) {
      await RazorpayWebhookEvent.updateOne(
        { eventId },
        {
          $set: {
            eventType,
            paymentId: event.payload?.payment?.entity?.id || null,
            orderId: event.payload?.payment?.entity?.order_id || null,
            status: 'processed',
            processedAt: new Date(),
            lastError: null,
          },
        }
      );
    }

    return res.status(200).json({ received: true });

  } catch (error) {
    const eventId = req.headers['x-razorpay-event-id'];
    if (eventId) {
      await RazorpayWebhookEvent.updateOne(
        { eventId },
        {
          $set: {
            status: 'failed',
            lastError: error.message,
            processedAt: new Date(),
          },
        }
      ).catch(() => undefined);
    }

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
  changePlan: async (req, res) => {
    try {
      const user = req.user;
      const { planId, billing = 'monthly' } = req.body;

      if (!planId || !getConfig().plans[planId]) {
        return res.status(400).json({
          success: false,
          error: `Invalid plan. Choose from: ${baseConfig.validPlans.join(', ')}`
        });
      }

      const decision = buildPlanChangeDecision(user, planId, billing);
      if (decision.action === 'noop') {
        return res.status(400).json({
          success: false,
          error: 'You are already on this plan.'
        });
      }

      if (decision.action === 'upgrade_now' || (!isPaidPlan(user.plan) && isPaidPlan(planId))) {
        return res.status(400).json({
          success: false,
          error: 'Upgrades require checkout so proration and payment can be verified safely.'
        });
      }

      user.cancelAtPeriodEnd = planId === 'free';
      user.scheduledPlan = planId;
      user.scheduledBillingInterval = planId === 'free' ? 'monthly' : billing;
      user.scheduledChangeReason = planId === 'free' ? 'cancel' : 'downgrade';
      await user.save();

      return res.status(200).json({
        success: true,
        message: planId === 'free'
          ? 'Cancellation scheduled for the end of the current billing period.'
          : `${(getConfig().plans[planId] || getConfig().plans.free).name} is queued as your next renewal choice while your current access stays active until period end.`,
        effectiveAt: user.subscriptionCurrentPeriodEnd,
        pendingChange: {
          planId,
          billing,
          reason: user.scheduledChangeReason,
          cancelAtPeriodEnd: user.cancelAtPeriodEnd,
        }
      });
    } catch (error) {
      logger.error('Failed to change plan', { error: error.message, userId: req.userId });
      return res.status(500).json({
        success: false,
        error: 'Failed to update billing plan'
      });
    }
  },
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
        currencySymbol: 'Rs.',
        discount: Math.round((pricing.prorationCreditPaise + pricing.promoDiscountPaise) / 100),
        discountLabel: [
          pricing.prorationCreditPaise > 0 ? 'Unused time and quota credit' : '',
          discountPercent > 0 ? `${discountPercent}% promo` : '',
        ].filter(Boolean).join(' + '),
        tax: 0,
        taxLabel: '',
        total: Math.round(finalPricePaise / 100),
        period: billing === 'yearly' ? 'year' : 'month',
        features: getConfig().plans[planType].features,
        chargeType: pricing.chargeType,
        pricingMode: pricing.pricingMode,
        prorationCredit: Math.round(pricing.prorationCreditPaise / 100),
        promoDiscount: Math.round(pricing.promoDiscountPaise / 100),
        fairUseRatio: Number(pricing.fairUseRatio || 1),
        effectiveAt: pricing.effectiveAt,
        billingPolicy: pricing.chargeType === 'upgrade_now'
          ? 'Upgrade charge is prorated using remaining time and remaining quota from your current cycle.'
          : 'This purchase starts a new billing cycle.',
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
      const invoices = await Invoice.find({ userId: req.user._id })
        .sort({ paidAt: -1, createdAt: -1 })
        .limit(25);

      return res.status(200).json({
        success: true,
        invoices: invoices.map((invoice) => ({
          id: invoice.invoiceNumber,
          orderId: invoice.orderId,
          paymentId: invoice.paymentId,
          date: new Date(invoice.paidAt || invoice.createdAt).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          }),
          amount: formatInvoiceAmount(invoice.totalAmountPaise, invoice.currency),
          status: invoice.status === 'paid' ? 'Paid' : invoice.status,
          downloadUrl: buildInvoiceDownloadUrl(req, invoice._id),
        }))
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
        price: userPlan.priceINR === 0 ? 'Rs. 0' : `Rs. ${userPlan.priceINR}`,
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
          price: p.priceINR === 0 ? 'Rs. 0' : `Rs. ${p.priceINR}`,
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
      const pendingChange = user.scheduledPlan
        ? {
            planId: user.scheduledPlan,
            planName: (getConfig().plans[user.scheduledPlan] || getConfig().plans.free).name,
            billingInterval: user.scheduledBillingInterval || 'monthly',
            reason: user.scheduledChangeReason || (user.cancelAtPeriodEnd ? 'cancel' : 'downgrade'),
            effectiveAt: user.subscriptionCurrentPeriodEnd,
            cancelAtPeriodEnd: !!user.cancelAtPeriodEnd,
          }
        : null;

      const invoices = await Invoice.find({ userId: user._id })
        .sort({ paidAt: -1, createdAt: -1 })
        .limit(10);

      return res.status(200).json({
        success: true,
        currentPlan,
        allPlans,
        nextBillingDate,
        billingInterval: user.billingInterval || 'monthly',
        subscriptionStatus: user.subscriptionStatus || (user.plan === 'free' ? 'active' : 'inactive'),
        cancelAtPeriodEnd: !!user.cancelAtPeriodEnd,
        pendingChange,
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
        invoices: invoices.map((invoice) => ({
          id: invoice.invoiceNumber,
          orderId: invoice.orderId,
          paymentId: invoice.paymentId,
          date: new Date(invoice.paidAt || invoice.createdAt).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          }),
          amount: formatInvoiceAmount(invoice.totalAmountPaise, invoice.currency),
          status: invoice.status === 'paid' ? 'Paid' : invoice.status,
          downloadUrl: buildInvoiceDownloadUrl(req, invoice._id),
        }))
      });
    } catch (error) {
      logger.error('Failed to get billing info', { error: error.message });
      return res.status(500).json({ success: false, error: 'Failed to get billing info' });
    }
  },

  downloadInvoice: async (req, res) => {
    try {
      const invoice = await Invoice.findOne({
        _id: req.params.id,
        userId: req.user._id,
      });

      if (!invoice) {
        return res.status(404).json({
          success: false,
          error: 'Invoice not found'
        });
      }

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${invoice.invoiceNumber}.html"`
      );

      return res.status(200).send(buildInvoiceHtml(invoice));
    } catch (error) {
      logger.error('Failed to download invoice', {
        error: error.message,
        invoiceId: req.params.id,
        userId: req.user?._id
      });
      return res.status(500).json({
        success: false,
        error: 'Failed to download invoice'
      });
    }
  }
};
