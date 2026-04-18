const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    email: {
      type: String,
      default: null,
      index: true,
    },
    eventType: {
      type: String,
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['success', 'failed', 'blocked', 'warning'],
      default: 'success',
      index: true,
    },
    riskLevel: {
      type: String,
      enum: ['low', 'medium', 'high'],
      default: 'low',
      index: true,
    },
    suspicious: {
      type: Boolean,
      default: false,
      index: true,
    },
    loginMethod: {
      type: String,
      enum: ['password', 'google', 'otp', 'system', null],
      default: null,
    },
    ipAddress: {
      type: String,
      default: null,
    },
    userAgent: {
      type: String,
      default: '',
    },
    reason: {
      type: String,
      default: '',
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ eventType: 1, createdAt: -1 });
auditLogSchema.index({ suspicious: 1, createdAt: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
