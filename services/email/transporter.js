const nodemailer = require('nodemailer');
const logger = require('../../utils/logger');

const createTransporter = () => {
  const config = {
    host: process.env.SMTP_HOST || 'smtp.zoho.in',
    port: parseInt(process.env.SMTP_PORT) || 465,
    secure: process.env.SMTP_SECURE === 'true' || true,
    auth: {
      user: process.env.SMTP_USER || 'auth@replycraft.co.in',
      pass: process.env.SMTP_PASS
    }
  };

  if (!config.auth.user || !config.auth.pass) {
    logger.warn('Email service: SMTP not configured, emails will be logged only');
    return null;
  }

  return nodemailer.createTransport(config);
};

const transporter = createTransporter();

module.exports = transporter;
