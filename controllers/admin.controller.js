const User = require('../models/User');
const logger = require('../utils/logger');
const config = require('../config/config');

/**
 * Superadmin: Create a new staff account (admin, finance, support)
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
      isEmailVerified: true // Auto-verify internally created staff accounts
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

module.exports = {
  createStaff
};
