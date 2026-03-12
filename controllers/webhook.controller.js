/**
 * Stripe Webhook Handler
 * Processes Stripe events to update user subscriptions
 * Handles: checkout, subscription updates, cancellations, payment failures
 */

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const User = require('../models/User');
const logger = require('../utils/logger');

// Plan mapping from Stripe price to ReplyCraft plan
const PRICE_TO_PLAN = {
  [process.env.STRIPE_PRICE_GO || 'price_go']: 'go',
  [process.env.STRIPE_PRICE_PRO || 'price_pro']: 'pro',
  [process.env.STRIPE_PRICE_ULTRA || 'price_ultra']: 'ultra'
};

/**
 * Handle Stripe webhook
 */
const handleWebhook = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    // Verify webhook signature
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    logger.error('Stripe webhook signature verification failed', {
      error: err.message
    });
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object);
        break;

      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object);
        break;

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object);
        break;

      case 'invoice.payment_failed':
        await handlePaymentFailed(event.data.object);
        break;

      default:
        logger.info('Unhandled Stripe event type', { type: event.type });
    }
  } catch (error) {
    logger.error('Error processing webhook', {
      type: event.type,
      error: error.message
    });
  }

  // Return 200 to acknowledge receipt
  res.json({ received: true });
};

/**
 * Handle checkout session completed - new subscription
 */
async function handleCheckoutCompleted(session) {
  const { userId, plan } = session.metadata;

  if (!userId) {
    logger.error('Webhook: No userId in metadata', { sessionId: session.id });
    return;
  }

  try {
    // Get subscription details
    const subscription = await stripe.subscriptions.retrieve(session.subscription);
    const priceId = subscription.items.data[0].price.id;
    const planType = PRICE_TO_PLAN[priceId] || plan;

    // Update user plan
    const user = await User.findById(userId);

    if (!user) {
      logger.error('Webhook: User not found', { userId });
      return;
    }

    // Update user with plan and subscription info
    user.plan = planType;
    user.stripeCustomerId = session.customer;
    user.stripeSubscriptionId = subscription.id;
    user.subscriptionStatus = subscription.status;
    user.subscriptionCurrentPeriodEnd = new Date(subscription.current_period_end * 1000);
    user.planExpiresAt = new Date(subscription.current_period_end * 1000);

    await user.save();

    logger.logBilling('User plan upgraded via checkout', {
      userId: user._id,
      plan: planType,
      subscriptionId: subscription.id,
      status: subscription.status
    });

    // Emit event for frontend update if needed
    if (global.io) {
      global.io.to(userId).emit('plan_updated', { plan: planType });
    }

  } catch (error) {
    logger.error('Error handling checkout completed', {
      error: error.message,
      sessionId: session.id
    });
  }
}

/**
 * Handle subscription update - plan change or status change
 */
async function handleSubscriptionUpdated(subscription) {
  const user = await User.findOne({ stripeSubscriptionId: subscription.id });

  if (!user) {
    logger.warn('Subscription update: User not found', {
      subscriptionId: subscription.id
    });
    return;
  }

  // Check if plan changed
  const priceId = subscription.items.data[0].price.id;
  const newPlan = PRICE_TO_PLAN[priceId];

  // Update subscription status
  user.subscriptionStatus = subscription.status;
  user.subscriptionCurrentPeriodEnd = new Date(subscription.current_period_end * 1000);
  user.planExpiresAt = new Date(subscription.current_period_end * 1000);

  // Handle different subscription statuses
  if (subscription.status === 'active' || subscription.status === 'trialing') {
    // Active subscription - update plan if changed
    if (newPlan && newPlan !== user.plan) {
      user.plan = newPlan;
      logger.logBilling('Subscription plan changed', {
        userId: user._id,
        oldPlan: user.plan,
        newPlan: newPlan,
        status: subscription.status
      });
    }
  } else if (subscription.status === 'past_due' || subscription.status === 'unpaid') {
    // Payment issues - downgrade to free temporarily
    if (user.plan !== 'free') {
      logger.logBilling('Subscription payment failed, downgrading to free', {
        userId: user._id,
        previousPlan: user.plan,
        status: subscription.status
      });
      user.plan = 'free';
    }
  } else if (subscription.status === 'canceled') {
    // Subscription canceled - ensure free plan
    user.plan = 'free';
    user.stripeSubscriptionId = null;
    logger.logBilling('Subscription canceled', { userId: user._id });
  }

  await user.save();

  // Emit event for frontend update
  if (global.io) {
    global.io.to(user._id.toString()).emit('plan_updated', { 
      plan: user.plan,
      status: user.subscriptionStatus
    });
  }
}

/**
 * Handle subscription deleted (canceled)
 */
async function handleSubscriptionDeleted(subscription) {
  const user = await User.findOne({ stripeSubscriptionId: subscription.id });

  if (!user) {
    logger.warn('Subscription deletion: User not found', {
      subscriptionId: subscription.id
    });
    return;
  }

  // Downgrade to free plan
  user.plan = 'free';
  user.subscriptionStatus = 'canceled';
  user.stripeSubscriptionId = null;
  user.subscriptionCurrentPeriodEnd = null;
  user.planExpiresAt = null;

  await user.save();

  logger.logBilling('Subscription canceled, downgraded to free', {
    userId: user._id
  });

  // Emit event for frontend update
  if (global.io) {
    global.io.to(user._id.toString()).emit('plan_updated', { 
      plan: 'free',
      status: 'canceled'
    });
  }
}

/**
 * Handle failed payment
 */
async function handlePaymentFailed(invoice) {
  const user = await User.findOne({ stripeCustomerId: invoice.customer });

  if (!user) {
    logger.warn('Payment failed: User not found', {
      customerId: invoice.customer
    });
    return;
  }

  // Update subscription status
  user.subscriptionStatus = 'past_due';
  await user.save();

  logger.logBilling('Payment failed for user', {
    userId: user._id,
    invoiceId: invoice.id,
    amountDue: invoice.amount_due,
    status: 'past_due'
  });

  // Note: We don't immediately revoke access - Stripe handles this via subscription status
  // The user's plan will be downgraded on next subscription update or expiry check
}

/**
 * Sync all subscriptions on startup
 * Check for expired subscriptions and downgrade if needed
 */
const syncAllSubscriptions = async () => {
  try {
    const expiredUsers = await User.find({
      subscriptionCurrentPeriodEnd: { $lt: new Date() },
      plan: { $ne: 'free' }
    });

    for (const user of expiredUsers) {
      user.plan = 'free';
      user.subscriptionStatus = 'expired';
      user.stripeSubscriptionId = null;
      user.subscriptionCurrentPeriodEnd = null;
      user.planExpiresAt = null;
      await user.save();

      logger.logBilling('Expired subscription downgraded', { userId: user._id });
    }

    if (expiredUsers.length > 0) {
      logger.info(`Synced ${expiredUsers.length} expired subscriptions`);
    }

  } catch (error) {
    logger.error('Error syncing subscriptions', { error: error.message });
  }
};

module.exports = {
  handleWebhook,
  syncAllSubscriptions
};
