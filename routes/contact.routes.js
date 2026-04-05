/**
 * Contact Routes
 * Contact form submission
 */

const express = require('express');
const router = express.Router();
const { submitContact, lookupTicket } = require('../controllers/contact.controller');

// Public route - no auth required
router.post('/', submitContact);
router.post('/lookup', lookupTicket);

module.exports = router;
