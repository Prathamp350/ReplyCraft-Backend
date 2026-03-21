const nodemailer = require('nodemailer');
const logger = require('../../utils/logger');

const transporter = nodemailer.createTransport({
  host: "smtp.zoho.in",
  port: 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  },
  tls: {
    rejectUnauthorized: false
  },
  logger: true,
  debug: true
});

module.exports = transporter;
