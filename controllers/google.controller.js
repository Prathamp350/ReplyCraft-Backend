const axios = require('axios');
const BusinessConnection = require('../models/BusinessConnection');
const Review = require('../models/Review');
const User = require('../models/User');
const config = require('../config/config');
const logger = require('../utils/logger');
const { queueIntegrationConnectedEmail } = require('../queues/email.queue');

/**
 * Initiate Google OAuth connection
 */
const connect = (req, res) => {
  try {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/google/callback';
    
    if (!clientId) {
      return res.status(500).json({
        success: false,
        error: 'Google OAuth not configured'
      });
    }

    // Build OAuth URL
    const scopes = [
      'https://www.googleapis.com/auth/business.manage'
    ].join(' ');
    
    const oauthUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
      `client_id=${clientId}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&response_type=code` +
      `&scope=${encodeURIComponent(scopes)}` +
      `&access_type=offline` +
      `&prompt=consent` +
      `&state=${req.userId}`;
    
    return res.status(200).json({
      success: true,
      authUrl: oauthUrl
    });
    
  } catch (error) {
    logger.error('Google Connect Error', { error: error.message, stack: error.stack });
    return res.status(500).json({
      success: false,
      error: 'Failed to initiate Google connection'
    });
  }
};

/**
 * Handle Google OAuth callback
 */
const handleCallback = async (req, res) => {
  try {
    const { code, state: userId } = req.query;
    
    if (!code) {
      return res.status(400).json({
        success: false,
        error: 'Authorization code not provided'
      });
    }

    // Exchange code for tokens
    const tokenResponse = await axios.post('https://oauth2.googleapis.com/token', {
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      code: code,
      grant_type: 'authorization_code',
      redirect_uri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/google/callback'
    });
    
    const { access_token, refresh_token, expires_in } = tokenResponse.data;
    
    // Get account info using the access token
    const accountResponse = await axios.get(
      'https://mybusiness.googleapis.com/v4/accounts',
      {
        headers: { Authorization: `Bearer ${access_token}` }
      }
    );
    
    const accounts = accountResponse.data.accounts || [];
    
    if (accounts.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No Google Business accounts found'
      });
    }
    
    // Get locations for the first account
    const locationResponse = await axios.get(
      `https://mybusiness.googleapis.com/v4/accounts/${accounts[0].name}/locations`,
      {
        headers: { Authorization: `Bearer ${access_token}` },
        params: { pageSize: 10 }
      }
    );
    
    const locations = locationResponse.data.locations || [];
    
    if (locations.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No business locations found'
      });
    }
    
    // Store the connection
    const connection = new BusinessConnection({
      userId: userId,
      platform: 'google',
      accountId: accounts[0].name.split('/').pop(),
      locationId: locations[0].name.split('/').pop(),
      locationName: locations[0].locationName,
      accessToken: access_token,
      refreshToken: refresh_token,
      tokenExpiry: new Date(Date.now() + expires_in * 1000)
    });
    
    await connection.save();
    
    logger.logReview('Google connection saved', { userId, locationName: locations[0].locationName });

    // Queue integration connected email (async, doesn't block API)
    const user = await User.findById(userId);
    if (user) {
      queueIntegrationConnectedEmail({
        name: user.name,
        email: user.email
      }, 'google').catch(err => {
        logger.error('Failed to queue integration connected email', { error: err.message, userId });
      });
    }
    
    // Redirect to success page or return success
    return res.status(200).json({
      success: true,
      message: 'Google Business account connected successfully',
      locationName: locations[0].locationName
    });
    
  } catch (error) {
    logger.error('Google Callback Error', { error: error.message, stack: error.stack, userId });
    return res.status(500).json({
      success: false,
      error: 'Failed to complete Google connection'
    });
  }
};

/**
 * List user's Google connections
 */
const listConnections = async (req, res) => {
  try {
    const connections = await BusinessConnection.find({ userId: req.userId })
      .select('-accessToken -refreshToken')
      .sort({ createdAt: -1 });
    
    return res.status(200).json({
      success: true,
      connections
    });
    
  } catch (error) {
    logger.error('List Connections Error', { error: error.message, userId: req.userId });
    return res.status(500).json({
      success: false,
      error: 'Failed to list connections'
    });
  }
};

/**
 * Disconnect a Google connection
 */
const disconnect = async (req, res) => {
  try {
    const { connectionId } = req.params;
    
    const connection = await BusinessConnection.findOne({
      _id: connectionId,
      userId: req.userId
    });
    
    if (!connection) {
      return res.status(404).json({
        success: false,
        error: 'Connection not found'
      });
    }
    
    await connection.deleteOne();
    
    return res.status(200).json({
      success: true,
      message: 'Google connection removed'
    });
    
  } catch (error) {
    logger.error('Disconnect Error', { error: error.message, connectionId: req.params.connectionId, userId: req.userId });
    return res.status(500).json({
      success: false,
      error: 'Failed to disconnect'
    });
  }
};

/**
 * Get reviews for a specific connection
 */
const getReviews = async (req, res) => {
  try {
    const { connectionId } = req.params;
    const { status, limit = 50, offset = 0 } = req.query;
    
    // Verify ownership
    const connection = await BusinessConnection.findOne({
      _id: connectionId,
      userId: req.userId
    });
    
    if (!connection) {
      return res.status(404).json({
        success: false,
        error: 'Connection not found'
      });
    }
    
    // Build query
    const query = { connectionId };
    if (status) {
      query.status = status;
    }
    
    const reviews = await Review.find(query)
      .sort({ createdAt: -1 })
      .skip(parseInt(offset))
      .limit(parseInt(limit));
    
    const total = await Review.countDocuments(query);
    
    return res.status(200).json({
      success: true,
      reviews,
      pagination: {
        total,
        limit: parseInt(limit),
        offset: parseInt(offset)
      }
    });
    
  } catch (error) {
    console.error('Get Reviews Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to get reviews'
    });
  }
};

/**
 * Get all reviews for user
 */
const getAllReviews = async (req, res) => {
  try {
    const { status, limit = 50, offset = 0 } = req.query;
    
    // Build query
    const query = { userId: req.userId };
    if (status) {
      query.status = status;
    }
    
    const reviews = await Review.find(query)
      .populate('connectionId', 'locationName platform')
      .sort({ createdAt: -1 })
      .skip(parseInt(offset))
      .limit(parseInt(limit));
    
    const total = await Review.countDocuments(query);
    
    return res.status(200).json({
      success: true,
      reviews,
      pagination: {
        total,
        limit: parseInt(limit),
        offset: parseInt(offset)
      }
    });
    
  } catch (error) {
    console.error('Get All Reviews Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to get reviews'
    });
  }
};

module.exports = {
  connect,
  handleCallback,
  listConnections,
  disconnect,
  getReviews,
  getAllReviews
};
