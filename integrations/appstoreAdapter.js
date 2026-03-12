const axios = require('axios');
const BaseAdapter = require('./baseAdapter');

/**
 * Apple App Store adapter
 * Implements platform adapter for Apple App Store app reviews
 */
class AppStoreAdapter extends BaseAdapter {
  constructor() {
    super();
    this.platform = 'appstore';
    this.baseUrl = 'https://api.appstoreconnect.apple.com/v1';
  }

  getPlatformName() {
    return this.platform;
  }

  /**
   * Connect to Apple App Store Connect API
   * Uses JWT authentication
   */
  async connect(connection) {
    try {
      // Apple uses JWT tokens, you'd generate/refresh here
      // For now, check if we have the necessary credentials
      return !!connection.apiKey || !!connection.accessToken;
    } catch (error) {
      console.error('App Store connection error:', error.message);
      return false;
    }
  }

  /**
   * Fetch reviews from Apple App Store Connect API
   */
  async fetchReviews(connection) {
    try {
      const appId = connection.config?.appId || connection.locationId;

      const response = await axios.get(
        `${this.baseUrl}/apps/${appId}/customerReviews`,
        {
          headers: {
            'Authorization': `Bearer ${connection.accessToken}`,
            'Content-Type': 'application/json'
          },
          params: {
            'limit': 50,
            'sort': '-createdDate'
          }
        }
      );

      return response.data.data || [];
    } catch (error) {
      console.error('Error fetching App Store reviews:', error.message);
      throw error;
    }
  }

  /**
   * Post reply to an App Store review
   */
  async postReply(connection, reviewId, replyText) {
    try {
      const appId = connection.config?.appId || connection.locationId;

      const response = await axios.post(
        `${this.baseUrl}/apps/${appId}/customerReviews/${reviewId}/responses`,
        {
          data: {
            type: 'customerReviewResponses',
            attributes: {
              body: replyText
            },
            relationships: {
              review: {
                data: {
                  id: reviewId,
                  type: 'customerReviews'
                }
              }
            }
          }
        },
        {
          headers: {
            'Authorization': `Bearer ${connection.accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      return response.data;
    } catch (error) {
      console.error('Error posting reply to App Store:', error.message);
      throw error;
    }
  }

  /**
   * Transform App Store review to normalized format
   */
  transformReview(rawReview) {
    const attributes = rawReview.attributes || {};
    return {
      platform: this.platform,
      platformReviewId: rawReview.id || '',
      platformLocationId: rawReview.attributes?.app?.link?.split('/').pop() || '',
      text: attributes.body || '',
      rating: attributes.rating || 0,
      author: attributes.alias || attributes.reviewerNickname || 'Anonymous',
      authorPhotoUrl: null,
      createdAt: attributes.createdDate ? new Date(attributes.createdDate) : new Date(),
      rawData: rawReview
    };
  }
}

module.exports = new AppStoreAdapter();
