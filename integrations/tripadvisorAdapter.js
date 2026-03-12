const axios = require('axios');
const BaseAdapter = require('./baseAdapter');

/**
 * TripAdvisor adapter
 * Implements platform adapter for TripAdvisor business reviews
 */
class TripAdvisorAdapter extends BaseAdapter {
  constructor() {
    super();
    this.platform = 'tripadvisor';
    this.baseUrl = 'https://api.tripadvisor.com/api/api/1.0';
  }

  getPlatformName() {
    return this.platform;
  }

  /**
   * Connect to TripAdvisor API
   * Uses API key authentication
   */
  async connect(connection) {
    try {
      // Validate API key exists
      return !!connection.apiKey;
    } catch (error) {
      console.error('TripAdvisor connection error:', error.message);
      return false;
    }
  }

  /**
   * Fetch reviews from TripAdvisor API
   */
  async fetchReviews(connection) {
    try {
      const locationId = connection.locationId; // TripAdvisor location ID

      const response = await axios.get(
        `${this.baseUrl}/location/${locationId}/reviews`,
        {
          headers: {
            'Authorization': `Bearer ${connection.apiKey}`
          },
          params: {
            language: 'en',
            limit: 50
          }
        }
      );

      return response.data.data || [];
    } catch (error) {
      console.error('Error fetching TripAdvisor reviews:', error.message);
      throw error;
    }
  }

  /**
   * Post reply to a TripAdvisor review
   * Note: TripAdvisor API has limited support for replies
   */
  async postReply(connection, reviewId, replyText) {
    try {
      const locationId = connection.locationId;

      const response = await axios.post(
        `${this.baseUrl}/location/${locationId}/review/${reviewId}/reply`,
        {
          title: 'Owner Response',
          text: replyText
        },
        {
          headers: {
            'Authorization': `Bearer ${connection.apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      return response.data;
    } catch (error) {
      console.error('Error posting reply to TripAdvisor:', error.message);
      throw error;
    }
  }

  /**
   * Transform TripAdvisor review to normalized format
   */
  transformReview(rawReview) {
    return {
      platform: this.platform,
      platformReviewId: rawReview.id || rawReview.review_id || '',
      platformLocationId: rawReview.location_id || '',
      text: rawReview.text || rawReview.content || '',
      rating: rawReview.rating || 0,
      author: rawReview.user?.display_name || rawReview.author_name || 'Anonymous',
      authorPhotoUrl: rawReview.user?.avatar || null,
      createdAt: rawReview.published_date 
        ? new Date(rawReview.published_date) 
        : new Date(),
      rawData: rawReview
    };
  }
}

module.exports = new TripAdvisorAdapter();
