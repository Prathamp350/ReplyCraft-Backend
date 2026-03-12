/**
 * Integration Controller
 * Handles Google Business Profile connections
 */

const BusinessConnection = require('../models/BusinessConnection');
const axios = require('axios');
const config = require('../config/config');
const logger = require('../utils/logger');

/**
 * Connect Google Business Profile
 */
const connectGoogle = async (req, res) => {
  try {
    const { code, redirectUri } = req.body;
    const userId = req.userId;

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
    }).sort({ createdAt: -1 });

    const integrations = connections.map(conn => ({
      id: conn._id,
      platform: conn.platform,
      locationName: conn.locationName,
      locationId: conn.locationId,
      connectedAt: conn.createdAt,
      status: conn.isActive ? 'active' : 'expired'
    }));

    return res.status(200).json({
      success: true,
      integrations
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
  getValidAccessToken
};
