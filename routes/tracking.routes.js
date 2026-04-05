const express = require('express');
const router = express.Router();
const { trackEvent } = require('../controllers/tracking.controller');
const { attachUserIfPresent } = require('../middleware/auth.middleware');

router.post('/events', attachUserIfPresent, trackEvent);

module.exports = router;
