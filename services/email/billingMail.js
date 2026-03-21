const { sendMail } = require('./mailService');

const BILLING_FROM = 'ReplyCraft Billing <billing@replycraft.co.in>';

async function sendBillingEmail(to, subject, html, text = null) {
  return sendMail({ to, subject, html, text, from: BILLING_FROM });
}

module.exports = {
  sendBillingEmail
};
