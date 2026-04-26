const express = require('express');
const router = express.Router();
const { askSupportAssistant } = require('../controllers/supportAssistant.controller');
const { publicSupportAiLimiter } = require('../middleware/rateLimiter');
const { requireTurnstile } = require('../middleware/turnstile.middleware');

router.post('/ask', publicSupportAiLimiter, requireTurnstile('support_ai'), askSupportAssistant);

module.exports = router;
