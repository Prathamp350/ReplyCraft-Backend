const gplay = require('google-play-scraper');
const BaseAdapter = require('./baseAdapter');

/**
 * Google Play Store adapter
 * Implements platform adapter for Google Play Store app reviews using public scraping
 */
class PlayStoreAdapter extends BaseAdapter {
  constructor() {
    super();
    this.platform = 'playstore';
  }

  getPlatformName() {
    return this.platform;
  }

  /**
   * Connect to Play Store API
   * Public scraping requires no API Key
   */
  async connect(connection) {
    return true;
  }

  /**
   * Search for an app to auto-connect
   */
  async searchBusiness(name) {
    try {
      const results = await gplay.search({ term: name, num: 1 });
      if (!results || results.length === 0) return null;
      
      const app = results[0];
      return {
        locationId: app.appId,
        locationName: app.title,
        rawData: app
      };
    } catch (error) {
      console.error('Play Store search error:', error.message);
      return null;
    }
  }

  /**
   * Fetch reviews from Google Play Store API via Scraper
   */
  async fetchReviews(connection) {
    try {
      const appId = connection.locationId;
      
      const response = await gplay.reviews({
        appId: appId,
        sort: gplay.sort.NEWEST,
        num: 50
      });

      return response.data || [];
    } catch (error) {
      console.error('Error fetching Play Store reviews:', error.message);
      throw error;
    }
  }

  /**
   * Post reply to a Play Store review
   */
  async postReply(connection, reviewId, replyText) {
    console.warn('Play Store requiring OAuth for replying. Scraper is READ-ONLY.');
    throw new Error('Play Store natively via scraper does not support replying');
  }

  /**
   * Transform Play Store review to normalized format
   */
  transformReview(rawReview) {
    return {
      platform: this.platform,
      platformReviewId: rawReview.id || '',
      platformLocationId: '',
      text: rawReview.text || '',
      rating: rawReview.score || 0,
      author: rawReview.userName || 'Anonymous',
      authorPhotoUrl: rawReview.userImage || null,
      createdAt: rawReview.date 
        ? new Date(rawReview.date) 
        : new Date(),
      rawData: rawReview
    };
  }
}

module.exports = new PlayStoreAdapter();
