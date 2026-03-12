const axios = require('axios');
const BusinessConnection = require('../models/BusinessConnection');

/**
 * Google Business Profile API service
 */
class GoogleReviewsService {
  constructor() {
    this.baseUrl = 'https://mybusiness.googleapis.com/v4';
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshAccessToken(refreshToken) {
    try {
      // Note: In production, use proper OAuth token refresh
      // This is a placeholder - implement actual Google OAuth token refresh
      const response = await axios.post('https://oauth2.googleapis.com/token', {
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: 'refresh_token'
      });

      return response.data;
    } catch (error) {
      console.error('Error refreshing Google token:', error.message);
      throw error;
    }
  }

  /**
   * Get valid access token for a connection
   */
  async getValidAccessToken(connection) {
    const now = new Date();
    const tokenExpiry = new Date(connection.tokenExpiry);

    if (now >= tokenExpiry) {
      // Token expired, refresh it
      const tokenData = await this.refreshAccessToken(connection.refreshToken);
      
      connection.accessToken = tokenData.access_token;
      connection.tokenExpiry = new Date(now.getTime() + (tokenData.expires_in * 1000));
      
      await connection.save();
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
        // Token might be revoked, mark connection as inactive
        connection.isActive = false;
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
        {
          comment: replyText
        },
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
   * Transform Google review to internal format
   */
  transformReview(googleReview) {
    return {
      reviewId: googleReview.name.split('/').pop(),
      text: googleReview.comment || '',
      rating: googleReview.starRating || 0,
      author: googleReview.reviewer?.displayName || 'Anonymous',
      authorPhotoUrl: googleReview.reviewer?.profilePhotoUrl || null,
      createdAt: googleReview.createTime ? new Date(googleReview.createTime) : new Date()
    };
  }
}

module.exports = new GoogleReviewsService();
