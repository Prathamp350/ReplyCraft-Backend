const express = require('express');
const router = express.Router();
const RestaurantProfile = require('../models/RestaurantProfile');
const User = require('../models/User');
const multer = require('multer');
const { S3Client, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const multerS3 = require('multer-s3');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');

// Initialize S3 Client
const s3 = new S3Client({
  region: process.env.AWS_REGION || 'eu-north-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  }
});

// Configure multer-s3 storage
const upload = multer({
  storage: multerS3({
    s3: s3,
    bucket: process.env.AWS_S3_BUCKET_NAME || 'replycraft-profile-images',
    contentType: multerS3.AUTO_CONTENT_TYPE,
    metadata: function (req, file, cb) {
      cb(null, { fieldName: file.fieldname });
    },
    key: function (req, file, cb) {
      // Save it inside the requested "profile-images" folder
      const ext = path.extname(file.originalname) || '.jpg';
      cb(null, `profile-images/${req.userId}_${Date.now()}${ext}`);
    }
  }),
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
      state: user ? user.state : null,
      country: user ? user.country : null,
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
      name, phoneNumber, businessName, timezone, address, city, state, country,
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
      if (state !== undefined) user.state = state || null;
      if (country !== undefined) user.country = country || null;
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
 * Upload User Avatar to S3
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

    // Delete old avatar from S3 if it exists
    if (user.avatarUrl && user.avatarUrl.includes('.amazonaws.com')) {
      try {
        // Extract the original S3 Key from the URL
        const urlObj = new URL(user.avatarUrl);
        // pathname starts with '/', e.g. "/profile-images/xyz.jpg"
        const objectKey = urlObj.pathname.startsWith('/') ? urlObj.pathname.slice(1) : urlObj.pathname;
        
        await s3.send(new DeleteObjectCommand({
          Bucket: process.env.AWS_S3_BUCKET_NAME || 'replycraft-profile-images',
          Key: objectKey,
        }));
        logger.info('Deleted old avatar from S3', { key: objectKey });
      } catch (e) {
        logger.error('Failed to delete old avatar from S3', { error: e.message });
      }
    }

    // Save new permanent S3 URL provided by multer-s3
    const newAvatarUrl = req.file.location;
    user.avatarUrl = newAvatarUrl;
    await user.save();

    logger.info('Avatar uploaded to S3', { userId: req.userId, avatarUrl: newAvatarUrl });

    return res.status(200).json({
      success: true,
      message: 'Avatar uploaded successfully',
      avatarUrl: newAvatarUrl, // It's an absolute URL directly from S3 now
      fullAvatarUrl: newAvatarUrl 
    });

  } catch (error) {
    logger.error('Upload Avatar Error', { error: error.message });
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

/**
 * Delete User Avatar from S3
 */
const deleteAvatar = async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    if (user.avatarUrl && user.avatarUrl.includes('.amazonaws.com')) {
      try {
        // Extract the original S3 Key from the URL
        const urlObj = new URL(user.avatarUrl);
        const objectKey = urlObj.pathname.startsWith('/') ? urlObj.pathname.slice(1) : urlObj.pathname;

        await s3.send(new DeleteObjectCommand({
          Bucket: process.env.AWS_S3_BUCKET_NAME || 'replycraft-profile-images',
          Key: objectKey,
        }));
        logger.info('Deleted avatar manually from S3', { key: objectKey });
      } catch (e) {
        logger.error('Failed to delete avatar from S3', { error: e.message });
      }
      
      // Remove URL from database
      user.avatarUrl = null;
      await user.save();
    }

    return res.status(200).json({
      success: true,
      message: 'Avatar removed successfully'
    });

  } catch (error) {
    logger.error('Delete Avatar Error', { error: error.message });
    return res.status(500).json({
      success: false,
      error: 'Failed to delete avatar'
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
router.delete('/avatar', deleteAvatar);
router.post('/complete-onboarding', completeOnboarding);

module.exports = router;
