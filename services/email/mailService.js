const logger = require('../../utils/logger');

const MAX_RETRIES = 3;
const RETRY_DELAY = 1500; // 1.5 seconds

/**
 * Send an email using a specific transporter with retry logic
 */
async function sendMail({ transporter, to, subject, html, text, from }) {
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

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt === 1) {
        // Verify only on the first attempt to confirm connection
        await transporter.verify();
      }

      console.log("Sending email:", {
        from: mailOptions.from,
        user: transporter.options.auth.user
      });

      const info = await transporter.sendMail(mailOptions);
      logger.info('Email sent successfully', {
        messageId: info.messageId,
        accepted: info.accepted,
        rejected: info.rejected,
        response: info.response,
        to,
        subject,
        from,
        attempt
      });
      return { success: true, messageId: info.messageId };
    } catch (error) {
      logger.error(`Failed to send email (Attempt ${attempt}/${MAX_RETRIES})`, {
        error: error.message,
        to,
        subject,
        from
      });
      if (attempt === MAX_RETRIES) {
        return { success: false, error: error.message };
      }
      // Wait before next attempt
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
    }
  }
}

module.exports = { sendMail };
