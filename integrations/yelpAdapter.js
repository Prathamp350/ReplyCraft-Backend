const axios = require('axios');
const BaseAdapter = require('./baseAdapter');

/**
 * Yelp adapter
 * Implements platform adapter for Yelp business reviews
 */
class YelpAdapter extends BaseAdapter {
  constructor() {
    super();
    this.platform = 'yelp';
    this.baseUrl = 'https://api.yelp.com/v3';
  }

  getPlatformName() {
    return this.platform;
  }

  /**
   * Connect to Yelp API
   * Uses API key authentication
   */
  async connect(connection) {
    try {
      // Validate API key exists
      return !!connection.apiKey;
    } catch (error) {
      console.error('Yelp connection error:', error.message);
      return false;
    }
  }

  /**
   * Fetch reviews from Yelp API
   */
  async fetchReviews(connection) {
    try {
      const businessId = connection.locationId; // Yelp uses business ID as locationId

      const response = await axios.get(
        `${this.baseUrl}/businesses/${businessId}/reviews`,
        {
          headers: {
            Authorization: `Bearer ${connection.apiKey}`
          },
          params: {
            limit: 50,
            sort_by: 'time'
          }
        }
      );

      return response.data.reviews || [];
    } catch (error) {
      console.error('Error fetching Yelp reviews:', error.message);
      throw error;
    }
  }

  /**
   * Post reply to a Yelp review
   * Note: Yelp API doesn't support direct replies via API
   * This is a placeholder for potential future functionality
   */
  async postReply(connection, reviewId, replyText) {
    // Yelp doesn't provide a public API for posting replies
    // In production, you might need to use a workaround or third-party tool
    console.warn('Yelp does not support programmatic reply posting');
    throw new Error('Yelp does not support API-based replies');
  }

  /**
   * Transform Yelp review to normalized format
   */
  transformReview(rawReview) {
    return {
      platform: this.platform,
      platformReviewId: rawReview.id || '',
      platformLocationId: rawReview.url || '',
      text: rawReview.text || '',
      rating: rawReview.rating || 0,
      author: rawReview.user?.name || rawReview.author || 'Anonymous',
      authorPhotoUrl: rawReview.user?.image_url || null,
      createdAt: rawReview.time_created 
        ? new Date(rawReview.time_created) 
        : new Date(),
      rawData: rawReview
    };
  }
}

module.exports = new YelpAdapter();
