/**
 * Email Configuration Validator
 * Validates email environment variables at startup
 */

const logger = require('../utils/logger');

const requiredVars = [
  'AUTH_EMAIL_USER',
  'AUTH_EMAIL_PASS',
  'AUTH_EMAIL_FROM',
  'SUPPORT_EMAIL_USER',
  'SUPPORT_EMAIL_PASS',
  'SUPPORT_EMAIL_FROM',
  'NOREPLY_EMAIL_USER',
  'NOREPLY_EMAIL_PASS',
  'NOREPLY_EMAIL_FROM'
];

/**
 * Validate email configuration
 */
function validateEmailConfig() {
  const missing = [];
  const present = [];
  
  requiredVars.forEach(varName => {
    const value = process.env[varName];
    if (!value) {
      missing.push(varName);
    } else {
      // Mask sensitive values in logs
      const displayValue = varName.includes('PASS') ? '***' : value;
      present.push(`${varName}: ${displayValue}`);
    }
  });
  
  if (missing.length > 0) {
    logger.warn('Email configuration incomplete', {
      missing,
      message: 'Some email environment variables are missing. Emails will be logged but not sent.'
    });
    return false;
  }
  
  logger.info('Email configuration validated', { vars: present });
  return true;
}

/**
 * Get email config status
 */
function getEmailConfigStatus() {
  const status = {
    configured: true,
    missing: []
  };
  
  requiredVars.forEach(varName => {
    if (!process.env[varName]) {
      status.configured = false;
      status.missing.push(varName);
    }
  });
  
  return status;
}

module.exports = {
  validateEmailConfig,
  getEmailConfigStatus,
  requiredVars
};
