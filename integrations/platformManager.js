const googleAdapter = require('./googleAdapter');
const playstoreAdapter = require('./playstoreAdapter');
const yelpAdapter = require('./yelpAdapter');
const tripadvisorAdapter = require('./tripadvisorAdapter');
const appstoreAdapter = require('./appstoreAdapter');

/**
 * Platform Registry
 * Central registry that maps platform names to adapter instances
 */
const PLATFORM_REGISTRY = {
  google: googleAdapter,
  playstore: playstoreAdapter,
  yelp: yelpAdapter,
  tripadvisor: tripadvisorAdapter,
  appstore: appstoreAdapter
};

/**
 * Platform Manager
 * Routes platform-specific operations to the correct adapter
 * Provides token refresh support and connection management
 */
class PlatformManager {
  constructor() {
    this.adapters = PLATFORM_REGISTRY;
    this.SupportedPlatforms = Object.keys(this.adapters);
  }

  /**
   * Get the adapter for a specific platform
   * @param {string} platform - Platform name
   * @returns {Object} - Platform adapter instance
   * @throws {Error} - If platform is not supported
   */
  getAdapter(platform) {
    const adapter = this.adapters[platform];
    
    if (!adapter) {
      throw new Error(
        `Platform '${platform}' is not supported. ` +
        `Supported platforms: ${this.SupportedPlatforms.join(', ')}`
      );
    }
    
    return adapter;
  }

  /**
   * Get all supported platforms
   * @returns {string[]} - Array of supported platform names
   */
  getSupportedPlatforms() {
    return [...this.SupportedPlatforms];
  }

  /**
   * Check if a platform is supported
   * @param {string} platform - Platform name
   * @returns {boolean}
   */
  isPlatformSupported(platform) {
    return platform in this.adapters;
  }

  /**
   * Connect/validate a platform connection
   * Handles token refresh if needed
   * @param {Object} connection - BusinessConnection instance
   * @returns {Promise<boolean>} - Connection success status
   */
  async connect(connection) {
    try {
      const adapter = this.getAdapter(connection.platform);
      
      // Ensure connection has valid credentials
      const isValid = await adapter.connect(connection);
      
      if (!isValid) {
        await this._updateConnectionStatus(connection, 'error', 'Failed to validate connection');
        return false;
      }
      
      await this._updateConnectionStatus(connection, 'active', null);
      return true;
    } catch (error) {
      await this._updateConnectionStatus(connection, 'error', error.message);
      console.error(`Platform connect error [${connection.platform}]:`, error.message);
      return false;
    }
  }

  /**
   * Fetch reviews from a platform
   * @param {Object} connection - BusinessConnection instance
   * @returns {Promise<Array>} - Array of raw reviews
   */
  async fetchReviews(connection) {
    const adapter = this.getAdapter(connection.platform);
    return adapter.fetchReviews(connection);
  }

  /**
   * Post a reply to a review
   * @param {Object} connection - BusinessConnection instance
   * @param {string} reviewId - Platform-specific review ID
   * @param {string} replyText - Reply text
   * @returns {Promise<Object>}
   */
  async postReply(connection, reviewId, replyText) {
    const adapter = this.getAdapter(connection.platform);
    return adapter.postReply(connection, reviewId, replyText);
  }

  /**
   * Transform a raw review to normalized format
   * @param {string} platform - Platform name
   * @param {Object} rawReview - Raw review from platform API
   * @returns {Object} - Normalized review
   */
  transformReview(platform, rawReview) {
    const adapter = this.getAdapter(platform);
    return adapter.transformReview(rawReview);
  }

  /**
   * Normalize reviews from any platform to internal format
   * @param {string} platform - Platform name
   * @param {Array} rawReviews - Array of raw reviews
   * @returns {Array} - Array of normalized reviews
   */
  normalizeReviews(platform, rawReviews) {
    const adapter = this.getAdapter(platform);
    return rawReviews.map(rawReview => adapter.transformReview(rawReview));
  }

  /**
   * Refresh token for a connection if applicable
   * @param {Object} connection - BusinessConnection instance
   * @returns {Promise<boolean>} - Refresh success status
   */
  async refreshToken(connection) {
    try {
      const adapter = this.getAdapter(connection.platform);
      
      if (typeof adapter.refreshToken === 'function') {
        const newTokens = await adapter.refreshToken(connection);
        
        if (newTokens) {
          connection.accessToken = newTokens.accessToken;
          if (newTokens.refreshToken) {
            connection.refreshToken = newTokens.refreshToken;
          }
          if (newTokens.tokenExpiry) {
            connection.tokenExpiry = newTokens.tokenExpiry;
          }
          await connection.save();
          return true;
        }
      }
      
      return false;
    } catch (error) {
      console.error(`Token refresh error [${connection.platform}]:`, error.message);
      await this._updateConnectionStatus(connection, 'expired', 'Token refresh failed');
      return false;
    }
  }

  /**
   * Check if a connection needs token refresh
   * @param {Object} connection - BusinessConnection instance
   * @returns {boolean}
   */
  needsTokenRefresh(connection) {
    if (!connection.tokenExpiry) return false;
    
    const now = new Date();
    const expiry = new Date(connection.tokenExpiry);
    // Refresh if token expires in less than 5 minutes
    const bufferTime = 5 * 60 * 1000;
    
    return now.getTime() + bufferTime >= expiry.getTime();
  }

  /**
   * Ensure valid token before making API calls
   * @param {Object} connection - BusinessConnection instance
   * @returns {Promise<boolean>}
   */
  async ensureValidToken(connection) {
    if (this.needsTokenRefresh(connection)) {
      return await this.refreshToken(connection);
    }
    return true;
  }

  /**
   * Update connection status
   * @private
   */
  async _updateConnectionStatus(connection, status, errorMessage) {
    connection.status = status;
    connection.errorMessage = errorMessage;
    await connection.save();
  }

  /**
   * Get all active connections grouped by platform
   * @param {Array} connections - Array of BusinessConnection documents
   * @returns {Object} - Connections grouped by platform
   */
  groupByPlatform(connections) {
    const grouped = {};
    
    for (const connection of connections) {
      const platform = connection.platform || 'google';
      if (!grouped[platform]) {
        grouped[platform] = [];
      }
      grouped[platform].push(connection);
    }
    
    return grouped;
  }
}

// Export singleton instance
module.exports = new PlatformManager();
