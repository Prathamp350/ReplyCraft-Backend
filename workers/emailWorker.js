/**
 * Email Worker
 * Processes email jobs from the queue using the modular email system
 */

const { Worker } = require('bullmq');
const IORedis = require('ioredis');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const createRedisConnection = require('../config/redis');
const { startBullWorker } = require('./utils/startBullWorker');

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
    case 'supportAiReply':
      return {
        transporter: supportTransporter,
        from: process.env.SUPPORT_EMAIL_FROM
      };
    case 'welcome':
    case 'limitReached':
    case 'integrationConnected':
    case 'marketingBroadcast':
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
    case 'planUpgrade':
      subject = `Your ReplyCraft ${data.planName || 'Plan'} Plan is Active`;
      templateName = 'planUpgrade';
      break;
    case 'subscriptionActivated':
      subject = `Your ReplyCraft ${data.planName || 'Plan'} subscription is active`;
      templateName = 'subscriptionActivated';
      break;
    case 'subscriptionCanceled':
      subject = 'Your ReplyCraft subscription has been canceled';
      templateName = 'subscriptionCanceled';
      break;
    case 'subscriptionReminder':
      subject = `Your ReplyCraft plan ends in ${data.daysRemaining || 10} days`;
      templateName = 'subscriptionReminder';
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

  if (type === 'marketingBroadcast') {
    subject = data.subject || 'ReplyCraft Update';
    templateName = 'marketingBroadcast';
    templateData = {
      ...templateData,
      subject: data.subject || 'ReplyCraft Update',
      preheader: data.preheader || 'A new update from ReplyCraft.',
      supportEmail: process.env.SUPPORT_EMAIL || 'support@replycraft.co.in',
      messageHtml: String(data.messageHtml || '').replace(/\n/g, '<br />'),
    };
  }
  
  if (type === 'supportAiReply') {
    subject = data.subject || 'ReplyCraft Support Update';
    templateName = 'supportAiReply';
    templateData = {
      ...templateData,
      subject,
      ticketId: data.ticketId || '',
      messageHtml: String(data.messageHtml || '').replace(/\n/g, '<br />'),
    };
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

let emailWorker = null;

const createEmailWorker = () => {
  if (emailWorker) {
    return emailWorker;
  }

  emailWorker = new Worker('email', async (job) => {
    return await processEmailJob(job);
  }, {
    connection,
    concurrency: 5,
    limiter: {
      max: 10,
      duration: 1000
    }
  });

  emailWorker.on('completed', (job) => {
    logger.info('Email job completed', { jobId: job.id, type: job.data.type });
  });

  emailWorker.on('failed', (job, err) => {
    logger.error('Email job failed', {
      jobId: job?.id,
      type: job?.data?.type,
      error: err.message
    });
  });

  emailWorker.on('error', (error) => {
    logger.error('Email worker error', { error: error.message });
  });

  logger.info('[EmailWorker] Email worker started', { concurrency: 5 });
  return emailWorker;
};

startBullWorker({
  label: 'EmailWorker',
  connection,
  createWorker: createEmailWorker,
});

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
