const cron = require('node-cron');
const User = require('../models/User');
const logger = require('../utils/logger');
const { queueSubscriptionReminderEmail } = require('../queues/email.queue');

const MS_IN_DAY = 24 * 60 * 60 * 1000;

const runSubscriptionReminderCheck = async () => {
  try {
    const now = new Date();
    const reminderStart = new Date(now.getTime() + 9 * MS_IN_DAY);
    const reminderEnd = new Date(now.getTime() + 10 * MS_IN_DAY + MS_IN_DAY);

    const users = await User.find({
      plan: { $ne: 'free' },
      subscriptionStatus: 'active',
      subscriptionCurrentPeriodEnd: { $gte: reminderStart, $lt: reminderEnd }
    }).select('name email plan subscriptionCurrentPeriodEnd lastSubscriptionReminderSentAt');

    let sentCount = 0;

    for (const user of users) {
      const alreadySentToday =
        user.lastSubscriptionReminderSentAt &&
        user.lastSubscriptionReminderSentAt.toDateString() === now.toDateString();

      if (alreadySentToday) {
        continue;
      }

      await queueSubscriptionReminderEmail({
        to: user.email,
        name: user.name,
        planName: user.plan,
        daysRemaining: 10,
        planEndsAt: new Date(user.subscriptionCurrentPeriodEnd).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        })
      });

      user.lastSubscriptionReminderSentAt = now;
      await user.save();
      sentCount += 1;
    }

    if (sentCount > 0) {
      logger.info('Subscription reminders queued', { sentCount });
    }
  } catch (error) {
    logger.error('Subscription reminder cron failed', {
      error: error.message,
      stack: error.stack
    });
  }
};

cron.schedule('0 9 * * *', runSubscriptionReminderCheck);

module.exports = {
  runSubscriptionReminderCheck
};
