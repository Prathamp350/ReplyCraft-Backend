const mongoose = require('mongoose');

// Auto-incrementing ticket counter
const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 1000 }
});
const Counter = mongoose.models.Counter || mongoose.model('Counter', counterSchema);

const ticketNoteSchema = new mongoose.Schema({
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  authorName: { type: String, required: true },
  content: { type: String, required: true, trim: true }
}, { timestamps: true });

const ticketSchema = new mongoose.Schema({
  ticketId: {
    type: String,
    unique: true,
    index: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    lowercase: true,
    trim: true
  },
  subject: {
    type: String,
    required: [true, 'Subject is required'],
    enum: ['general', 'bug_report', 'feature_request', 'billing', 'account'],
    default: 'general'
  },
  message: {
    type: String,
    required: [true, 'Message is required'],
    trim: true
  },
  status: {
    type: String,
    enum: ['open', 'in-progress', 'resolved', 'closed'],
    default: 'open'
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high'],
    default: 'medium'
  },
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  notes: [ticketNoteSchema]
}, {
  timestamps: true
});

// Auto-generate ticketId before saving
ticketSchema.pre('save', async function (next) {
  if (this.isNew && !this.ticketId) {
    try {
      const counter = await Counter.findByIdAndUpdate(
        'ticketId',
        { $inc: { seq: 1 } },
        { new: true, upsert: true }
      );
      this.ticketId = `RC-${counter.seq}`;
    } catch (err) {
      return next(err);
    }
  }
  next();
});

module.exports = mongoose.model('Ticket', ticketSchema);
