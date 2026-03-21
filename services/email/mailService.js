const transporter = require('./transporter');
const logger = require('../../utils/logger');

/**
 * Send an email using the shared transporter
 */
async function sendMail({ to, subject, html, text, from }) {
  const mailOptions = {
    from,
    to,
    subject,
    html,
    text: text || html.replace(/<[^>]*>/g, '')
  };

  if (!transporter) {
    logger.info('[Email] Would send email (Mocked due to missing transporter)', {
      to,
      subject,
      from
    });
    return { success: true, mocked: true };
  }

  try {
    const info = await transporter.sendMail(mailOptions);
    logger.info('Email sent successfully', {
      messageId: info.messageId,
      to,
      subject,
      from
    });
    return { success: true, messageId: info.messageId };
  } catch (error) {
    logger.error('Failed to send email', {
      error: error.message,
      to,
      subject,
      from
    });
    return { success: false, error: error.message };
  }
}

module.exports = { sendMail };
