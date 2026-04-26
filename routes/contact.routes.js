/**
 * Contact Routes
 * Contact form submission
 */

const express = require('express');
const router = express.Router();
const { submitContact, lookupTicket } = require('../controllers/contact.controller');
const { requireTurnstile } = require('../middleware/turnstile.middleware');

// Public route - no auth required
router.post('/', requireTurnstile('contact'), submitContact);
router.post('/lookup', lookupTicket);

module.exports = router;
