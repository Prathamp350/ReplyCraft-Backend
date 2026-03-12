const cron = require('node-cron');
const BusinessConnection = require('../models/BusinessConnection');
const Review = require('../models/Review');
const User = require('../models/User');
const { platformManager } = require('../integrations');
const { queueReplyGeneration } = require('../queues/reply.queue');
const logger = require('../utils/logger');

logger.info('Multi-platform Review Fetcher worker started');

/**
 * Fetch and queue new reviews from all active connections
 * Uses unique index { platform: 1, platformReviewId: 1 } for duplicate protection
 */
async function fetchAndQueueReviews() {
  try {
    logger.info('Starting multi-platform review fetch');
    
    // Get all active business connections
    const connections = await BusinessConnection.find({ 
      isActive: true,
      status: 'active'
    });
    
    logger.info('Found active connections', { count: connections.length });
    
    if (connections.length === 0) {
      logger.info('No active connections to process');
      return;
    }
    
    const stats = {
      newReviews: 0,
      duplicates: 0,
      queued: 0,
      errors: 0,
      byPlatform: {}
    };
    
    // Process each connection
    for (const connection of connections) {
      const platform = connection.platform || 'google';
      
      // Initialize platform stats
      if (!stats.byPlatform[platform]) {
        stats.byPlatform[platform] = { newReviews: 0, duplicates: 0, errors: 0 };
      }
      
      try {
        // Validate platform is supported
        if (!platformManager.isPlatformSupported(platform)) {
          logger.warn('Skipping unsupported platform', { platform });
          continue;
        }
        
        // Ensure connection is valid (token refresh if needed)
        const isConnected = await platformManager.connect(connection);
        if (!isConnected) {
          logger.warn('Connection failed, skipping', { 
            platform, 
            locationId: connection.locationId 
          });
          stats.errors++;
          stats.byPlatform[platform].errors++;
          continue;
        }
        
        // Fetch reviews from platform
        const rawReviews = await platformManager.fetchReviews(connection);
        
        logger.info(`Fetched reviews from ${platform}`, { 
          locationId: connection.locationId,
          count: rawReviews.length 
        });
        
        // Process each review
        for (const rawReview of rawReviews) {
          try {
            // Transform to normalized format
            const normalized = platformManager.transformReview(platform, rawReview);
            
            // Skip if no valid platform review ID
            if (!normalized.platformReviewId) {
              logger.warn('Skipping review without platformReviewId', { platform });
              continue;
            }
            
            // Check for existing review (duplicate protection)
            // Uses unique index: { platform: 1, platformReviewId: 1 }
            const existingReview = await Review.findOne({
              platform: platform,
              platformReviewId: normalized.platformReviewId
            });
            
            if (existingReview) {
              stats.duplicates++;
              stats.byPlatform[platform].duplicates++;
              continue;
            }
            
            // Get user
            const user = await User.findById(connection.userId);
            
            if (!user || !user.isActive) {
              logger.warn('User not found or inactive', { 
                userId: connection.userId,
                platform 
              });
              continue;
            }
            
            // Create review record
            const newReview = new Review({
              // Internal unique ID
              reviewId: `${platform}_${normalized.platformReviewId}`,
              
              // Platform identifiers
              platform: platform,
              platformReviewId: normalized.platformReviewId,
              platformLocationId: normalized.platformLocationId,
              externalReviewId: normalized.platformReviewId,
              
              // User association
              userId: user._id,
              connectionId: connection._id,
              
              // Review data
              reviewText: normalized.text,
              rating: normalized.rating,
              author: normalized.author,
              authorPhotoUrl: normalized.authorPhotoUrl,
              
              // Status
              replyStatus: 'pending',
              fetchedAt: new Date()
            });
            
            await newReview.save();
            stats.newReviews++;
            stats.byPlatform[platform].newReviews++;
            
            // Queue for AI reply generation
            try {
              await queueReplyGeneration({
                reviewId: newReview.reviewId,
                userId: user._id.toString(),
                platform: platform,
                entityType: 'location',
                reviewText: normalized.text,
                rating: normalized.rating
              });
              stats.queued++;
            } catch (queueError) {
              logger.error('Failed to queue review', { 
                reviewId: newReview.reviewId, 
                error: queueError.message 
              });
            }
            
          } catch (transformError) {
            logger.error('Error transforming review', { 
              platform,
              error: transformError.message 
            });
            stats.errors++;
            stats.byPlatform[platform].errors++;
          }
        }
        
      } catch (connectionError) {
        logger.error('Error processing connection', { 
          connectionId: connection._id,
          platform,
          error: connectionError.message 
        });
        stats.errors++;
        stats.byPlatform[platform].errors++;
      }
    }
    
    // Log summary
    logger.logReview('Multi-platform review fetch completed', stats);
    
  } catch (error) {
    logger.error('Review fetcher fatal error', { 
      error: error.message, 
      stack: error.stack 
    });
  }
}

// Run every 5 minutes
cron.schedule('*/5 * * * *', fetchAndQueueReviews);

// Run on startup (after a short delay to ensure server is ready)
setTimeout(fetchAndQueueReviews, 10000);

// Export for manual triggering
module.exports = {
  fetchAndQueueReviews
};
