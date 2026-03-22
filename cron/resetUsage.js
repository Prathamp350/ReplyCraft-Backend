const cron = require('node-cron');
const User = require('../models/User');
const logger = require('../utils/logger');

/**
 * Reset monthly usage for all users on the 1st of the month
 */
const resetMonthlyUsage = async () => {
  try {
    logger.info('Running monthly usage reset');
    
    const result = await User.updateMany(
      { 'monthlyUsage.count': { $gt: 0 } },
      {
        $set: {
          'monthlyUsage.count': 0,
          'monthlyUsage.lastReset': new Date()
        }
      }
    );
    
    logger.info('Monthly usage reset completed', { usersReset: result.modifiedCount });
  } catch (error) {
    logger.error('Error resetting monthly usage', { error: error.message, stack: error.stack });
  }
};

// Schedule: Run at midnight on the 1st of every month
cron.schedule('0 0 1 * *', resetMonthlyUsage);

// Cleanup check every day to handle month boundaries
cron.schedule('0 0 * * *', async () => {
  try {
    const now = new Date();
    // Start of the current month
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    
    const result = await User.updateMany(
      {
        'monthlyUsage.lastReset': {
          $lt: startOfMonth
        }
      },
      {
        $set: {
          'monthlyUsage.count': 0,
          'monthlyUsage.lastReset': new Date()
        }
      }
    );
    
    if (result.modifiedCount > 0) {
      logger.info('Daily cleanup for monthly boundaries completed', { usersReset: result.modifiedCount });
    }
  } catch (error) {
    logger.error('Error in monthly boundary cleanup', { error: error.message, stack: error.stack });
  }
});

module.exports = {
  resetMonthlyUsage
};
