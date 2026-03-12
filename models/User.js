const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const config = require('../config/config');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true,
    maxlength: [100, 'Name cannot exceed 100 characters']
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email']
  },
  // Google OAuth UID
  googleId: {
    type: String,
    unique: true,
    sparse: true
  },
  isEmailVerified: {
    type: Boolean,
    default: false
  },
  otp: {
    type: String,
    default: null
  },
  otpExpiresAt: {
    type: Date,
    default: null
  },
  password: {
    type: String,
    minlength: [6, 'Password must be at least 6 characters'],
    select: false
  },
  avatarUrl: {
    type: String,
    default: null
  },
  plan: {
    type: String,
    enum: config.validPlans,
    default: config.defaultPlan
  },
  dailyUsage: {
    count: {
      type: Number,
      default: 0
    },
    lastReset: {
      type: Date,
      default: Date.now
    }
  },
  isActive: {
    type: Boolean,
    default: true
  },
  // Stripe integration fields
  stripeCustomerId: {
    type: String,
    default: null
  },
  stripeSubscriptionId: {
    type: String,
    default: null
  },
  subscriptionStatus: {
    type: String,
    default: null,
    enum: [null, 'active', 'trialing', 'past_due', 'canceled', 'unpaid']
  },
  subscriptionCurrentPeriodEnd: {
    type: Date,
    default: null
  },
  planExpiresAt: {
    type: Date,
    default: null
  },
  // Additional profile fields
  phoneNumber: {
    type: String,
    default: null,
    trim: true
  },
  businessName: {
    type: String,
    default: null,
    trim: true,
    maxlength: [200, 'Business name cannot exceed 200 characters']
  },
  timezone: {
    type: String,
    default: 'UTC'
  },
  address: {
    type: String,
    default: null,
    trim: true
  },
  city: {
    type: String,
    default: null,
    trim: true
  },
  country: {
    type: String,
    default: null,
    trim: true
  },
  dob: {
    type: Date,
    default: null
  },
  isOnboarded: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password') || !this.password) {
    return next();
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Compare password method
userSchema.methods.comparePassword = async function(candidatePassword) {
  if (!this.password || !candidatePassword) return false;
  return await bcrypt.compare(candidatePassword, this.password);
};

// Check and reset daily usage
userSchema.methods.checkDailyLimit = function() {
  const now = new Date();
  const lastReset = new Date(this.dailyUsage.lastReset);
  
  // Check if it's a new day (midnight)
  if (now.toDateString() !== lastReset.toDateString()) {
    this.dailyUsage.count = 0;
    this.dailyUsage.lastReset = now;
  }
  
  const planLimits = config.plans[this.plan] || config.plans.free;
  const remaining = planLimits.dailyLimit - this.dailyUsage.count;
  
  return {
    used: this.dailyUsage.count,
    limit: planLimits.dailyLimit,
    remaining: Math.max(0, remaining),
    exceeded: this.dailyUsage.count >= planLimits.dailyLimit
  };
};

// Increment usage
userSchema.methods.incrementUsage = async function() {
  await this.checkDailyLimit();
  this.dailyUsage.count += 1;
  await this.save();
};

// Reset daily usage
userSchema.methods.resetDailyUsage = function() {
  this.dailyUsage.count = 0;
  this.dailyUsage.lastReset = new Date();
};

/**
 * Check and sync subscription status
 * Downgrade to free if subscription has expired
 */
userSchema.methods.syncSubscriptionStatus = async function() {
  const now = new Date();
  
  // Check if subscription has expired
  if (this.subscriptionCurrentPeriodEnd && this.subscriptionCurrentPeriodEnd < now) {
    // Subscription has expired
    if (this.plan !== 'free') {
      console.log(`[Subscription] Expiring subscription for user ${this._id}, downgrading to free`);
      
      this.plan = 'free';
      this.subscriptionStatus = 'expired';
      this.stripeSubscriptionId = null;
      await this.save();
      
      return {
        downgraded: true,
        reason: 'subscription_expired',
        newPlan: 'free'
      };
    }
  }
  
  // Check if subscription is inactive due to payment failure
  if (this.subscriptionStatus === 'past_due' || this.subscriptionStatus === 'unpaid') {
    // Downgrade to free until payment is resolved
    if (this.plan !== 'free') {
      console.log(`[Subscription] Payment issue for user ${this._id}, downgrading to free`);
      
      this.plan = 'free';
      await this.save();
      
      return {
        downgraded: true,
        reason: 'payment_failed',
        newPlan: 'free'
      };
    }
  }
  
  return {
    downgraded: false,
    reason: null,
    newPlan: this.plan
  };
};

/**
 * Get subscription info for API response
 */
userSchema.methods.getSubscriptionInfo = function() {
  const planConfig = config.plans[this.plan] || config.plans.free;
  
  return {
    plan: this.plan,
    status: this.subscriptionStatus || (this.plan === 'free' ? 'active' : 'inactive'),
    currentPeriodEnd: this.subscriptionCurrentPeriodEnd 
      ? Math.floor(this.subscriptionCurrentPeriodEnd.getTime() / 1000) 
      : null,
    dailyLimit: planConfig.dailyLimit,
    perMinute: planConfig.perMinute
  };
};

module.exports = mongoose.model('User', userSchema);
