/**
 * Integration Routes
 * Platform connection management
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const {
  connectGoogle,
  listIntegrations,
  getIntegration,
  disconnectIntegration
} = require('../controllers/integration.controller');

// All routes require authentication
router.post('/google/connect', authenticate, connectGoogle);
router.get('/', authenticate, listIntegrations);
router.get('/:id', authenticate, getIntegration);
router.delete('/:id', authenticate, disconnectIntegration);

module.exports = router;
