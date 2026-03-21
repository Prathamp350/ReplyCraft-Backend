const { sendMail } = require('./mailService');
const { noreplyTransporter } = require('./transporter');

async function sendBillingEmail(to, subject, html, text = null) {
  return sendMail({ transporter: noreplyTransporter, to, subject, html, text, from: process.env.NOREPLY_EMAIL_FROM });
}

module.exports = {
  sendBillingEmail
};
