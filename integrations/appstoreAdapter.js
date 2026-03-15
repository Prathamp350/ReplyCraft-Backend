const store = require('app-store-scraper');
const BaseAdapter = require('./baseAdapter');

/**
 * Apple App Store adapter
 * Implements platform adapter for Apple App Store app reviews using public scraping
 */
class AppStoreAdapter extends BaseAdapter {
  constructor() {
    super();
    this.platform = 'appstore';
  }

  getPlatformName() {
    return this.platform;
  }

  /**
   * Connect to Apple App Store
   */
  async connect(connection) {
    return true;
  }

  /**
   * Search for an app to auto-connect
   */
  async searchBusiness(name) {
    try {
      const results = await store.search({ term: name, num: 1 });
      if (!results || results.length === 0) return null;
      
      const app = results[0];
      return {
        locationId: app.appId,
        locationName: app.title,
        rawData: app
      };
    } catch (error) {
      console.error('App Store search error:', error.message);
      return null;
    }
  }

  /**
   * Fetch reviews from Apple App Store via Scraper
   */
  async fetchReviews(connection) {
    try {
      const appId = connection.locationId;
      
      const reviews = await store.reviews({
        appId: appId,
        sort: store.sort.RECENT,
        page: 1
      });

      return reviews || [];
    } catch (error) {
      console.error('Error fetching App Store reviews:', error.message);
      throw error;
    }
  }

  /**
   * Post reply to an App Store review
   */
  async postReply(connection, reviewId, replyText) {
    console.warn('App Store requires Apple JWT to post replies. Scraper is read-only.');
    throw new Error('App Store does not support API-based replies via scraper');
  }

  /**
   * Transform App Store review to normalized format
   */
  transformReview(rawReview) {
    return {
      platform: this.platform,
      platformReviewId: rawReview.id || '',
      platformLocationId: '',
      text: rawReview.text || '',
      rating: rawReview.score || 0,
      author: rawReview.userName || 'Anonymous',
      authorPhotoUrl: null,
      createdAt: new Date(), // scraper doesn't provide exact date reliably
      rawData: rawReview
    };
  }
}

module.exports = new AppStoreAdapter();
