/**
 * AI Configuration Routes
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const {
  getConfigurations,
  getConfiguration,
  createConfiguration,
  updateConfiguration,
  deleteConfiguration,
  setDefaultConfiguration
} = require('../controllers/aiConfig.controller');

// All routes require authentication
router.get('/', authenticate, getConfigurations);
router.get('/:id', authenticate, getConfiguration);
router.post('/', authenticate, createConfiguration);
router.put('/:id', authenticate, updateConfiguration);
router.delete('/:id', authenticate, deleteConfiguration);
router.post('/:id/set-default', authenticate, setDefaultConfiguration);

module.exports = router;
