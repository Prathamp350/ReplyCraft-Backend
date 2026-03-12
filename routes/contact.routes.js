/**
 * Contact Routes
 * Contact form submission
 */

const express = require('express');
const router = express.Router();
const { submitContact } = require('../controllers/contact.controller');

// Public route - no auth required
router.post('/', submitContact);

module.exports = router;
