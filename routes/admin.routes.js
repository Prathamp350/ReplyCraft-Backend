const express = require('express');
const router = express.Router();
const adminController = require('../controllers/admin.controller');
const { authenticate, authorizeRoles } = require('../middleware/auth.middleware');

// Apply authentication to all admin routes
router.use(authenticate);

// POST /api/admin/staff - Create staff (superadmin + admin with hierarchy)
router.post('/staff', authorizeRoles('superadmin', 'admin'), adminController.createStaff);

// GET /api/admin/staff - List staff accounts
router.get('/staff', authorizeRoles('superadmin', 'admin'), adminController.listStaff);

// DELETE /api/admin/staff/:id - Deactivate staff account
router.delete('/staff/:id', authorizeRoles('superadmin', 'admin'), adminController.deleteStaff);

module.exports = router;
