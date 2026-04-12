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

// --- Admin Subsystem ---
router.post('/promocodes', authorizeRoles('superadmin', 'admin'), adminController.createPromo);
router.get('/promocodes', authorizeRoles('superadmin', 'admin'), adminController.listPromos);
router.delete('/promocodes/:id', authorizeRoles('superadmin', 'admin'), adminController.deletePromo);

router.get('/plans', authorizeRoles('superadmin', 'admin'), adminController.getPlans);
router.put('/plans/:planId', authorizeRoles('superadmin', 'admin'), adminController.updatePlan);

router.get('/analytics/overview', authorizeRoles('superadmin', 'admin'), adminController.getAnalyticsOverview);
router.get('/analytics/god-mode', authorizeRoles('superadmin', 'admin'), adminController.getGodModeAnalytics);
router.get('/users', authorizeRoles('superadmin', 'admin', 'support'), adminController.getUsers);
router.get('/marketing/audience', authorizeRoles('superadmin', 'admin'), adminController.getMarketingAudience);
router.post('/marketing/send', authorizeRoles('superadmin', 'admin'), adminController.sendMarketingBroadcast);
router.patch('/users/:id/plan', authorizeRoles('superadmin', 'admin'), adminController.updateUserPlan);
router.delete('/users/:id', authorizeRoles('superadmin', 'admin'), adminController.deleteUser);
router.get('/stats/live', authorizeRoles('superadmin', 'admin'), adminController.getStats);

module.exports = router;
