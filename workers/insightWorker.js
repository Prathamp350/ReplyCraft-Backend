const cron = require('node-cron');
const User = require('../models/User');
const reviewInsightsService = require('../services/reviewInsights.service');
const logger = require('../utils/logger');

logger.info('Insight Worker started');

/**
 * Generate insights for all active users
 */
async function generateInsightsForAllUsers() {
  try {
    logger.info('Starting weekly insight generation');
    
    // Get all active users
    const users = await User.find({ isActive: true });
    
    logger.info('Found active users', { count: users.length });
    
    let successCount = 0;
    let errorCount = 0;
    
    for (const user of users) {
      try {
        const insight = await reviewInsightsService.generateWeeklyInsights(user._id.toString());
        
        if (insight) {
          successCount++;
          logger.logReview('Insight generated', {
            userId: user._id,
            reviewCount: insight.reviewCount,
            periodStart: insight.periodStart,
            periodEnd: insight.periodEnd
          });
        } else {
          logger.info('No reviews found for user', { userId: user._id });
        }
      } catch (userError) {
        errorCount++;
        logger.error('Error generating insight for user', {
          userId: user._id,
          error: userError.message
        });
      }
    }
    
    logger.logReview('Weekly insight generation completed', {
      success: successCount,
      errors: errorCount,
      totalUsers: users.length
    });
    
  } catch (error) {
    logger.error('Insight worker fatal error', {
      error: error.message,
      stack: error.stack
    });
  }
}

/**
 * Generate insights for a specific user
 * @param {string} userId - User ID
 */
async function generateInsightsForUser(userId) {
  try {
    const insight = await reviewInsightsService.generateWeeklyInsights(userId);
    
    if (insight) {
      logger.logReview('User insight generated', {
        userId,
        reviewCount: insight.reviewCount
      });
      return insight;
    }
    
    logger.info('No reviews found for user', { userId });
    return null;
  } catch (error) {
    logger.error('Error generating user insight', {
      userId,
      error: error.message
    });
    throw error;
  }
}

// Run once per week (Sunday at 2 AM)
cron.schedule('0 2 * * 0', generateInsightsForAllUsers);

// Also run on startup (after a short delay)
setTimeout(generateInsightsForAllUsers, 30000);

module.exports = {
  generateInsightsForAllUsers,
  generateInsightsForUser
};
