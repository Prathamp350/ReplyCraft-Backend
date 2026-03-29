const User = require('../models/User');
const logger = require('../utils/logger');
const { getConfig, refreshConfig } = require('../services/configManager');
const baseConfig = require('../config/config');
const SystemConfig = require('../models/SystemConfig');
const PromoCode = require('../models/PromoCode');

/**
 * Create a new staff account
 * Superadmin can create: admin, finance, support, superadmin
 * Admin can create: finance, support
 */
const createStaff = async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    if (!name || !email || !password || !role) {
      return res.status(400).json({
        success: false,
        error: 'Name, email, password, and role are required'
      });
    }

    const validRoles = ['support', 'finance', 'admin', 'superadmin'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({
        success: false,
        error: `Invalid role. Must be one of: ${validRoles.join(', ')}`
      });
    }

    // Hierarchy enforcement: admin can only create finance and support
    if (req.user.role === 'admin' && ['admin', 'superadmin'].includes(role)) {
      return res.status(403).json({
        success: false,
        error: 'Admins can only create finance and support accounts'
      });
    }

    let user = await User.findOne({ email: email.toLowerCase() });
    if (user) {
      return res.status(400).json({
        success: false,
        error: 'User with this email already exists'
      });
    }

    user = new User({
      name: name.trim(),
      email: email.toLowerCase(),
      password,
      role: role,
      plan: config.defaultPlan,
      isEmailVerified: true,
      isOnboarded: true
    });

    await user.save();
    logger.logAuth(`Staff account created by ${req.user.email}`, { newUserId: user._id, role: user.role });

    return res.status(201).json({
      success: true,
      message: 'Staff account created successfully',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });

  } catch (error) {
    logger.error('Create Staff Error', { error: error.message, stack: error.stack });
    return res.status(500).json({
      success: false,
      error: 'Failed to create staff account'
    });
  }
};

/**
 * List staff accounts
 * Superadmin sees all staff. Admin sees finance + support only.
 */
const listStaff = async (req, res) => {
  try {
    let roleFilter;
    if (req.user.role === 'superadmin') {
      roleFilter = ['support', 'finance', 'admin', 'superadmin'];
    } else {
      roleFilter = ['support', 'finance'];
    }

    const staff = await User.find({
      role: { $in: roleFilter }
    }).select('name email role isActive createdAt avatarUrl').sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      staff
    });
  } catch (error) {
    logger.error('List Staff Error', { error: error.message });
    return res.status(500).json({ success: false, error: 'Failed to list staff' });
  }
};

/**
 * Deactivate a staff account
 */
const deleteStaff = async (req, res) => {
  try {
    const staffUser = await User.findById(req.params.id);
    if (!staffUser) {
      return res.status(404).json({ success: false, error: 'Staff member not found' });
    }

    // Cannot deactivate yourself
    if (staffUser._id.toString() === req.user._id.toString()) {
      return res.status(400).json({ success: false, error: 'Cannot deactivate your own account' });
    }

    // Admin cannot deactivate admin or superadmin
    if (req.user.role === 'admin' && ['admin', 'superadmin'].includes(staffUser.role)) {
      return res.status(403).json({ success: false, error: 'Insufficient permissions' });
    }

    staffUser.isActive = false;
    await staffUser.save();

    logger.logAuth(`Staff account deactivated by ${req.user.email}`, { staffId: staffUser._id, role: staffUser.role });

    return res.status(200).json({
      success: true,
      message: 'Staff account deactivated'
    });
  } catch (error) {
    logger.error('Delete Staff Error', { error: error.message });
    return res.status(500).json({ success: false, error: 'Failed to deactivate staff' });
  }
};

module.exports = {
  createStaff,
  listStaff,
  deleteStaff,

  // --- Promo Codes ---
  createPromo: async (req, res) => {
    try {
      const { code, discountPercent, applicablePlan, maxUses, validUntil } = req.body;
      const promo = new PromoCode({
        code, discountPercent, applicablePlan, maxUses, validUntil, createdBy: req.userId
      });
      await promo.save();
      return res.status(201).json({ success: true, promo });
    } catch (error) {
      if (error.code === 11000) return res.status(400).json({ success: false, error: 'Promo code already exists' });
      return res.status(500).json({ success: false, error: 'Failed to create promo code' });
    }
  },

  listPromos: async (req, res) => {
    try {
      const promos = await PromoCode.find().populate('createdBy', 'name email').sort({ createdAt: -1 });
      return res.status(200).json({ success: true, promos });
    } catch (error) {
      return res.status(500).json({ success: false, error: 'Failed to fetch promos' });
    }
  },

  deletePromo: async (req, res) => {
    try {
      await PromoCode.findByIdAndDelete(req.params.id);
      return res.status(200).json({ success: true });
    } catch (error) {
      return res.status(500).json({ success: false, error: 'Failed to delete promo' });
    }
  },

  // --- Dynamic Plans ---
  getPlans: async (req, res) => {
    try {
      return res.status(200).json({ success: true, plans: getConfig().plans });
    } catch (error) {
      return res.status(500).json({ success: false, error: 'Failed to fetch planes' });
    }
  },

  updatePlan: async (req, res) => {
    try {
      const { planId } = req.params;
      const updates = req.body;
      
      const configDoc = await SystemConfig.findOne({ configId: 'global' });
      if (!configDoc) return res.status(404).json({ success: false, error: 'Config not found' });

      configDoc.plans[planId] = { ...configDoc.plans[planId], ...updates };
      configDoc.markModified(`plans.${planId}`);
      configDoc.updatedBy = req.userId;
      await configDoc.save();

      // IMPORTANT: refresh cache instantly across backend
      await refreshConfig();

      return res.status(200).json({ success: true, plan: configDoc.plans[planId] });
    } catch (error) {
      return res.status(500).json({ success: false, error: 'Failed to update plan' });
    }
  },

  // --- Live Users & Stats ---
  getUsers: async (req, res) => {
    try {
      // Return users with their exact plan, status, and precise storage metrics
      const users = await User.find({ role: { $ne: 'superadmin' } })
        .select('name email plan subscriptionStatus storageUsedBytes extraStorageMB createdAt appliedPromoCode')
        .sort({ createdAt: -1 });

      return res.status(200).json({ success: true, users });
    } catch (error) {
      return res.status(500).json({ success: false, error: 'Failed to fetch users' });
    }
  },

  getStats: async (req, res) => {
    try {
      const totalUsers = await User.countDocuments({ role: { $ne: 'superadmin' } });
      const freeUsers = await User.countDocuments({ plan: 'free' });
      const paidUsers = totalUsers - freeUsers;

      return res.status(200).json({ 
        success: true, 
        stats: { totalUsers, freeUsers, paidUsers }
      });
    } catch (error) {
      return res.status(500).json({ success: false, error: 'Failed to fetch live stats' });
    }
  }
};
