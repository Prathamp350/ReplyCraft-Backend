/**
 * Contact Controller
 * Handles contact form submissions and creates support tickets
 */

const Ticket = require('../models/Ticket');
const logger = require('../utils/logger');
const { queueEmail } = require('../queues/email.queue');

/**
 * Submit contact form — creates a ticket and sends confirmation email
 */
const submitContact = async (req, res) => {
  try {
    const { name, email, company, message, subject } = req.body;

    if (!name || !email || !message) {
      return res.status(400).json({
        success: false,
        error: 'Name, email, and message are required'
      });
    }

    // Validate email
    const emailRegex = /^\S+@\S+\.\S+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        error: 'Please provide a valid email address'
      });
    }

    // Map subject to valid enum or default
    const validSubjects = ['general', 'bug_report', 'feature_request', 'billing', 'account'];
    const ticketSubject = validSubjects.includes(subject) ? subject : 'general';

    // Create ticket
    const ticket = new Ticket({
      name: name.trim(),
      email: email.toLowerCase(),
      subject: ticketSubject,
      message: message.trim(),
      status: 'open',
      priority: 'medium'
    });

    await ticket.save();

    logger.info('Support ticket created', { ticketId: ticket.ticketId, name, email, subject: ticketSubject });

    // Queue confirmation email
    const subjectLabels = {
      general: 'General Inquiry',
      bug_report: 'Bug Report',
      feature_request: 'Feature Request',
      billing: 'Billing',
      account: 'Account'
    };

    queueEmail('ticketConfirmation', {
      type: 'ticketConfirmation',
      to: email.toLowerCase(),
      name: name.trim(),
      ticketId: ticket.ticketId,
      subject: subjectLabels[ticketSubject] || 'General Inquiry',
      priority: 'Medium'
    }).catch(err => {
      logger.error('Failed to queue ticket confirmation email', { error: err.message, ticketId: ticket.ticketId });
    });

    return res.status(201).json({
      success: true,
      message: `Ticket ${ticket.ticketId} created successfully! We'll get back to you soon.`,
      ticketId: ticket.ticketId
    });

  } catch (error) {
    logger.error('Contact Form Error', { error: error.message, stack: error.stack });
    return res.status(500).json({
      success: false,
      error: 'Failed to submit contact form'
    });
  }
};

module.exports = {
  submitContact
};
