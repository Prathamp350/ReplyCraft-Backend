/**
 * Contact Controller
 * Handles contact form submissions and creates support tickets
 */

const Ticket = require('../models/Ticket');
const logger = require('../utils/logger');
const { queueEmail } = require('../queues/email.queue');

const subjectLabels = {
  general: 'General Inquiry',
  bug_report: 'Bug Report',
  feature_request: 'Feature Request',
  billing: 'Billing',
  account: 'Account'
};

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

/**
 * Public ticket status lookup.
 * Requires both ticketId and matching email so users can check their own ticket safely.
 */
const lookupTicket = async (req, res) => {
  try {
    const ticketId = String(req.body.ticketId || req.query.ticketId || '').trim().toUpperCase();
    const email = String(req.body.email || req.query.email || '').trim().toLowerCase();

    if (!ticketId || !email) {
      return res.status(400).json({
        success: false,
        error: 'Ticket ID and email are required'
      });
    }

    const emailRegex = /^\S+@\S+\.\S+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        error: 'Please provide a valid email address'
      });
    }

    const ticket = await Ticket.findOne({ ticketId, email })
      .populate('assignedTo', 'name role');

    if (!ticket) {
      return res.status(404).json({
        success: false,
        error: 'No ticket found for that ticket ID and email'
      });
    }

    return res.status(200).json({
      success: true,
      ticket: {
        ticketId: ticket.ticketId,
        email: ticket.email,
        name: ticket.name,
        subject: ticket.subject,
        subjectLabel: subjectLabels[ticket.subject] || 'General Inquiry',
        status: ticket.status,
        priority: ticket.priority,
        createdAt: ticket.createdAt,
        updatedAt: ticket.updatedAt,
        assignedTo: ticket.assignedTo
          ? {
              name: ticket.assignedTo.name,
              role: ticket.assignedTo.role
            }
          : null
      }
    });
  } catch (error) {
    logger.error('Ticket Lookup Error', { error: error.message, stack: error.stack });
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch ticket status'
    });
  }
};

module.exports = {
  submitContact,
  lookupTicket
};
