const express = require('express');
const router = express.Router();
const adminController = require('../controllers/admin.controller');
const aiOpsController = require('../controllers/aiOps.controller');
const { getAdminSystemHealth } = require('../controllers/health.controller');
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
router.get('/analytics/ops', authorizeRoles('superadmin', 'admin'), adminController.getOpsAuditDashboard);
router.get('/system/health', authorizeRoles('superadmin', 'admin'), getAdminSystemHealth);
router.get('/ui-config', authorizeRoles('superadmin', 'admin', 'support', 'finance'), adminController.getStaffUiConfig);
router.put('/ui-config', authorizeRoles('superadmin', 'admin'), adminController.updateStaffUiConfig);
router.get('/users', authorizeRoles('superadmin', 'admin', 'support'), adminController.getUsers);
router.get('/marketing/audience', authorizeRoles('superadmin', 'admin'), adminController.getMarketingAudience);
router.post('/marketing/send', authorizeRoles('superadmin', 'admin'), adminController.sendMarketingBroadcast);
router.get('/ai-ops/config', authorizeRoles('superadmin', 'admin'), aiOpsController.getConfig);
router.put('/ai-ops/config', authorizeRoles('superadmin', 'admin'), aiOpsController.updateConfig);
router.get('/ai-ops/health', authorizeRoles('superadmin', 'admin'), aiOpsController.getProviderHealth);
router.put('/ai-ops/google-keys/:index', authorizeRoles('superadmin', 'admin'), aiOpsController.updateGoogleKeyState);
router.post('/ai-ops/google-keys/refresh', authorizeRoles('superadmin', 'admin'), aiOpsController.refreshGoogleKeys);
router.post('/ai-ops/marketing/draft', authorizeRoles('superadmin', 'admin'), aiOpsController.generateMarketingDraft);
router.post('/ai-ops/finance/draft', authorizeRoles('superadmin', 'admin'), aiOpsController.generateFinanceDraft);
router.post('/ai-ops/support/:ticketId/draft', authorizeRoles('superadmin', 'admin', 'support'), aiOpsController.generateSupportDraft);
router.post('/ai-ops/support/:ticketId/send', authorizeRoles('superadmin', 'admin', 'support'), aiOpsController.sendSupportDraft);
router.put('/ai-ops/support/:ticketId/satisfaction', authorizeRoles('superadmin', 'admin', 'support'), aiOpsController.markTicketSatisfaction);
router.patch('/users/:id/plan', authorizeRoles('superadmin', 'admin'), adminController.updateUserPlan);
router.delete('/users/:id', authorizeRoles('superadmin', 'admin'), adminController.deleteUser);
router.get('/stats/live', authorizeRoles('superadmin', 'admin'), adminController.getStats);

module.exports = router;
