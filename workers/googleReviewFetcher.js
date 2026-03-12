/**
 * Google Review Fetcher Worker
 * Fetches reviews from Google Business Profile and stores in database
 */

const cron = require('node-cron');
const BusinessConnection = require('../models/BusinessConnection');
const Review = require('../models/Review');
const User = require('../models/User');
const axios = require('axios');
const logger = require('../utils/logger');
const { getValidAccessToken } = require('../controllers/integration.controller');

logger.info('[GoogleReviewFetcher] Worker started');

/**
 * Fetch reviews from Google Business API
 */
async function fetchGoogleReviews(connection) {
  try {
    const accessToken = await getValidAccessToken(connection);

    // Fetch reviews for the location
    const response = await axios.get(
      `https://mybusiness.googleapis.com/v4/${connection.locationId}/reviews`,
      {
        headers: { Authorization: `Bearer ${accessToken}` }
      }
    );

    return response.data.reviews || [];
  } catch (error) {
    logger.error('Error fetching Google reviews', {
      error: error.message,
      locationId: connection.locationId
    });
    return [];
  }
}

/**
 * Transform Google review to our format
 */
function transformGoogleReview(googleReview, connection) {
  const reviewId = `google_${connection.locationId}_${googleReview.reviewId}`;
  
  // Determine sentiment based on star rating
  let sentiment = 'neutral';
  if (googleReview.starRating === 'FIVE') sentiment = 'positive';
  else if (googleReview.starRating === 'ONE') sentiment = 'negative';
  else if (googleReview.starRating === 'TWO') sentiment = 'negative';
  else if (googleReview.starRating === 'THREE') sentiment = 'neutral';
  else if (googleReview.starRating === 'FOUR') sentiment = 'positive';

  return {
    reviewId,
    externalReviewId: googleReview.reviewId,
    userId: connection.userId,
    connectionId: connection._id,
    platform: 'google',
    entityType: 'location',
    reviewText: googleReview.comment || '',
    rating: mapStarRating(googleReview.starRating),
    author: googleReview.reviewer?.displayName || 'Anonymous',
    authorPhotoUrl: googleReview.reviewer?.profilePhotoUrl || null,
    sentiment,
    aiReply: null,
    replyText: null,
    replyStatus: 'pending',
    status: 'pending',
    fetchedAt: new Date()
  };
}

/**
 * Map Google star rating to number
 */
function mapStarRating(starRating) {
  const mapping = {
    'FIVE': 5,
    'FOUR': 4,
    'THREE': 3,
    'TWO': 2,
    'ONE': 1
  };
  return mapping[starRating] || 3;
}

/**
 * Main fetch function
 */
async function fetchAndStoreReviews() {
  try {
    logger.info('[GoogleReviewFetcher] Starting review fetch');

    // Get all active connections
    const connections = await BusinessConnection.find({
      isActive: true,
      platform: 'google'
    });

    logger.info('[GoogleReviewFetcher] Found active connections', { count: connections.length });

    let newReviewsCount = 0;
    let duplicatesCount = 0;
    let errorsCount = 0;

    for (const connection of connections) {
      try {
        // Fetch reviews from Google
        const googleReviews = await fetchGoogleReviews(connection);

        logger.info('[GoogleReviewFetcher] Fetched reviews', {
          locationId: connection.locationId,
          count: googleReviews.length
        });

        // Process each review
        for (const googleReview of googleReviews) {
          try {
            const reviewData = transformGoogleReview(googleReview, connection);

            // Check for duplicate using reviewId (unique index)
            const existingReview = await Review.findOne({ reviewId: reviewData.reviewId });

            if (existingReview) {
              duplicatesCount++;
              continue; // Skip duplicate
            }

            // Create new review
            const review = new Review(reviewData);
            await review.save();
            newReviewsCount++;

            logger.logReview('New review stored', {
              reviewId: review.reviewId,
              author: review.author,
              rating: review.rating
            });

          } catch (error) {
            logger.error('Error storing review', {
              error: error.message,
              reviewId: googleReview.reviewId
            });
            errorsCount++;
          }
        }

      } catch (error) {
        logger.error('Error processing connection', {
          error: error.message,
          connectionId: connection._id
        });
        errorsCount++;
      }
    }

    logger.logReview('Google review fetch completed', {
      newReviews: newReviewsCount,
      duplicates: duplicatesCount,
      errors: errorsCount
    });

  } catch (error) {
    logger.error('Fatal error in Google review fetcher', {
      error: error.message,
      stack: error.stack
    });
  }
}

// Run every 10 minutes
cron.schedule('*/10 * * * *', fetchAndStoreReviews);

// Also run on startup (after a short delay to ensure server is ready)
setTimeout(fetchAndStoreReviews, 15000);

module.exports = {
  fetchAndStoreReviews,
  fetchGoogleReviews,
  transformGoogleReview
};
