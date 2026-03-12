const cron = require('node-cron');
const User = require('../models/User');
const logger = require('../utils/logger');

/**
 * Reset daily usage for all users at midnight
 */
const resetDailyUsage = async () => {
  try {
    logger.info('Running daily usage reset');
    
    const result = await User.updateMany(
      { 'dailyUsage.count': { $gt: 0 } },
      {
        $set: {
          'dailyUsage.count': 0,
          'dailyUsage.lastReset': new Date()
        }
      }
    );
    
    logger.info('Daily usage reset completed', { usersReset: result.modifiedCount });
  } catch (error) {
    logger.error('Error resetting daily usage', { error: error.message, stack: error.stack });
  }
};

// Schedule: Run at midnight (00:00) every day
cron.schedule('0 0 * * *', resetDailyUsage);

// Also run a cleanup check every hour to handle users who might have
// crossed midnight while server was running
cron.schedule('0 * * * *', async () => {
  try {
    const now = new Date();
    const result = await User.updateMany(
      {
        'dailyUsage.lastReset': {
          $lt: new Date(now.setHours(0, 0, 0, 0))
        }
      },
      {
        $set: {
          'dailyUsage.count': 0,
          'dailyUsage.lastReset': new Date()
        }
      }
    );
    
    if (result.modifiedCount > 0) {
      logger.info('Hourly cleanup completed', { usersReset: result.modifiedCount });
    }
  } catch (error) {
    logger.error('Error in hourly cleanup', { error: error.message, stack: error.stack });
  }
});

module.exports = {
  resetDailyUsage
};
