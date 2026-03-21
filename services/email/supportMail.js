const { sendMail } = require('./mailService');
const { supportTransporter } = require('./transporter');

async function sendSupportEmail(to, subject, html, text = null) {
  return sendMail({ transporter: supportTransporter, to, subject, html, text, from: process.env.SUPPORT_EMAIL_FROM });
}

module.exports = {
  sendSupportEmail
};
