const express = require('express');
const router = express.Router();
const ticketController = require('../controllers/ticket.controller');
const { authenticate, authorizeRoles } = require('../middleware/auth.middleware');

// All ticket routes require auth + staff role
router.use(authenticate);
router.use(authorizeRoles('superadmin', 'admin', 'support'));

// GET /api/tickets — List tickets (paginated, filterable)
router.get('/', ticketController.getTickets);

// GET /api/tickets/stats — Dashboard stats
router.get('/stats', ticketController.getTicketStats);

// GET /api/tickets/:ticketId — Single ticket detail
router.get('/:ticketId', ticketController.getTicketById);

// PUT /api/tickets/:ticketId/status — Update ticket status
router.put('/:ticketId/status', ticketController.updateTicketStatus);

// POST /api/tickets/:ticketId/notes — Add internal note
router.post('/:ticketId/notes', ticketController.addNote);

// PUT /api/tickets/:ticketId/assign — Assign ticket to staff
router.put('/:ticketId/assign', ticketController.assignTicket);

module.exports = router;
