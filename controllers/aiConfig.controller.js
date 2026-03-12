/**
 * AI Configuration Controller
 * Handles CRUD operations for AI reply configurations
 */

const AIConfiguration = require('../models/AIConfiguration');
const logger = require('../utils/logger');

/**
 * Get all configurations for user
 */
const getConfigurations = async (req, res) => {
  try {
    const configs = await AIConfiguration.find({ 
      userId: req.userId,
      isActive: true 
    }).sort({ isDefault: -1, createdAt: -1 });

    return res.status(200).json({
      success: true,
      configurations: configs
    });

  } catch (error) {
    logger.error('Get configurations error', { error: error.message, userId: req.userId });
    return res.status(500).json({
      success: false,
      error: 'Failed to get configurations'
    });
  }
};

/**
 * Get single configuration
 */
const getConfiguration = async (req, res) => {
  try {
    const { id } = req.params;
    
    const config = await AIConfiguration.findOne({
      _id: id,
      userId: req.userId,
      isActive: true
    });

    if (!config) {
      return res.status(404).json({
        success: false,
        error: 'Configuration not found'
      });
    }

    return res.status(200).json({
      success: true,
      configuration: config
    });

  } catch (error) {
    logger.error('Get configuration error', { error: error.message, userId: req.userId });
    return res.status(500).json({
      success: false,
      error: 'Failed to get configuration'
    });
  }
};

/**
 * Create new configuration
 */
const createConfiguration = async (req, res) => {
  try {
    const { 
      configName, 
      businessName, 
      brandTone, 
      emojiAllowed, 
      replyMode, 
      replyDelayMinutes,
      isDefault 
    } = req.body;

    // Validate required fields
    if (!configName) {
      return res.status(400).json({
        success: false,
        error: 'Configuration name is required'
      });
    }

    // Check if config name already exists
    const existing = await AIConfiguration.findOne({
      userId: req.userId,
      configName: configName.trim(),
      isActive: true
    });

    if (existing) {
      return res.status(400).json({
        success: false,
        error: 'Configuration name already exists'
      });
    }

    // If this is set as default, unset other defaults
    if (isDefault) {
      await AIConfiguration.updateMany(
        { userId: req.userId },
        { isDefault: false }
      );
    }

    // Create configuration
    const config = new AIConfiguration({
      userId: req.userId,
      configName: configName.trim(),
      businessName: businessName || '',
      brandTone: brandTone || 'professional',
      emojiAllowed: emojiAllowed !== false,
      replyMode: replyMode || 'manual',
      replyDelayMinutes: replyDelayMinutes || 0,
      isDefault: isDefault || false
    });

    await config.save();

    logger.info('AI configuration created', { 
      userId: req.userId, 
      configId: config._id,
      configName: config.configName 
    });

    return res.status(201).json({
      success: true,
      message: 'Configuration created successfully',
      configuration: config
    });

  } catch (error) {
    logger.error('Create configuration error', { error: error.message, userId: req.userId });
    return res.status(500).json({
      success: false,
      error: 'Failed to create configuration'
    });
  }
};

/**
 * Update configuration
 */
const updateConfiguration = async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      configName, 
      businessName, 
      brandTone, 
      emojiAllowed, 
      replyMode, 
      replyDelayMinutes,
      isDefault 
    } = req.body;

    const config = await AIConfiguration.findOne({
      _id: id,
      userId: req.userId,
      isActive: true
    });

    if (!config) {
      return res.status(404).json({
        success: false,
        error: 'Configuration not found'
      });
    }

    // Check if new name already exists
    if (configName && configName !== config.configName) {
      const existing = await AIConfiguration.findOne({
        userId: req.userId,
        configName: configName.trim(),
        isActive: true,
        _id: { $ne: id }
      });

      if (existing) {
        return res.status(400).json({
          success: false,
          error: 'Configuration name already exists'
        });
      }
    }

    // If this is set as default, unset other defaults
    if (isDefault && !config.isDefault) {
      await AIConfiguration.updateMany(
        { userId: req.userId, _id: { $ne: id } },
        { isDefault: false }
      );
    }

    // Update fields
    if (configName) config.configName = configName.trim();
    if (businessName !== undefined) config.businessName = businessName;
    if (brandTone) config.brandTone = brandTone;
    if (emojiAllowed !== undefined) config.emojiAllowed = emojiAllowed;
    if (replyMode) config.replyMode = replyMode;
    if (replyDelayMinutes !== undefined) config.replyDelayMinutes = replyDelayMinutes;
    if (isDefault !== undefined) config.isDefault = isDefault;

    await config.save();

    logger.info('AI configuration updated', { 
      userId: req.userId, 
      configId: config._id 
    });

    return res.status(200).json({
      success: true,
      message: 'Configuration updated successfully',
      configuration: config
    });

  } catch (error) {
    logger.error('Update configuration error', { error: error.message, userId: req.userId });
    return res.status(500).json({
      success: false,
      error: 'Failed to update configuration'
    });
  }
};

/**
 * Delete configuration (soft delete)
 */
const deleteConfiguration = async (req, res) => {
  try {
    const { id } = req.params;

    const config = await AIConfiguration.findOne({
      _id: id,
      userId: req.userId,
      isActive: true
    });

    if (!config) {
      return res.status(404).json({
        success: false,
        error: 'Configuration not found'
      });
    }

    // Soft delete
    config.isActive = false;
    await config.save();

    logger.info('AI configuration deleted', { 
      userId: req.userId, 
      configId: id 
    });

    return res.status(200).json({
      success: true,
      message: 'Configuration deleted successfully'
    });

  } catch (error) {
    logger.error('Delete configuration error', { error: error.message, userId: req.userId });
    return res.status(500).json({
      success: false,
      error: 'Failed to delete configuration'
    });
  }
};

/**
 * Set default configuration
 */
const setDefaultConfiguration = async (req, res) => {
  try {
    const { id } = req.params;

    const config = await AIConfiguration.findOne({
      _id: id,
      userId: req.userId,
      isActive: true
    });

    if (!config) {
      return res.status(404).json({
        success: false,
        error: 'Configuration not found'
      });
    }

    // Unset all defaults
    await AIConfiguration.updateMany(
      { userId: req.userId },
      { isDefault: false }
    );

    // Set this as default
    config.isDefault = true;
    await config.save();

    return res.status(200).json({
      success: true,
      message: 'Default configuration set',
      configuration: config
    });

  } catch (error) {
    logger.error('Set default error', { error: error.message, userId: req.userId });
    return res.status(500).json({
      success: false,
      error: 'Failed to set default configuration'
    });
  }
};

module.exports = {
  getConfigurations,
  getConfiguration,
  createConfiguration,
  updateConfiguration,
  deleteConfiguration,
  setDefaultConfiguration
};
