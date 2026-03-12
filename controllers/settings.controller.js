/**
 * Settings Controller
 * Handles user and business settings
 */

const User = require('../models/User');
const RestaurantProfile = require('../models/RestaurantProfile');
const logger = require('../utils/logger');

/**
 * Get user settings (profile + restaurant settings)
 */
const getSettings = async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    const profile = await RestaurantProfile.findOne({ 
      userId: req.userId,
      isActive: true 
    });

    return res.status(200).json({
      success: true,
      businessName: user?.businessName || '',
      brandTone: profile?.brandTone || 'professional',
      replyLanguage: 'english',
      useEmojis: profile?.emojiAllowed ?? true,
      replyMode: profile?.replyMode || 'manual',
      replyDelay: profile?.replyDelayMinutes ? `${profile.replyDelayMinutes}m` : '0m',
      autoReply: profile?.replyMode === 'auto',
      emailNotifications: true,
      negativeAlerts: true
    });

  } catch (error) {
    logger.error('Get Settings Error', { error: error.message, userId: req.userId });
    return res.status(500).json({
      success: false,
      error: 'Failed to get settings'
    });
  }
};

/**
 * Update user settings
 */
const updateSettings = async (req, res) => {
  try {
    const { 
      businessName, brandTone, replyLanguage, useEmojis, 
      replyMode, replyDelay, autoReply 
    } = req.body;

    const user = await User.findById(req.userId);
    if (user && businessName !== undefined) {
      user.businessName = businessName || null;
      await user.save();
    }

    let profile = await RestaurantProfile.findOne({ 
      userId: req.userId,
      isActive: true 
    });

    if (!profile) {
      profile = new RestaurantProfile({
        userId: req.userId,
        restaurantName: businessName || 'My Restaurant'
      });
    }

    if (brandTone) profile.brandTone = brandTone;
    if (useEmojis !== undefined) profile.emojiAllowed = useEmojis;
    if (replyMode) profile.replyMode = replyMode === 'auto' ? 'auto' : 'manual';
    
    await profile.save();

    logger.info('Settings updated', { userId: req.userId });

    return res.status(200).json({
      success: true,
      message: 'Settings updated successfully'
    });

  } catch (error) {
    logger.error('Update Settings Error', { error: error.message, userId: req.userId });
    return res.status(500).json({
      success: false,
      error: 'Failed to update settings'
    });
  }
};

/**
 * Get notification preferences
 */
const getNotifications = async (req, res) => {
  try {
    // For now, return defaults
    // In a real app, store in user profile
    return res.status(200).json({
      success: true,
      emailNotifications: true,
      negativeAlerts: true
    });

  } catch (error) {
    logger.error('Get Notifications Error', { error: error.message });
    return res.status(500).json({
      success: false,
      error: 'Failed to get notifications'
    });
  }
};

/**
 * Update notification preferences
 */
const updateNotifications = async (req, res) => {
  try {
    const { emailNotifications, negativeAlerts } = req.body;

    // In a real app, save to user profile
    logger.info('Notification preferences updated', { 
      userId: req.userId,
      emailNotifications,
      negativeAlerts
    });

    return res.status(200).json({
      success: true,
      message: 'Notification preferences updated'
    });

  } catch (error) {
    logger.error('Update Notifications Error', { error: error.message });
    return res.status(500).json({
      success: false,
      error: 'Failed to update notifications'
    });
  }
};

/**
 * Change password
 */
const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        error: 'Current password and new password are required'
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'New password must be at least 6 characters'
      });
    }

    const user = await User.findById(req.userId).select('+password');
    
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Skip password check for Firebase users (no password)
    if (user.password) {
      const isMatch = await user.comparePassword(currentPassword);
      if (!isMatch) {
        return res.status(401).json({
          success: false,
          error: 'Current password is incorrect'
        });
      }
    }

    user.password = newPassword;
    await user.save();

    logger.info('Password changed', { userId: req.userId });

    return res.status(200).json({
      success: true,
      message: 'Password changed successfully'
    });

  } catch (error) {
    logger.error('Change Password Error', { error: error.message, userId: req.userId });
    return res.status(500).json({
      success: false,
      error: 'Failed to change password'
    });
  }
};

module.exports = {
  getSettings,
  updateSettings,
  getNotifications,
  updateNotifications,
  changePassword
};
