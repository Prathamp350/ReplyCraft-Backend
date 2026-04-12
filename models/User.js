const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { getConfig } = require('../services/configManager');
const baseConfig = require('../config/config');

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
    minlength: [8, 'Password must be at least 8 characters'],
    select: false
  },
  avatarUrl: {
    type: String,
    default: null
  },
  plan: {
    type: String,
    enum: baseConfig.validPlans,
    default: baseConfig.defaultPlan
  },
  monthlyUsage: {
    count: {
      type: Number,
      default: 0
    },
    lastReset: {
      type: Date,
      default: Date.now
    }
  },
  // Storage tracking
  storageUsedBytes: {
    type: Number,
    default: 0
  },
  // Extra storage purchased (in MB, on top of plan's included storage)
  extraStorageMB: {
    type: Number,
    default: 0
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
  razorpayOrderId: {
    type: String,
    default: null
  },
  razorpayPaymentId: {
    type: String,
    default: null
  },
  razorpaySubscriptionStatus: {
    type: String,
    default: null
  },
  appliedPromoCode: {
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
  lastSubscriptionReminderSentAt: {
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
    trim: true,
    maxlength: [30, 'Phone number cannot exceed 30 characters'],
    match: [/^\+?[0-9\s-]+$/, 'Invalid phone number format']
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
    trim: true,
    maxlength: [300, 'Address cannot exceed 300 characters']
  },
  city: {
    type: String,
    default: null,
    trim: true,
    maxlength: [100, 'City cannot exceed 100 characters']
  },
  state: {
    type: String,
    default: null,
    trim: true,
    maxlength: [100, 'State cannot exceed 100 characters']
  },
  country: {
    type: String,
    default: null,
    trim: true,
    maxlength: [100, 'Country cannot exceed 100 characters']
  },
  isOnboarded: {
    type: Boolean,
    default: false
  },
  notifications: {
    email: { type: Boolean, default: true },
    negativeAlerts: { type: Boolean, default: true }
  },
  role: {
    type: String,
    enum: ['user', 'support', 'finance', 'admin', 'superadmin'],
    default: 'user'
  },
  failedLoginAttempts: {
    type: Number,
    default: 0
  },
  lockUntil: {
    type: Date,
    default: null
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

// ---- Plan helpers ----

/**
 * Get this user's plan config from centralized config
 */
userSchema.methods.getPlanConfig = function() {
  const config = getConfig();
  return config.plans[this.plan] || config.plans.free;
};

/**
 * Check and reset monthly usage
 */
userSchema.methods.checkMonthlyLimit = function() {
  const now = new Date();
  const lastReset = new Date(this.monthlyUsage.lastReset);
  
  // Check if it's a new month
  if (now.getMonth() !== lastReset.getMonth() || now.getFullYear() !== lastReset.getFullYear()) {
    this.monthlyUsage.count = 0;
    this.monthlyUsage.lastReset = now;
  }
  
  const planConfig = this.getPlanConfig();
  const remaining = planConfig.monthlyLimit - this.monthlyUsage.count;
  
  return {
    used: this.monthlyUsage.count,
    limit: planConfig.monthlyLimit,
    remaining: Math.max(0, remaining),
    exceeded: this.monthlyUsage.count >= planConfig.monthlyLimit
  };
};

// Increment usage
userSchema.methods.incrementUsage = async function() {
  await this.checkMonthlyLimit();
  this.monthlyUsage.count += 1;
  await this.save();
};

// Reset monthly usage
userSchema.methods.resetMonthlyUsage = function() {
  this.monthlyUsage.count = 0;
  this.monthlyUsage.lastReset = new Date();
};

// ---- Storage helpers ----

/**
 * Get storage info for this user
 */
userSchema.methods.getStorageInfo = function() {
  const planConfig = this.getPlanConfig();
  const baseLimitMB = planConfig.storageMB;
  const totalLimitMB = baseLimitMB + (this.extraStorageMB || 0);
  const usedMB = Math.round((this.storageUsedBytes || 0) / (1024 * 1024) * 100) / 100;
  
  return {
    usedBytes: this.storageUsedBytes || 0,
    usedMB: usedMB,
    baseLimitMB: baseLimitMB,
    extraMB: this.extraStorageMB || 0,
    totalLimitMB: totalLimitMB,
    remainingMB: Math.max(0, totalLimitMB - usedMB),
    exceeded: usedMB >= totalLimitMB,
    canBuyExtra: planConfig.canBuyExtraStorage,
    percentUsed: totalLimitMB > 0 ? Math.min(100, Math.round((usedMB / totalLimitMB) * 100)) : 0
  };
};

/**
 * Add bytes to storage usage (call after generating/storing a reply)
 */
userSchema.methods.addStorageUsage = async function(bytes) {
  this.storageUsedBytes = (this.storageUsedBytes || 0) + bytes;
  await this.save();
};

// ---- Platform helpers ----

/**
 * Check if user can connect another platform
 */
userSchema.methods.getPlatformLimit = function() {
  const planConfig = this.getPlanConfig();
  return planConfig.platformLimit;
};

// ---- Subscription helpers ----

/**
 * Check and sync subscription status
 * Downgrade to free if subscription has expired
 */
userSchema.methods.syncSubscriptionStatus = async function() {
  const now = new Date();
  
  // Check if subscription has expired
  if (this.subscriptionCurrentPeriodEnd && this.subscriptionCurrentPeriodEnd < now) {
    if (this.plan !== 'free') {
      console.log(`[Subscription] Expiring subscription for user ${this._id}, downgrading to free`);
      
      this.plan = 'free';
      this.subscriptionStatus = 'expired';
      this.stripeSubscriptionId = null;
      // Reset extra storage on downgrade
      this.extraStorageMB = 0;
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
    if (this.plan !== 'free') {
      console.log(`[Subscription] Payment issue for user ${this._id}, downgrading to free`);
      
      this.plan = 'free';
      this.extraStorageMB = 0;
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
  const planConfig = this.getPlanConfig();
  
  return {
    plan: this.plan,
    status: this.subscriptionStatus || (this.plan === 'free' ? 'active' : 'inactive'),
    currentPeriodEnd: this.subscriptionCurrentPeriodEnd 
      ? Math.floor(this.subscriptionCurrentPeriodEnd.getTime() / 1000) 
      : null,
    monthlyLimit: planConfig.monthlyLimit,
    perMinute: planConfig.perMinute,
    platformLimit: planConfig.platformLimit === Infinity ? null : planConfig.platformLimit,
    storageMB: planConfig.storageMB,
    hasWatermark: planConfig.hasWatermark,
  };
};

module.exports = mongoose.model('User', userSchema);
