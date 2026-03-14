/**
 * Email Worker
 * Processes email jobs from the queue
 */

const { Worker } = require('bullmq');
const IORedis = require('ioredis');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const config = require('../config/config');

const createRedisConnection = require('../config/redis');

// Get the cleaned, standardized Redis connection
const connection = createRedisConnection();

connection.on('error', (err) => {
  logger.error('Redis connection error in email worker', { error: err.message });
});

// Create email transporter
const createTransporter = () => {
  const transporterConfig = {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  };

  // If SMTP credentials are not configured, return null
  if (!transporterConfig.auth.user || !transporterConfig.auth.pass) {
    logger.warn('Email worker: SMTP not configured, emails will be mocked');
    return null;
  }

  return nodemailer.createTransport(transporterConfig);
};

const transporter = createTransporter();

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
 * Send email
 */
async function sendEmail(to, subject, html) {
  const from = process.env.EMAIL_FROM || 'ReplyCraft <noreply@replycraft.ai>';
  
  const mailOptions = {
    from,
    to,
    subject,
    html,
    text: html.replace(/<[^>]*>/g, '')
  };

  // If no transporter, just log
  if (!transporter) {
    logger.info('[Email] Would send email', { to, subject, from });
    return { success: true, mocked: true };
  }

  try {
    const info = await transporter.sendMail(mailOptions);
    logger.info('Email sent successfully', {
      messageId: info.messageId,
      to,
      subject
    });
    return { success: true, messageId: info.messageId };
  } catch (error) {
    logger.error('Failed to send email', {
      error: error.message,
      to,
      subject
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
      templateName = 'welcomeEmail'; // Reuse welcome template for test
      break;
    case 'otp':
      subject = 'Your ReplyCraft Verification Code 🔒';
      templateName = 'otpEmail';
      break;
    default:
      subject = 'ReplyCraft Notification';
      templateName = 'welcomeEmail';
  }
  
  const html = loadTemplate(templateName, templateData);
  
  if (!html) {
    throw new Error(`Failed to load template: ${templateName}`);
  }
  
  const result = await sendEmail(to, subject, html);
  
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
