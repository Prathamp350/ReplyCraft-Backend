const Ticket = require('../models/Ticket');
const User = require('../models/User');
const logger = require('../utils/logger');

/**
 * Get tickets (paginated, filterable) — staff only
 */
const getTickets = async (req, res) => {
  try {
    const { status, priority, assignedTo, page = 1, limit = 20 } = req.query;

    const filter = {};
    if (status && status !== 'all') filter.status = status;
    if (priority) filter.priority = priority;
    if (assignedTo) filter.assignedTo = assignedTo;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [tickets, total] = await Promise.all([
      Ticket.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .populate('assignedTo', 'name email role')
        .populate('userId', 'name email'),
      Ticket.countDocuments(filter)
    ]);

    return res.status(200).json({
      success: true,
      tickets,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit))
    });
  } catch (error) {
    logger.error('Get Tickets Error', { error: error.message });
    return res.status(500).json({ success: false, error: 'Failed to fetch tickets' });
  }
};

/**
 * Get ticket stats for dashboard
 */
const getTicketStats = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [openCount, inProgressCount, resolvedToday, totalCount] = await Promise.all([
      Ticket.countDocuments({ status: 'open' }),
      Ticket.countDocuments({ status: 'in-progress' }),
      Ticket.countDocuments({ status: 'resolved', updatedAt: { $gte: today } }),
      Ticket.countDocuments()
    ]);

    // Count staff members
    const staffCount = await User.countDocuments({
      role: { $in: ['admin', 'support', 'finance', 'superadmin'] },
      isActive: true
    });

    return res.status(200).json({
      success: true,
      stats: {
        openTickets: openCount,
        inProgress: inProgressCount,
        resolvedToday,
        totalTickets: totalCount,
        staffCount
      }
    });
  } catch (error) {
    logger.error('Get Ticket Stats Error', { error: error.message });
    return res.status(500).json({ success: false, error: 'Failed to fetch stats' });
  }
};

/**
 * Get single ticket by ID
 */
const getTicketById = async (req, res) => {
  try {
    const ticket = await Ticket.findOne({ ticketId: req.params.ticketId })
      .populate('assignedTo', 'name email role')
      .populate('userId', 'name email avatarUrl')
      .populate('notes.author', 'name email role');

    if (!ticket) {
      return res.status(404).json({ success: false, error: 'Ticket not found' });
    }

    return res.status(200).json({ success: true, ticket });
  } catch (error) {
    logger.error('Get Ticket By ID Error', { error: error.message });
    return res.status(500).json({ success: false, error: 'Failed to fetch ticket' });
  }
};

/**
 * Update ticket status
 */
const updateTicketStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['open', 'in-progress', 'resolved', 'closed'];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, error: 'Invalid status' });
    }

    const ticket = await Ticket.findOne({ ticketId: req.params.ticketId });
    if (!ticket) {
      return res.status(404).json({ success: false, error: 'Ticket not found' });
    }

    ticket.status = status;
    await ticket.save();

    logger.info('Ticket status updated', { ticketId: ticket.ticketId, status, by: req.user.email });

    return res.status(200).json({ success: true, ticket });
  } catch (error) {
    logger.error('Update Ticket Status Error', { error: error.message });
    return res.status(500).json({ success: false, error: 'Failed to update ticket' });
  }
};

/**
 * Add internal note to ticket
 */
const addNote = async (req, res) => {
  try {
    const { content } = req.body;
    if (!content || !content.trim()) {
      return res.status(400).json({ success: false, error: 'Note content is required' });
    }

    const ticket = await Ticket.findOne({ ticketId: req.params.ticketId });
    if (!ticket) {
      return res.status(404).json({ success: false, error: 'Ticket not found' });
    }

    ticket.notes.push({
      author: req.user._id,
      authorName: req.user.name,
      content: content.trim()
    });
    await ticket.save();

    logger.info('Note added to ticket', { ticketId: ticket.ticketId, by: req.user.email });

    return res.status(200).json({ success: true, ticket });
  } catch (error) {
    logger.error('Add Note Error', { error: error.message });
    return res.status(500).json({ success: false, error: 'Failed to add note' });
  }
};

/**
 * Assign ticket to a staff member
 */
const assignTicket = async (req, res) => {
  try {
    const { staffId } = req.body;

    const ticket = await Ticket.findOne({ ticketId: req.params.ticketId });
    if (!ticket) {
      return res.status(404).json({ success: false, error: 'Ticket not found' });
    }

    if (staffId) {
      const staff = await User.findById(staffId);
      if (!staff || !['superadmin', 'admin', 'support'].includes(staff.role)) {
        return res.status(400).json({ success: false, error: 'Invalid staff member' });
      }
      ticket.assignedTo = staffId;
    } else {
      ticket.assignedTo = null;
    }

    if (ticket.status === 'open') {
      ticket.status = 'in-progress';
    }
    await ticket.save();

    logger.info('Ticket assigned', { ticketId: ticket.ticketId, assignedTo: staffId, by: req.user.email });

    return res.status(200).json({ success: true, ticket });
  } catch (error) {
    logger.error('Assign Ticket Error', { error: error.message });
    return res.status(500).json({ success: false, error: 'Failed to assign ticket' });
  }
};

module.exports = {
  getTickets,
  getTicketStats,
  getTicketById,
  updateTicketStatus,
  addNote,
  assignTicket
};
