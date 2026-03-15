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
      return !!(connection.apiKey || process.env.YELP_API_KEY);
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
      const apiKey = connection.apiKey || process.env.YELP_API_KEY;

      const response = await axios.get(
        `${this.baseUrl}/businesses/${businessId}/reviews`,
        {
          headers: {
            Authorization: `Bearer ${apiKey}`
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
   * Search for a business to auto-connect
   * Uses YELP_API_KEY env variable
   */
  async searchBusiness(name, location) {
    try {
      const apiKey = process.env.YELP_API_KEY;
      if (!apiKey) {
        console.warn('YELP_API_KEY is not configured in environment');
        return null;
      }
      
      const response = await axios.get(
        `${this.baseUrl}/businesses/search`,
        {
          headers: { Authorization: `Bearer ${apiKey}` },
          params: { 
            term: name, 
            location: location || 'US', 
            limit: 1 
          }
        }
      );
      
      const business = response.data.businesses?.[0];
      if (!business) return null;
      
      return {
        locationId: business.id,
        locationName: business.name,
        rawData: business
      };
    } catch (error) {
      console.error('Yelp search error:', error.message);
      return null;
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
