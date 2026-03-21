const { sendMail } = require('./mailService');
const { supportTransporter } = require('./transporter');

const SUPPORT_FROM = 'ReplyCraft Support <support@replycraft.co.in>';

async function sendSupportEmail(to, subject, html, text = null) {
  return sendMail({ transporter: supportTransporter, to, subject, html, text, from: SUPPORT_FROM });
}

module.exports = {
  sendSupportEmail
};
