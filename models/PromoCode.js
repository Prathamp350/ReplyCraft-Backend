const mongoose = require('mongoose');

const promoCodeSchema = new mongoose.Schema({
  code: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    trim: true,
    index: true,
  },
  discountPercent: {
    type: Number,
    required: true,
    min: 1,
    max: 100, // E.g., 50 for 50%, 100 for 100% free
  },
  applicablePlan: {
    type: String, // 'free', 'starter', 'pro', 'business', or 'all'
    required: true,
    default: 'all',
  },
  maxUses: {
    type: Number, // Number of users limit (e.g. 100)
    required: true,
  },
  currentUses: {
    type: Number,
    default: 0,
  },
  validUntil: {
    type: Date, // Expiration Date
    required: false,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  }
}, {
  timestamps: true
});

/**
 * Checks if the promo code is currently valid.
 */
promoCodeSchema.methods.isValid = function() {
  if (!this.isActive) return false;
  if (this.currentUses >= this.maxUses) return false;
  
  if (this.validUntil) {
    const now = new Date();
    if (now > this.validUntil) return false;
  }
  return true;
};

module.exports = mongoose.model('PromoCode', promoCodeSchema);
