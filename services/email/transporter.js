const nodemailer = require('nodemailer');

const createConfig = (userParam, passParam) => {
  return {
    host: process.env.SMTP_HOST || 'smtp.zoho.in',
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true', // false for STARTTLS on port 587
    auth: {
      user: process.env[userParam],
      pass: process.env[passParam]
    },
    tls: {
      rejectUnauthorized: false
    },
    logger: true,
    debug: true
  };
};

const authTransporter = nodemailer.createTransport(createConfig('ZOHO_AUTH_USER', 'ZOHO_AUTH_PASS'));
const supportTransporter = nodemailer.createTransport(createConfig('ZOHO_SUPPORT_USER', 'ZOHO_SUPPORT_PASS'));
const noreplyTransporter = nodemailer.createTransport(createConfig('ZOHO_NOREPLY_USER', 'ZOHO_NOREPLY_PASS'));

module.exports = {
  authTransporter,
  supportTransporter,
  noreplyTransporter
};
