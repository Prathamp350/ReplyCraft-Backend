/**
 * Email Service Wrappers
 * This file acts as a re-exporter for the new modular email services
 * to maintain backward compatibility with existing backend routes.
 */

const { sendPasswordResetEmail, sendAuthEmail } = require('./email/authMail');
const { sendWelcomeEmail, sendLimitReachedEmail, sendIntegrationConnectedEmail, sendSystemEmail } = require('./email/systemMail');
const { sendSupportEmail } = require('./email/supportMail');
const { sendBillingEmail } = require('./email/billingMail');
const { sendMail } = require('./email/mailService');

// This acts as a generic dispatcher if older routes use it.
const sendEmail = async (to, subject, html, text = null, type = 'system') => {
  if (type === 'auth') return sendAuthEmail(to, subject, html, text);
  if (type === 'support') return sendSupportEmail(to, subject, html, text);
  if (type === 'billing' || type === 'payment') return sendBillingEmail(to, subject, html, text);
  
  return sendSystemEmail(to, subject, html, text);
};

module.exports = {
  sendEmail,
  sendWelcomeEmail,
  sendLimitReachedEmail,
  sendIntegrationConnectedEmail,
  sendPasswordResetEmail,
  sendSupportEmail,
  sendBillingEmail
};
