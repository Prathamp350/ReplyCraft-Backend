const axios = require('axios');
const BaseAdapter = require('./baseAdapter');

/**
 * Google Play Store adapter
 * Implements platform adapter for Google Play Store app reviews
 * Uses OAuth tokens stored in BusinessConnection
 */
class PlayStoreAdapter extends BaseAdapter {
  constructor() {
    super();
    this.platform = 'playstore';
    this.baseUrl = 'https://androidpublisher.googleapis.com/androidpublisher/v3';
  }

  getPlatformName() {
    return this.platform;
  }

  /**
   * Connect to Play Store API
   * Uses OAuth token from BusinessConnection
   */
  async connect(connection) {
    try {
      // Check if token needs refresh
      if (this._isTokenExpired(connection)) {
        await this.refreshToken(connection);
      }
      
      return !!connection.accessToken;
    } catch (error) {
      console.error('Play Store connection error:', error.message);
      return false;
    }
  }

  /**
   * Check if token is expired
   * @private
   */
  _isTokenExpired(connection) {
    if (!connection.tokenExpiry) return !connection.accessToken;
    return new Date() >= new Date(connection.tokenExpiry);
  }

  /**
   * Refresh OAuth token for Play Store
   * Note: Play Store typically uses service account, not refresh tokens
   * This is a placeholder for OAuth2 flow
   */
  async refreshToken(connection) {
    if (!connection.refreshToken) {
      throw new Error('No refresh token available for Play Store');
    }

    // Implement OAuth2 refresh flow if needed
    const response = await axios.post('https://oauth2.googleapis.com/token', {
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: connection.refreshToken,
      grant_type: 'refresh_token'
    });

    connection.accessToken = response.data.access_token;
    connection.tokenExpiry = new Date(Date.now() + (response.data.expires_in * 1000));
    await connection.save();

    return {
      accessToken: response.data.access_token,
      tokenExpiry: connection.tokenExpiry
    };
  }

  /**
   * Get valid access token
   */
  async getValidAccessToken(connection) {
    if (this._isTokenExpired(connection)) {
      await this.refreshToken(connection);
    }
    return connection.accessToken;
  }

  /**
   * Fetch reviews from Google Play Store API
   */
  async fetchReviews(connection) {
    try {
      const accessToken = await this.getValidAccessToken(connection);
      const packageName = connection.config?.packageName || connection.locationId;
      
      const response = await axios.get(
        `${this.baseUrl}/applications/${packageName}/reviews`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          params: {
            token: connection.config?.paginationToken || '',
            maxResults: 50
          }
        }
      );

      return response.data.reviews || [];
    } catch (error) {
      console.error('Error fetching Play Store reviews:', error.message);
      throw error;
    }
  }

  /**
   * Post reply to a Play Store review
   */
  async postReply(connection, reviewId, replyText) {
    try {
      const accessToken = await this.getValidAccessToken(connection);
      const packageName = connection.config?.packageName || connection.locationId;

      const response = await axios.post(
        `${this.baseUrl}/applications/${packageName}/reviews/${reviewId}/reply`,
        {
          developerReply: {
            text: replyText
          }
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
      console.error('Error posting reply to Play Store:', error.message);
      throw error;
    }
  }

  /**
   * Transform Play Store review to normalized format
   */
  transformReview(rawReview) {
    const userComment = rawReview.comments?.[0]?.userComment || {};
    return {
      platform: this.platform,
      platformReviewId: rawReview.reviewId || '',
      platformLocationId: rawReview.packageName || '',
      text: userComment.text || '',
      rating: userComment.star || 0,
      author: rawReview.authorName || 'Anonymous',
      authorPhotoUrl: null,
      createdAt: userComment.lastModifiedDateSeconds 
        ? new Date(userComment.lastModifiedDateSeconds * 1000) 
        : new Date(),
      rawData: rawReview
    };
  }
}

module.exports = new PlayStoreAdapter();
