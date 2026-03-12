/**
 * Platform Integrations Index
 * Exports all adapters and the platform manager
 */

const BaseAdapter = require('./baseAdapter');
const platformManager = require('./platformManager');

// Export individual adapters for direct import if needed
const googleAdapter = require('./googleAdapter');
const playstoreAdapter = require('./playstoreAdapter');
const yelpAdapter = require('./yelpAdapter');
const tripadvisorAdapter = require('./tripadvisorAdapter');
const appstoreAdapter = require('./appstoreAdapter');

module.exports = {
  // Base class
  BaseAdapter,
  
  // Platform manager (singleton with registry)
  platformManager,
  
  // Individual adapters
  googleAdapter,
  playstoreAdapter,
  yelpAdapter,
  tripadvisorAdapter,
  appstoreAdapter,
  
  // Supported platforms list
  SUPPORTED_PLATFORMS: ['google', 'yelp', 'tripadvisor', 'appstore', 'playstore']
};
