const mongoose = require('mongoose');

const aiConfigurationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  configName: {
    type: String,
    required: [true, 'Configuration name is required'],
    trim: true,
    maxlength: [100, 'Name cannot exceed 100 characters']
  },
  businessName: {
    type: String,
    trim: true,
    maxlength: [200, 'Business name cannot exceed 200 characters']
  },
  systemPrompt: {
    type: String,
    trim: true,
    maxlength: [5000, 'System prompt cannot exceed 5000 characters'],
    default: "You are a professional AI managing customer interactions for my business."
  },
  brandTone: {
    type: String,
    enum: ['professional', 'casual', 'friendly', 'formal'],
    default: 'professional'
  },
  emojiAllowed: {
    type: Boolean,
    default: true
  },
  replyMode: {
    type: String,
    enum: ['auto', 'manual'],
    default: 'manual'
  },
  replyDelayMinutes: {
    type: Number,
    default: 0,
    min: 0,
    max: 1440
  },
  isDefault: {
    type: Boolean,
    default: false
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Remove strict uniqueness wrapper so users can have multiple configurations per user. We still want unique per name per user.
aiConfigurationSchema.index({ userId: 1, configName: 1 }, { unique: true });
aiConfigurationSchema.index({ userId: 1, isDefault: 1 });

module.exports = mongoose.model('AIConfiguration', aiConfigurationSchema);
