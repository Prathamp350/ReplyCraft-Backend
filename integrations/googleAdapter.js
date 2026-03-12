const axios = require('axios');
const BaseAdapter = require('./baseAdapter');

/**
 * Google Business Profile adapter
 * Implements platform adapter for Google Business Profile reviews
 * Uses OAuth tokens stored in BusinessConnection
 */
class GoogleAdapter extends BaseAdapter {
  constructor() {
    super();
    this.platform = 'google';
    this.baseUrl = 'https://mybusiness.googleapis.com/v4';
    this.tokenUrl = 'https://oauth2.googleapis.com/token';
  }

  getPlatformName() {
    return this.platform;
  }

  /**
   * Connect to Google Business Profile API
   * Validates and refreshes access token if needed
   */
  async connect(connection) {
    try {
      // Check if token needs refresh
      if (this._isTokenExpired(connection)) {
        const refreshed = await this.refreshToken(connection);
        if (!refreshed) {
          return false;
        }
      }
      
      // Validate token by making a test request
      return await this._validateToken(connection);
    } catch (error) {
      console.error('Google connection error:', error.message);
      return false;
    }
  }

  /**
   * Check if token is expired or needs refresh
   * @private
   */
  _isTokenExpired(connection) {
    if (!connection.tokenExpiry) return true;
    
    const now = new Date();
    const expiry = new Date(connection.tokenExpiry);
    // Add 5 minute buffer
    const bufferTime = 5 * 60 * 1000;
    
    return now.getTime() + bufferTime >= expiry.getTime();
  }

  /**
   * Refresh OAuth access token
   * @param {Object} connection - BusinessConnection instance
   * @returns {Promise<Object>} - New token data
   */
  async refreshToken(connection) {
    if (!connection.refreshToken) {
      throw new Error('No refresh token available');
    }

    try {
      const response = await axios.post(this.tokenUrl, {
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        refresh_token: connection.refreshToken,
        grant_type: 'refresh_token'
      });

      const tokenData = {
        accessToken: response.data.access_token,
        tokenExpiry: new Date(Date.now() + (response.data.expires_in * 1000))
      };

      // Update connection with new tokens
      connection.accessToken = tokenData.accessToken;
      connection.tokenExpiry = tokenData.tokenExpiry;
      await connection.save();

      return tokenData;
    } catch (error) {
      console.error('Google token refresh error:', error.message);
      throw error;
    }
  }

  /**
   * Validate token by making a test API call
   * @private
   */
  async _validateToken(connection) {
    try {
      await axios.get(
        `${this.baseUrl}/accounts/${connection.accountId}`,
        {
          headers: { Authorization: `Bearer ${connection.accessToken}` },
          params: { readMask: 'name' }
        }
      );
      return true;
    } catch (error) {
      if (error.response?.status === 401) {
        // Token invalid, try to refresh
        return await this.refreshToken(connection).then(() => true).catch(() => false);
      }
      return false;
    }
  }

  /**
   * Get valid access token for API calls
   * Automatically refreshes if needed
   */
  async getValidAccessToken(connection) {
    if (this._isTokenExpired(connection)) {
      await this.refreshToken(connection);
    }
    return connection.accessToken;
  }

  /**
   * Fetch reviews from Google Business Profile API
   */
  async fetchReviews(connection) {
    try {
      const accessToken = await this.getValidAccessToken(connection);
      const locationId = connection.locationId;

      const response = await axios.get(
        `${this.baseUrl}/accounts/${connection.accountId}/locations/${locationId}/reviews`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`
          },
          params: {
            pageSize: 50
          }
        }
      );

      return response.data.reviews || [];
    } catch (error) {
      console.error('Error fetching Google reviews:', error.message);
      
      if (error.response?.status === 401) {
        connection.status = 'expired';
        await connection.save();
      }
      
      throw error;
    }
  }

  /**
   * Post reply to a Google review
   */
  async postReply(connection, reviewId, replyText) {
    try {
      const accessToken = await this.getValidAccessToken(connection);

      const response = await axios.post(
        `${this.baseUrl}/accounts/${connection.accountId}/locations/${connection.locationId}/reviews/${reviewId}/reply`,
        { comment: replyText },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      return response.data;
    } catch (error) {
      console.error('Error posting reply to Google:', error.message);
      throw error;
    }
  }

  /**
   * Transform Google review to normalized format
   */
  transformReview(googleReview) {
    return {
      platform: this.platform,
      platformReviewId: googleReview.name?.split('/').pop(),
      platformLocationId: googleReview.locationName || '',
      text: googleReview.comment || '',
      rating: googleReview.starRating ? this._mapStarRating(googleReview.starRating) : 0,
      author: googleReview.reviewer?.displayName || 'Anonymous',
      authorPhotoUrl: googleReview.reviewer?.profilePhotoUrl || null,
      createdAt: googleReview.createTime ? new Date(googleReview.createTime) : new Date(),
      rawData: googleReview
    };
  }

  /**
   * Map Google star rating to number
   * @private
   */
  _mapStarRating(starRating) {
    const mapping = {
      'FIVE': 5,
      'FOUR': 4,
      'THREE': 3,
      'TWO': 2,
      'ONE': 1
    };
    return mapping[starRating] || 3;
  }
}

module.exports = new GoogleAdapter();
