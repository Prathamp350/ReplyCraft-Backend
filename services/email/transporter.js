const nodemailer = require('nodemailer');

const createConfig = (userParam, passParam) => {
  return {
    host: process.env.SMTP_HOST || 'smtp.zoho.in',
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: false,
    requireTLS: true,
    auth: {
      user: process.env[userParam],
      pass: process.env[passParam]
    },
    logger: true,
    debug: true
  };
};

const authTransporter = nodemailer.createTransport(createConfig('AUTH_EMAIL_USER', 'AUTH_EMAIL_PASS'));
const supportTransporter = nodemailer.createTransport(createConfig('SUPPORT_EMAIL_USER', 'SUPPORT_EMAIL_PASS'));
const noreplyTransporter = nodemailer.createTransport(createConfig('NOREPLY_EMAIL_USER', 'NOREPLY_EMAIL_PASS'));

module.exports = {
  authTransporter,
  supportTransporter,
  noreplyTransporter
};
