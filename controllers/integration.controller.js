/**
 * Integration Controller
 * Handles Google Business Profile connections
 */

const BusinessConnection = require('../models/BusinessConnection');
const User = require('../models/User');
const Review = require('../models/Review');
const platformManager = require('../integrations/platformManager');
const axios = require('axios');
const config = require('../config/config');
const logger = require('../utils/logger');

const AVAILABLE_PLATFORMS = [
  { id: 'google', platform: 'google', name: 'Google Business Profile', description: 'Connect your Google Business Profile to map real-time customer reviews.', logo: '/platforms/google.svg', category: 'reviews' },
  { id: 'yelp', platform: 'yelp', name: 'Yelp', description: 'Sync Yelp local reviews automatically and track restaurant ratings.', logo: '/platforms/yelp.svg', category: 'reviews' },
  { id: 'tripadvisor', platform: 'tripadvisor', name: 'TripAdvisor', description: 'Bring in your hotel or attraction reviews directly from TripAdvisor.', logo: '/platforms/tripadvisor.svg', category: 'reviews' },
  { id: 'appstore', platform: 'appstore', name: 'Apple App Store', description: 'Monitor iOS app reviews directly from the App Store.', logo: '/platforms/appstore.svg', category: 'app_store' },
  { id: 'playstore', platform: 'playstore', name: 'Google Play Store', description: 'Track Android app ratings and feedback globally.', logo: '/platforms/playstore.svg', category: 'app_store' }
];

/**
 * Connect Google Business Profile
 */
const connectGoogle = async (req, res) => {
  try {
    const { code, redirectUri } = req.body;
    const userId = req.userId;
    const user = req.user;

    // Check platform limit before allowing new connection
    const planConfig = user.getPlanConfig();
    if (planConfig.platformLimit !== Infinity) {
      const activeCount = await BusinessConnection.countDocuments({ userId, isActive: true });
      if (activeCount >= planConfig.platformLimit) {
        return res.status(403).json({
          success: false,
          error: `Your ${planConfig.name} plan supports up to ${planConfig.platformLimit} platform(s). Upgrade to connect more.`,
          code: 'PLATFORM_LIMIT_REACHED',
          connected: activeCount,
          limit: planConfig.platformLimit,
          upgradeUrl: '/dashboard/upgrade'
        });
      }
    }

    if (!code) {
      return res.status(400).json({
        success: false,
        error: 'Authorization code is required'
      });
    }

    // Exchange authorization code for tokens
    const tokenResponse = await axios.post('https://oauth2.googleapis.com/token', {
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri || process.env.GOOGLE_REDIRECT_URI,
      grant_type: 'authorization_code'
    });

    const { access_token, refresh_token, expires_in } = tokenResponse.data;

    // Get account info using the access token
    const accountResponse = await axios.get(
      'https://mybusiness.googleapis.com/v4/accounts',
      {
        headers: { Authorization: `Bearer ${access_token}` }
      }
    );

    const account = accountResponse.data.accounts?.[0];
    if (!account) {
      return res.status(400).json({
        success: false,
        error: 'No Google Business account found'
      });
    }

    // Get location info
    const locationResponse = await axios.get(
      `https://mybusiness.googleapis.com/v4/${account.name}/locations`,
      {
        headers: { Authorization: `Bearer ${access_token}` }
      }
    );

    const location = locationResponse.data.locationSummaries?.[0];

    // Check if connection already exists
    let connection = await BusinessConnection.findOne({
      userId,
      platform: 'google',
      locationId: location?.locationId
    });

    const tokenExpiry = new Date(Date.now() + expires_in * 1000);

    if (connection) {
      // Update existing connection
      connection.accessToken = access_token;
      connection.refreshToken = refresh_token;
      connection.tokenExpiry = tokenExpiry;
      connection.isActive = true;
      await connection.save();
    } else {
      // Create new connection
      connection = new BusinessConnection({
        userId,
        platform: 'google',
        accountId: account.accountId,
        locationId: location?.locationId || 'default',
        locationName: location?.locationName || 'My Business',
        accessToken,
        refreshToken,
        tokenExpiry,
        isActive: true
      });
      await connection.save();
    }

    logger.logReview('Google integration connected', {
      userId,
      locationId: connection.locationId,
      locationName: connection.locationName
    });

    return res.status(200).json({
      success: true,
      message: 'Google Business Profile connected successfully',
      connection: {
        id: connection._id,
        platform: connection.platform,
        locationName: connection.locationName,
        connectedAt: connection.createdAt
      }
    });

  } catch (error) {
    logger.error('Google connect error', {
      error: error.message,
      userId: req.userId
    });

    return res.status(500).json({
      success: false,
      error: 'Failed to connect Google account'
    });
  }
};

/**
 * List all integrations for user
 */
const listIntegrations = async (req, res) => {
  try {
    const connections = await BusinessConnection.find({
      userId: req.userId,
      isActive: true
    });

    const populatedIntegrations = await Promise.all(AVAILABLE_PLATFORMS.map(async (plat) => {
      const conn = connections.find(c => c.platform === plat.platform);
      
      let reviewCount = 0;
      let lastSyncAt = null;

      if (conn) {
        reviewCount = await Review.countDocuments({ connectionId: conn._id });
        lastSyncAt = conn.updatedAt;
      }

      return {
        ...plat,
        id: plat.platform, // ID must match the platform name for frontend toggling
        connected: !!conn,
        reviewCount,
        lastSyncAt,
        status: conn ? 'active' : 'idle'
      };
    }));

    return res.status(200).json({
      success: true,
      integrations: populatedIntegrations
    });
  } catch (error) {
    logger.error('List integrations error', {
      error: error.message,
      userId: req.userId
    });

    return res.status(500).json({
      success: false,
      error: 'Failed to list integrations'
    });
  }
};

/**
 * Toggle an integration connection
 */
const toggleIntegration = async (req, res) => {
  try {
    const { id } = req.params; // Using the platform name as the ID
    const { connect, businessEmail } = req.body;
    const userId = req.userId;
    const user = req.user;

    let connection = await BusinessConnection.findOne({ userId, platform: id });

    // Disconnect Flow
    if (!connect) {
      if (connection) {
        connection.isActive = false;
        await connection.save();
      }
      return res.status(200).json({ success: true, message: 'Disconnected successfully' });
    }

    // Check platform limit before connecting
    const planConfig = user.getPlanConfig();
    if (planConfig.platformLimit !== Infinity) {
      const activeCount = await BusinessConnection.countDocuments({ userId, isActive: true });
      // Only check if this would be a NEW active connection
      const wouldBeNew = !connection || !connection.isActive;
      if (wouldBeNew && activeCount >= planConfig.platformLimit) {
        return res.status(403).json({
          success: false,
          error: `Your ${planConfig.name} plan supports up to ${planConfig.platformLimit} platform(s). Upgrade to connect more.`,
          code: 'PLATFORM_LIMIT_REACHED',
          connected: activeCount,
          limit: planConfig.platformLimit,
          upgradeUrl: '/dashboard/upgrade'
        });
      }
    }

    // Connect Flow
    if (connection && connection.isActive) {
      return res.status(200).json({ success: true, connection });
    }

    if (connection && !connection.isActive) {
      connection.isActive = true;
      if (businessEmail) {
        connection.config = { ...connection.config, businessEmail };
      }
      await connection.save();
      return res.status(200).json({ success: true, connection });
    }

    // New Connection: Attempt auto-discovery
    const searchTerm = user.businessName || user.name || 'Business';
    const searchLocation = user.city || user.country || '';

    const adapter = platformManager.getAdapter(id);
    if (!adapter || typeof adapter.searchBusiness !== 'function') {
      return res.status(400).json({ success: false, error: 'Platform does not support auto-discovery' });
    }

    const businessMatch = await adapter.searchBusiness(searchTerm, searchLocation);

    if (!businessMatch) {
      return res.status(404).json({ success: false, error: 'Could not automatically locate your business on this platform' });
    }

    // Auto-connect
    connection = new BusinessConnection({
      userId,
      platform: id,
      locationId: businessMatch.locationId,
      locationName: businessMatch.locationName,
      isActive: true,
      config: businessEmail ? { businessEmail } : {}
    });
    
    await connection.save();

    return res.status(200).json({
      success: true,
      message: `${businessMatch.locationName} connected successfully!`
    });

  } catch (error) {
    logger.error('Toggle integration error', { error: error.message, userId: req.userId });
    return res.status(500).json({ success: false, error: 'Failed to toggle integration' });
  }
};

/**
 * Manually force a sync job immediately
 */
const syncIntegration = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.userId;

    const connection = await BusinessConnection.findOne({ userId, platform: id, isActive: true });
    
    if (!connection) {
      return res.status(404).json({ success: false, error: 'Connection not active' });
    }

    const adapter = platformManager.getAdapter(id);
    const rawReviews = await adapter.fetchReviews(connection);
    
    let newCount = 0;
    
    // Save to Database
    for (const raw of rawReviews) {
      const normalized = adapter.transformReview(raw);
      if (!normalized.platformReviewId) continue;
      
      const exists = await Review.findOne({ platform: id, platformReviewId: normalized.platformReviewId });
      if (!exists) {
        const nr = new Review({
          reviewId: `${id}_${normalized.platformReviewId}`,
          platform: id,
          platformReviewId: normalized.platformReviewId,
          platformLocationId: normalized.platformLocationId,
          externalReviewId: normalized.platformReviewId,
          userId,
          connectionId: connection._id,
          reviewText: normalized.text,
          rating: normalized.rating,
          author: normalized.author,
          authorPhotoUrl: normalized.authorPhotoUrl,
          replyStatus: 'pending',
          fetchedAt: new Date()
        });
        await nr.save();
        newCount++;
      }
    }

    connection.updatedAt = new Date();
    await connection.save();

    const reviewCount = await Review.countDocuments({ connectionId: connection._id });

    return res.status(200).json({
      success: true,
      reviewCount,
      lastSyncAt: connection.updatedAt
    });

  } catch (error) {
    logger.error('Sync error', { error: error.message, userId: req.userId });
    return res.status(500).json({ success: false, error: 'Failed to sync platform' });
  }
};

/**
 * Get single integration
 */
const getIntegration = async (req, res) => {
  try {
    const { id } = req.params;

    const connection = await BusinessConnection.findOne({
      _id: id,
      userId: req.userId
    });

    if (!connection) {
      return res.status(404).json({
        success: false,
        error: 'Integration not found'
      });
    }

    return res.status(200).json({
      success: true,
      integration: {
        id: connection._id,
        platform: connection.platform,
        locationName: connection.locationName,
        locationId: connection.locationId,
        connectedAt: connection.createdAt,
        status: connection.isActive ? 'active' : 'expired'
      }
    });

  } catch (error) {
    logger.error('Get integration error', {
      error: error.message,
      userId: req.userId
    });

    return res.status(500).json({
      success: false,
      error: 'Failed to get integration'
    });
  }
};

/**
 * Disconnect integration
 */
const disconnectIntegration = async (req, res) => {
  try {
    const { id } = req.params;

    const connection = await BusinessConnection.findOne({
      _id: id,
      userId: req.userId
    });

    if (!connection) {
      return res.status(404).json({
        success: false,
        error: 'Integration not found'
      });
    }

    // Soft delete - just mark as inactive
    connection.isActive = false;
    await connection.save();

    logger.logReview('Integration disconnected', {
      userId: req.userId,
      connectionId: id
    });

    return res.status(200).json({
      success: true,
      message: 'Integration disconnected successfully'
    });

  } catch (error) {
    logger.error('Disconnect error', {
      error: error.message,
      userId: req.userId
    });

    return res.status(500).json({
      success: false,
      error: 'Failed to disconnect integration'
    });
  }
};

/**
 * Refresh Google token
 */
const refreshGoogleToken = async (connection) => {
  try {
    const response = await axios.post('https://oauth2.googleapis.com/token', {
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: connection.refreshToken,
      grant_type: 'refresh_token'
    });

    const { access_token, expires_in } = response.data;

    connection.accessToken = access_token;
    connection.tokenExpiry = new Date(Date.now() + expires_in * 1000);
    await connection.save();

    return access_token;
  } catch (error) {
    logger.error('Token refresh failed', {
      error: error.message,
      connectionId: connection._id
    });

    // Mark as expired if refresh fails
    connection.isActive = false;
    await connection.save();

    throw error;
  }
};

/**
 * Get valid access token for a connection
 */
const getValidAccessToken = async (connection) => {
  // Check if token is expired
  if (connection.tokenExpiry && new Date() >= connection.tokenExpiry) {
    return await refreshGoogleToken(connection);
  }
  return connection.accessToken;
};

module.exports = {
  connectGoogle,
  listIntegrations,
  getIntegration,
  disconnectIntegration,
  getValidAccessToken,
  toggleIntegration,
  syncIntegration
};
