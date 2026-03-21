const { sendMail } = require('./mailService');
const { noreplyTransporter } = require('./transporter');

const BILLING_FROM = 'ReplyCraft Billing <no-reply@replycraft.co.in>';

async function sendBillingEmail(to, subject, html, text = null) {
  return sendMail({ transporter: noreplyTransporter, to, subject, html, text, from: BILLING_FROM });
}

module.exports = {
  sendBillingEmail
};
