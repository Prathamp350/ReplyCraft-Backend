const express = require('express');
const router = express.Router();
const RestaurantProfile = require('../models/RestaurantProfile');
const User = require('../models/User');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');

// Configure multer storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = path.join(__dirname, '../uploads/avatars');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    // Requirements request: userId_timestamp.jpg (or whatever ext)
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `${req.userId}_${Date.now()}${ext}`);
  }
});
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only images are allowed'));
  }
});

/**
 * Get user's restaurant profile and core user data
 */
const getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    const profile = await RestaurantProfile.findOne({ 
      userId: req.userId,
      isActive: true 
    });

    // Return name directly from user object (not derived from email)
    // Include all user profile fields
    return res.status(200).json({
      success: true,
      // User profile data
      name: user ? user.name : '',
      email: user ? user.email : '',
      plan: user ? user.plan : 'free',
      createdAt: user ? user.createdAt : null,
      avatarUrl: user ? user.avatarUrl : null,
      phoneNumber: user ? user.phoneNumber : null,
      businessName: user ? user.businessName : null,
      timezone: user ? user.timezone : 'UTC',
      address: user ? user.address : null,
      city: user ? user.city : null,
      country: user ? user.country : null,
      dob: user ? user.dob : null,
      isOnboarded: user ? user.isOnboarded : false,
      // Restaurant profile (AI settings)
      profile: profile || null,
      restaurantName: profile?.restaurantName || '',
      brandTone: profile?.brandTone || 'professional',
      emojiAllowed: profile?.emojiAllowed ?? true,
      cuisineType: profile?.cuisineType || '',
      replyMode: profile?.replyMode || 'manual',
      replyDelayMinutes: profile?.replyDelayMinutes || 0
    });

  } catch (error) {
    logger.error('Get Profile Error', { error: error.message, userId: req.userId });
    return res.status(500).json({
      success: false,
      error: 'Failed to get profile'
    });
  }
};

/**
 * Create or update restaurant profile and user profile
 */
const saveProfile = async (req, res) => {
  try {
    const { 
      // User profile fields
      name, phoneNumber, businessName, timezone, address, city, country, dob,
      // Restaurant profile fields  
      restaurantName, brandTone, emojiAllowed, cuisineType, replyMode, replyDelayMinutes 
    } = req.body;

    // Update user profile fields if provided
    const user = await User.findById(req.userId);
    if (user) {
      if (name !== undefined) user.name = name.trim();
      if (phoneNumber !== undefined) user.phoneNumber = phoneNumber || null;
      if (businessName !== undefined) user.businessName = businessName || null;
      if (timezone !== undefined) user.timezone = timezone || 'UTC';
      if (address !== undefined) user.address = address || null;
      if (city !== undefined) user.city = city || null;
      if (country !== undefined) user.country = country || null;
      if (dob !== undefined) user.dob = dob || null;
      await user.save();
    }

    // We no longer require restaurant name for ReplyCraft since it's a general business tool

    // Validate brand tone
    const validTones = ['casual', 'professional', 'friendly'];
    if (brandTone && !validTones.includes(brandTone)) {
      return res.status(400).json({
        success: false,
        error: `Invalid brand tone. Allowed: ${validTones.join(', ')}`
      });
    }

    // Validate reply mode
    const validReplyModes = ['auto', 'manual'];
    if (replyMode && !validReplyModes.includes(replyMode)) {
      return res.status(400).json({
        success: false,
        error: `Invalid reply mode. Allowed: ${validReplyModes.join(', ')}`
      });
    }

    // Validate reply delay
    if (replyDelayMinutes !== undefined && (isNaN(replyDelayMinutes) || replyDelayMinutes < 0)) {
      return res.status(400).json({
        success: false,
        error: 'Reply delay must be a positive number'
      });
    }

    // Check if profile exists
    let profile = await RestaurantProfile.findOne({ userId: req.userId });

    if (profile) {
      // Update existing profile
      profile.restaurantName = restaurantName;
      if (brandTone) profile.brandTone = brandTone;
      if (emojiAllowed !== undefined) profile.emojiAllowed = emojiAllowed;
      if (cuisineType !== undefined) profile.cuisineType = cuisineType;
      if (replyMode) profile.replyMode = replyMode;
      if (replyDelayMinutes !== undefined) profile.replyDelayMinutes = replyDelayMinutes;
      
      await profile.save();
    } else {
      // Create new profile
      profile = new RestaurantProfile({
        userId: req.userId,
        restaurantName,
        brandTone: brandTone || 'professional',
        emojiAllowed: emojiAllowed || false,
        cuisineType: cuisineType || '',
        replyMode: replyMode || 'auto',
        replyDelayMinutes: replyDelayMinutes || 0
      });
      
      await profile.save();
    }

    logger.info('Profile saved', { userId: req.userId });

    return res.status(200).json({
      success: true,
      message: 'Profile saved successfully',
      name: user?.name,
      phoneNumber: user?.phoneNumber,
      businessName: user?.businessName,
      timezone: user?.timezone,
      restaurantName: profile.restaurantName,
      brandTone: profile.brandTone
    });

  } catch (error) {
    logger.error('Save Profile Error', { error: error.message, userId: req.userId });
    return res.status(500).json({
      success: false,
      error: 'Failed to save profile'
    });
  }
};

/**
 * Delete restaurant profile (soft delete)
 */
const deleteProfile = async (req, res) => {
  try {
    const profile = await RestaurantProfile.findOne({ 
      userId: req.userId,
      isActive: true 
    });

    if (!profile) {
      return res.status(404).json({
        success: false,
        error: 'Profile not found'
      });
    }

    // Soft delete
    profile.isActive = false;
    await profile.save();

    return res.status(200).json({
      success: true,
      message: 'Profile deleted successfully'
    });

  } catch (error) {
    console.error('Delete Profile Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to delete profile'
    });
  }
};

/**
 * Upload User Avatar
 */
const uploadAvatar = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No image provided' });
    }

    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    // Delete old avatar file if it exists
    if (user.avatarUrl) {
      try {
        // extract filename from URL (e.g., /uploads/avatars/123.jpg => 123.jpg)
        const oldFilename = user.avatarUrl.split('/').pop();
        if (oldFilename) {
          const oldPath = path.join(__dirname, '../uploads/avatars', oldFilename);
          if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
        }
      } catch (e) {
        console.error('Failed to delete old avatar:', e);
      }
    }

    // Save new avatar URL
    const newAvatarUrl = `/uploads/avatars/${req.file.filename}`;
    user.avatarUrl = newAvatarUrl;
    await user.save();

    logger.info('Avatar uploaded', { userId: req.userId, avatarUrl: newAvatarUrl });

    // Return full URL that frontend can use
    const baseUrl = process.env.FRONTEND_URL?.replace('/api', '') || 'http://localhost:3000';
    
    return res.status(200).json({
      success: true,
      message: 'Avatar uploaded successfully',
      avatarUrl: newAvatarUrl,
      fullAvatarUrl: `${baseUrl}${newAvatarUrl}`
    });

  } catch (error) {
    console.error('Upload Avatar Error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to upload avatar'
    });
  }
};

/**
 * Complete onboarding process
 */
const completeOnboarding = async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    user.isOnboarded = true;
    await user.save();

    return res.status(200).json({
      success: true,
      message: 'Onboarding completed successfully',
      isOnboarded: true
    });
  } catch (error) {
    logger.error('Complete Onboarding Error', { error: error.message, userId: req.userId });
    return res.status(500).json({
      success: false,
      error: 'Failed to complete onboarding'
    });
  }
};

// Apply auth middleware to all routes
const { authenticate } = require('../middleware/auth.middleware');
router.use(authenticate);

// Routes
router.get('/', getProfile);
router.post('/', saveProfile);
router.delete('/', deleteProfile);
router.post('/avatar', upload.single('avatar'), uploadAvatar);
router.post('/complete-onboarding', completeOnboarding);

module.exports = router;
