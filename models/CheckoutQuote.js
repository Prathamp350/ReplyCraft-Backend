const mongoose = require('mongoose');

const checkoutQuoteSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    plan: {
      type: String,
      required: true,
    },
    billing: {
      type: String,
      enum: ['monthly', 'yearly'],
      default: 'monthly',
    },
    currency: {
      type: String,
      default: 'INR',
    },
    basePricePaise: {
      type: Number,
      required: true,
    },
    finalPricePaise: {
      type: Number,
      required: true,
    },
    discountPercent: {
      type: Number,
      default: 0,
    },
    prorationCreditPaise: {
      type: Number,
      default: 0,
    },
    promoDiscountPaise: {
      type: Number,
      default: 0,
    },
    pricingMode: {
      type: String,
      default: 'new_subscription',
    },
    chargeType: {
      type: String,
      default: 'pay_full',
    },
    currentPlan: {
      type: String,
      default: null,
    },
    promoCode: {
      type: String,
      default: null,
    },
    status: {
      type: String,
      enum: ['active', 'used', 'expired'],
      default: 'active',
      index: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
    razorpayOrderId: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

checkoutQuoteSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('CheckoutQuote', checkoutQuoteSchema);
