/**
 * Integration Controller
 * Handles platform connection, sync, and multi-location Google onboarding
 */

const axios = require('axios');
const mongoose = require('mongoose');
const BusinessConnection = require('../models/BusinessConnection');
const Review = require('../models/Review');
const platformManager = require('../integrations/platformManager');
const logger = require('../utils/logger');
const { queueReplyGeneration } = require('../queues/reply.queue');

const AVAILABLE_PLATFORMS = [
  { id: 'google', platform: 'google', name: 'Google Business Profile', description: 'Connect your Google Business Profile to sync reviews from every location under the account.', logo: '/platforms/google.svg', category: 'reviews' },
  { id: 'yelp', platform: 'yelp', name: 'Yelp', description: 'Sync Yelp local reviews automatically and track restaurant ratings.', logo: '/platforms/yelp.svg', category: 'reviews' },
  { id: 'tripadvisor', platform: 'tripadvisor', name: 'TripAdvisor', description: 'Bring in your hotel or attraction reviews directly from TripAdvisor.', logo: '/platforms/tripadvisor.svg', category: 'reviews' },
  { id: 'appstore', platform: 'appstore', name: 'Apple App Store', description: 'Monitor iOS app reviews directly from the App Store.', logo: '/platforms/appstore.svg', category: 'app_store' },
  { id: 'playstore', platform: 'playstore', name: 'Google Play Store', description: 'Track Android app ratings and feedback globally.', logo: '/platforms/playstore.svg', category: 'app_store' }
];

const inferSentiment = (rating) => {
  if (rating >= 4) return 'positive';
  if (rating <= 2) return 'negative';
  return 'neutral';
};

const ensurePlatformLimit = async (user, userId) => {
  const planConfig = user.getPlanConfig();
  if (planConfig.platformLimit === Infinity) {
    return null;
  }

  const activePlatforms = await BusinessConnection.distinct('platform', { userId, isActive: true });
  if (activePlatforms.length >= planConfig.platformLimit) {
    return {
      success: false,
      error: `Your ${planConfig.name} plan supports up to ${planConfig.platformLimit} platform(s). Upgrade to connect more.`,
      code: 'PLATFORM_LIMIT_REACHED',
      connected: activePlatforms.length,
      limit: planConfig.platformLimit,
      upgradeUrl: '/dashboard/upgrade'
    };
  }

  return null;
};

const getGoogleLocations = async (accessToken) => {
  const accountsResponse = await axios.get(
    'https://mybusinessaccountmanagement.googleapis.com/v1/accounts',
    {
      headers: { Authorization: `Bearer ${accessToken}` }
    }
  );

  const accounts = accountsResponse.data.accounts || [];
  const locations = [];

  for (const account of accounts) {
    let pageToken = null;

    do {
      const locationsResponse = await axios.get(
        `https://mybusiness.googleapis.com/v4/${account.name}/locations`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          params: {
            pageSize: 100,
            ...(pageToken ? { pageToken } : {})
          }
        }
      );

      const batch = locationsResponse.data.locations || locationsResponse.data.locationSummaries || [];

      for (const location of batch) {
        const locationId = location.name?.split('/').pop() || location.locationKey?.placeId;
        if (!locationId) continue;

        locations.push({
          accountId: account.name?.split('/').pop() || account.accountId || account.accountNumber,
          locationId,
          locationName:
            location.locationName ||
            location.title ||
            location.storefrontAddress?.addressLines?.[0] ||
            'Business Location',
        });
      }

      pageToken = locationsResponse.data.nextPageToken || null;
    } while (pageToken);
  }

  return locations;
};

const connectGoogle = async (req, res) => {
  try {
    const { code, redirectUri, aiConfigurationId, businessEmail } = req.body;
    const userId = req.userId;
    const user = req.user;

    const platformLimitError = await ensurePlatformLimit(user, userId);
    if (platformLimitError) {
      return res.status(403).json(platformLimitError);
    }

    if (!code) {
      return res.status(400).json({
        success: false,
        error: 'Authorization code is required'
      });
    }

    const tokenResponse = await axios.post('https://oauth2.googleapis.com/token', {
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri || process.env.GOOGLE_REDIRECT_URI,
      grant_type: 'authorization_code'
    });

    const { access_token, refresh_token, expires_in } = tokenResponse.data;
    const locations = await getGoogleLocations(access_token);

    if (!locations.length) {
      return res.status(400).json({
        success: false,
        error: 'No Google Business locations found for this account'
      });
    }

    const tokenExpiry = new Date(Date.now() + expires_in * 1000);
    const savedConnections = [];

    for (const location of locations) {
      let connection = await BusinessConnection.findOne({
        userId,
        platform: 'google',
        locationId: location.locationId
      });

      if (!connection) {
        connection = new BusinessConnection({
          userId,
          platform: 'google',
          accountId: location.accountId,
          locationId: location.locationId,
          locationName: location.locationName
        });
      }

      connection.accountId = location.accountId;
      connection.locationName = location.locationName;
      connection.accessToken = access_token;
      connection.refreshToken = refresh_token || connection.refreshToken;
      connection.tokenExpiry = tokenExpiry;
      connection.aiConfigurationId = aiConfigurationId || connection.aiConfigurationId || null;
      connection.config = {
        ...(connection.config || {}),
        ...(businessEmail ? { businessEmail } : {})
      };
      connection.isActive = true;
      connection.status = 'active';
      await connection.save();
      savedConnections.push(connection);
    }

    logger.logReview('Google integration connected', {
      userId,
      locationCount: savedConnections.length
    });

    return res.status(200).json({
      success: true,
      message: 'Google Business Profile connected successfully',
      locationCount: savedConnections.length,
      connections: savedConnections.map((connection) => ({
        id: connection._id,
        platform: connection.platform,
        locationName: connection.locationName,
        connectedAt: connection.createdAt
      }))
    });
  } catch (error) {
    logger.error('Google connect error', {
      error: error.message,
      details: error.response?.data,
      userId: req.userId
    });

    return res.status(500).json({
      success: false,
      error: error.response?.data?.error_description || error.response?.data?.error || 'Failed to connect Google account'
    });
  }
};

const listIntegrations = async (req, res) => {
  try {
    const connections = await BusinessConnection.find({
      userId: req.userId,
      isActive: true
    });

    const populatedIntegrations = await Promise.all(AVAILABLE_PLATFORMS.map(async (platform) => {
      const platformConnections = connections.filter((connection) => connection.platform === platform.platform);
      const connectionIds = platformConnections.map((connection) => connection._id);

      const reviewCount = connectionIds.length
        ? await Review.countDocuments({ connectionId: { $in: connectionIds } })
        : 0;

      const lastSyncAt = platformConnections.length
        ? platformConnections
            .map((connection) => connection.updatedAt)
            .sort((a, b) => new Date(b) - new Date(a))[0]
        : null;

      return {
        ...platform,
        id: platform.platform,
        connected: platformConnections.length > 0,
        reviewCount,
        lastSyncAt,
        status: platformConnections.length ? 'active' : 'idle',
        connectionCount: platformConnections.length,
        locations: platformConnections.map((connection) => ({
          id: connection._id,
          locationId: connection.locationId,
          locationName: connection.locationName,
          aiConfigurationId: connection.aiConfigurationId || null,
          lastSyncAt: connection.updatedAt
        }))
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

const toggleIntegration = async (req, res) => {
  try {
    const { id } = req.params;
    const { connect, businessEmail, aiConfigurationId } = req.body;
    const userId = req.userId;
    const user = req.user;

    let connection = await BusinessConnection.findOne({ userId, platform: id });

    if (!connect) {
      if (connection) {
        connection.isActive = false;
        await connection.save();
      }
      return res.status(200).json({ success: true, message: 'Disconnected successfully' });
    }

    const planConfig = user.getPlanConfig();
    if (planConfig.platformLimit !== Infinity) {
      const activePlatforms = await BusinessConnection.distinct('platform', { userId, isActive: true });
      const wouldBeNew = !connection || !connection.isActive;
      const isNewPlatform = wouldBeNew && !activePlatforms.includes(id);
      if (isNewPlatform && activePlatforms.length >= planConfig.platformLimit) {
        return res.status(403).json({
          success: false,
          error: `Your ${planConfig.name} plan supports up to ${planConfig.platformLimit} platform(s). Upgrade to connect more.`,
          code: 'PLATFORM_LIMIT_REACHED',
          connected: activePlatforms.length,
          limit: planConfig.platformLimit,
          upgradeUrl: '/dashboard/upgrade'
        });
      }
    }

    if (connection && connection.isActive) {
      return res.status(200).json({ success: true, connection });
    }

    if (connection && !connection.isActive) {
      connection.isActive = true;
      if (businessEmail) {
        connection.config = { ...connection.config, businessEmail };
      }
      if (aiConfigurationId !== undefined) {
        connection.aiConfigurationId = aiConfigurationId || null;
      }
      await connection.save();
      return res.status(200).json({ success: true, connection });
    }

    if (id === 'google') {
      return res.status(400).json({
        success: false,
        error: 'Google Business Profile must be connected with Google OAuth.',
        code: 'GOOGLE_OAUTH_REQUIRED'
      });
    }

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

    connection = new BusinessConnection({
      userId,
      platform: id,
      locationId: businessMatch.locationId,
      locationName: businessMatch.locationName,
      isActive: true,
      aiConfigurationId: aiConfigurationId || null,
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

const syncIntegration = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.userId;

    const connections = await BusinessConnection.find({ userId, platform: id, isActive: true });
    if (!connections.length) {
      return res.status(404).json({ success: false, error: 'Connection not active' });
    }

    const adapter = platformManager.getAdapter(id);
    let newCount = 0;
    let totalReviews = 0;

    for (const connection of connections) {
      const rawReviews = await adapter.fetchReviews(connection);

      for (const raw of rawReviews) {
        const normalized = adapter.transformReview(raw);
        if (!normalized.platformReviewId) continue;

        const exists = await Review.findOne({
          platform: id,
          platformReviewId: normalized.platformReviewId,
          connectionId: connection._id
        });

        if (exists) continue;

        const review = new Review({
          reviewId: `${id}_${connection.locationId}_${normalized.platformReviewId}`,
          platform: id,
          platformReviewId: normalized.platformReviewId,
          platformLocationId: connection.locationId,
          externalReviewId: normalized.platformReviewId,
          userId,
          connectionId: connection._id,
          reviewText: normalized.text,
          rating: normalized.rating,
          author: normalized.author,
          authorPhotoUrl: normalized.authorPhotoUrl,
          replyStatus: 'pending',
          sentiment: inferSentiment(normalized.rating),
          fetchedAt: new Date(),
          createdAt: normalized.createdAt || new Date()
        });

        await review.save();

        await queueReplyGeneration({
          reviewId: review.reviewId,
          userId: userId.toString(),
          platform: review.platform,
          entityType: review.entityType,
          reviewText: review.reviewText,
          rating: review.rating,
          action: 'generateReply'
        });

        newCount += 1;
      }

      connection.updatedAt = new Date();
      await connection.save();
      totalReviews += await Review.countDocuments({ connectionId: connection._id });
    }

    return res.status(200).json({
      success: true,
      reviewCount: totalReviews,
      newReviews: newCount,
      lastSyncAt: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Sync error', { error: error.message, userId: req.userId });
    return res.status(500).json({ success: false, error: 'Failed to sync platform' });
  }
};

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

const disconnectIntegration = async (req, res) => {
  try {
    const { id } = req.params;

    const byId = mongoose.Types.ObjectId.isValid(id)
      ? await BusinessConnection.findOne({
          _id: id,
          userId: req.userId
        })
      : null;

    if (byId) {
      byId.isActive = false;
      await byId.save();
    } else {
      const platformConnections = await BusinessConnection.find({
        userId: req.userId,
        platform: id,
        isActive: true
      });

      if (!platformConnections.length) {
        return res.status(404).json({
          success: false,
          error: 'Integration not found'
        });
      }

      await BusinessConnection.updateMany(
        { userId: req.userId, platform: id, isActive: true },
        { isActive: false }
      );
    }

    logger.logReview('Integration disconnected', {
      userId: req.userId,
      integrationId: id
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

    connection.isActive = false;
    await connection.save();
    throw error;
  }
};

const getValidAccessToken = async (connection) => {
  if (connection.tokenExpiry && new Date() >= connection.tokenExpiry) {
    return refreshGoogleToken(connection);
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
