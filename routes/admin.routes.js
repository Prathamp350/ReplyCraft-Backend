const express = require('express');
const router = express.Router();
const adminController = require('../controllers/admin.controller');
const { authenticate, authorizeRoles } = require('../middleware/auth.middleware');

// Apply authentication and superadmin role requirement to all admin routes
router.use(authenticate);
router.use(authorizeRoles('superadmin'));

// POST /api/admin/staff - Create a new staff account (admin, finance, support)
router.post('/staff', adminController.createStaff);

module.exports = router;
