/**
 * Test Controller
 * For testing email and other features
 */

const { queueTestEmail } = require('../queues/email.queue');
const { getEmailConfigStatus } = require('../config/emailValidator');
const { getEmailQueueStats } = require('../queues/email.queue');
const logger = require('../utils/logger');

/**
 * Send test email to logged in user
 */
const sendTestEmail = async (req, res) => {
  try {
    const user = req.user;
    
    // Check if email is configured
    const emailStatus = getEmailConfigStatus();
    
    if (!emailStatus.configured) {
      return res.status(400).json({
        success: false,
        error: 'Email not configured',
        missing: emailStatus.missing
      });
    }
    
    // Queue test email
    await queueTestEmail({
      email: user.email,
      name: user.name
    });
    
    logger.info('Test email queued', { userId: user._id, email: user.email });
    
    return res.status(200).json({
      success: true,
      message: 'Test email queued successfully',
      email: user.email
    });
    
  } catch (error) {
    logger.error('Failed to send test email', { 
      error: error.message, 
      userId: req.userId 
    });
    return res.status(500).json({
      success: false,
      error: 'Failed to send test email'
    });
  }
};

/**
 * Get email system status
 */
const getEmailStatus = async (req, res) => {
  try {
    const configStatus = getEmailConfigStatus();
    const queueStats = await getEmailQueueStats();
    
    return res.status(200).json({
      success: true,
      configured: configStatus.configured,
      missing: configStatus.missing,
      queueStats
    });
    
  } catch (error) {
    logger.error('Failed to get email status', { error: error.message });
    return res.status(500).json({
      success: false,
      error: 'Failed to get email status'
    });
  }
};

module.exports = {
  sendTestEmail,
  getEmailStatus
};
