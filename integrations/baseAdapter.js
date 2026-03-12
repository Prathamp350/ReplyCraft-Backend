/**
 * Base adapter interface for platform integrations
 * All platform adapters must implement these methods
 */
class BaseAdapter {
  constructor() {
    if (this.constructor === BaseAdapter) {
      throw new Error('BaseAdapter is abstract and cannot be instantiated directly');
    }
  }

  /**
   * Connect/authenticate with the platform
   * @param {Object} credentials - Platform-specific credentials
   * @returns {Promise<boolean>} - Connection success status
   */
  async connect(credentials) {
    throw new Error('Method connect() must be implemented');
  }

  /**
   * Fetch reviews from the platform
   * @param {Object} connection - BusinessConnection instance
   * @returns {Promise<Array>} - Array of raw review objects from the platform
   */
  async fetchReviews(connection) {
    throw new Error('Method fetchReviews() must be implemented');
  }

  /**
   * Post a reply to a review
   * @param {Object} connection - BusinessConnection instance
   * @param {string} reviewId - Platform-specific review ID
   * @param {string} replyText - Reply text to post
   * @returns {Promise<Object>} - Platform response
   */
  async postReply(connection, reviewId, replyText) {
    throw new Error('Method postReply() must be implemented');
  }

  /**
   * Transform platform-specific review to normalized format
   * @param {Object} rawReview - Raw review from platform API
   * @returns {Object} - Normalized review object
   */
  transformReview(rawReview) {
    throw new Error('Method transformReview() must be implemented');
  }

  /**
   * Get platform name
   * @returns {string} - Platform identifier
   */
  getPlatformName() {
    throw new Error('Method getPlatformName() must be implemented');
  }
}

module.exports = BaseAdapter;
