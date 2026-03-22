/**
 * Email Worker
 * Processes email jobs from the queue using the modular email system
 */

const { Worker } = require('bullmq');
const IORedis = require('ioredis');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const config = require('../config/config');

const createRedisConnection = require('../config/redis');

// Import the modular transporter singletons
const { authTransporter, supportTransporter, noreplyTransporter } = require('../services/email/transporter');

// Get the cleaned, standardized Redis connection
const connection = createRedisConnection();

// Suppress connection errors — handled by retryStrategy in redis.js
connection.on('error', () => {});

// Template cache
const templates = {};

/**
 * Load email template
 */
function loadTemplate(templateName, data) {
  const templatePath = path.join(__dirname, '..', 'templates', 'emails', `${templateName}.html`);
  
  let template = templates[templateName];
  
  if (!template) {
    try {
      template = fs.readFileSync(templatePath, 'utf-8');
      templates[templateName] = template;
    } catch (error) {
      logger.error('Failed to load email template', { templateName, error: error.message });
      return null;
    }
  }
  
  // Replace placeholders
  let html = template;
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  
  // Common replacements
  html = html.replace(/{{frontendUrl}}/g, frontendUrl);
  html = html.replace(/{{year}}/g, new Date().getFullYear().toString());
  
  // Custom data replacements
  if (data) {
    Object.keys(data).forEach(key => {
      html = html.replace(new RegExp(`{{${key}}}`, 'g'), data[key] || '');
    });
  }
  
  return html;
}

/**
 * Get the correct transporter and FROM address based on email type
 */
function getTransporterForType(type) {
  switch (type) {
    case 'otp':
    case 'passwordReset':
    case 'verification':
    case 'login':
      return {
        transporter: authTransporter,
        from: process.env.AUTH_EMAIL_FROM
      };
    case 'ticketConfirmation':
    case 'support':
    case 'ticketReply':
      return {
        transporter: supportTransporter,
        from: process.env.SUPPORT_EMAIL_FROM
      };
    case 'welcome':
    case 'limitReached':
    case 'integrationConnected':
    case 'test':
    default:
      return {
        transporter: noreplyTransporter,
        from: process.env.NOREPLY_EMAIL_FROM
      };
  }
}

/**
 * Send email using the correct transporter
 */
async function sendEmail(to, subject, html, type) {
  const { transporter, from } = getTransporterForType(type);

  const mailOptions = {
    from,
    to,
    subject,
    html,
    text: html.replace(/<[^>]*>/g, '')
  };

  // Debug: confirm FROM matches transporter auth user
  console.log("ACTUAL FROM:", mailOptions.from);
  console.log("Sending email:", {
    from: mailOptions.from,
    user: transporter ? transporter.options.auth.user : 'NO_TRANSPORTER'
  });

  // If no transporter, just log
  if (!transporter) {
    logger.info('[Email] Would send email (mocked)', { to, subject, from });
    return { success: true, mocked: true };
  }

  try {
    await transporter.verify();
    const info = await transporter.sendMail(mailOptions);
    logger.info('Email sent successfully', {
      messageId: info.messageId,
      accepted: info.accepted,
      rejected: info.rejected,
      response: info.response,
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

/**
 * Process email job
 */
async function processEmailJob(job) {
  const { type, to, name, ...data } = job.data;
  
  logger.info('Processing email job', { type, to, jobId: job.id });
  
  let subject;
  let templateName;
  let templateData = { name, ...data };
  
  switch (type) {
    case 'welcome':
      subject = 'Welcome to ReplyCraft! 🚀';
      templateName = 'welcomeEmail';
      break;
    case 'limitReached':
      subject = 'Daily AI Limit Reached ⚠️';
      templateName = 'limitReached';
      break;
    case 'integrationConnected':
      subject = `${data.platform || 'Integration'} Connected! ✅`;
      templateName = 'integrationConnected';
      break;
    case 'test':
      subject = 'ReplyCraft Test Email ✅';
      templateName = 'welcomeEmail';
      break;
    case 'otp':
      if (data.reason === 'reset') {
        subject = 'Reset Your ReplyCraft Password 🔒';
        templateName = 'passwordReset';
      } else {
        subject = 'Your ReplyCraft Verification Code 🔒';
        templateName = 'otpEmail';
      }
      break;
    case 'ticketConfirmation':
      subject = `Support Ticket ${data.ticketId || ''} Created ✅`;
      templateName = 'ticketConfirmation';
      break;
    default:
      subject = 'ReplyCraft Notification';
      templateName = 'welcomeEmail';
  }
  
  const html = loadTemplate(templateName, templateData);
  
  if (!html) {
    throw new Error(`Failed to load template: ${templateName}`);
  }
  
  const result = await sendEmail(to, subject, html, type);
  
  if (!result.success && !result.mocked) {
    throw new Error(result.error);
  }
  
  return result;
}

// Create the email worker
const emailWorker = new Worker('email', async (job) => {
  return await processEmailJob(job);
}, {
  connection,
  concurrency: 5,
  limiter: {
    max: 10,
    duration: 1000
  }
});

// Worker events
emailWorker.on('completed', (job) => {
  logger.info('Email job completed', { jobId: job.id, type: job.data.type });
});

emailWorker.on('failed', (job, err) => {
  logger.error('Email job failed', { 
    jobId: job.id, 
    type: job.data.type,
    error: err.message 
  });
});

emailWorker.on('error', (error) => {
  logger.error('Email worker error', { error: error.message });
});

logger.info('[EmailWorker] Email worker started', { concurrency: 5 });

// Graceful shutdown
const gracefulShutdown = async () => {
  logger.info('Email worker shutting down...');
  await emailWorker.close();
  process.exit(0);
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

module.exports = {
  emailWorker,
  sendEmail,
  processEmailJob
};
