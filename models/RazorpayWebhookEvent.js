const mongoose = require('mongoose');

const razorpayWebhookEventSchema = new mongoose.Schema(
  {
    eventId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    eventType: {
      type: String,
      required: true,
      index: true,
    },
    paymentId: {
      type: String,
      default: null,
      index: true,
    },
    orderId: {
      type: String,
      default: null,
      index: true,
    },
    processedAt: {
      type: Date,
      default: Date.now,
    },
    status: {
      type: String,
      enum: ['processing', 'processed', 'failed'],
      default: 'processing',
      index: true,
    },
    lastError: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('RazorpayWebhookEvent', razorpayWebhookEventSchema);
