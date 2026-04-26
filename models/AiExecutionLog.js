const mongoose = require('mongoose');

const aiExecutionLogSchema = new mongoose.Schema(
  {
    taskType: {
      type: String,
      default: 'general',
      index: true,
    },
    provider: {
      type: String,
      enum: ['google', 'bedrock', 'nvidia'],
      required: true,
      index: true,
    },
    route: {
      type: String,
      default: 'google-flash',
    },
    model: {
      type: String,
      required: true,
      index: true,
    },
    keyIndex: {
      type: Number,
      default: null,
      index: true,
    },
    status: {
      type: String,
      enum: ['success', 'failed'],
      default: 'success',
      index: true,
    },
    promptTokens: {
      type: Number,
      default: 0,
    },
    completionTokens: {
      type: Number,
      default: 0,
    },
    totalTokens: {
      type: Number,
      default: 0,
    },
    durationMs: {
      type: Number,
      default: 0,
    },
    temperature: {
      type: Number,
      default: null,
    },
    maxOutputTokens: {
      type: Number,
      default: null,
    },
    error: {
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

aiExecutionLogSchema.index({ createdAt: -1 });
aiExecutionLogSchema.index({ provider: 1, createdAt: -1 });
aiExecutionLogSchema.index({ keyIndex: 1, createdAt: -1 });
aiExecutionLogSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('AiExecutionLog', aiExecutionLogSchema);
