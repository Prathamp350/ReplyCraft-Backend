/**
 * Email Service
 * Handles all transactional emails using Nodemailer
 */

const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

// Create transporter
const createTransporter = () => {
  const config = {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  };

  // If SMTP credentials are not configured, return null transporter (for dev)
  if (!config.auth.user || !config.auth.pass) {
    logger.warn('Email service: SMTP not configured, emails will be logged only');
    return null;
  }

  return nodemailer.createTransport(config);
};

const transporter = createTransporter();

/**
 * Send an email
 */
async function sendEmail(to, subject, html, text) {
  const from = process.env.EMAIL_FROM || 'ReplyCraft <noreply@replycraft.ai>';
  
  const mailOptions = {
    from,
    to,
    subject,
    html,
    text: text || html.replace(/<[^>]*>/g, '')
  };

  // If no transporter, just log the email
  if (!transporter) {
    logger.info('[Email] Would send email', {
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
 * Send welcome email to new users
 */
async function sendWelcomeEmail(user) {
  const subject = 'Welcome to ReplyCraft! 🚀';
  
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0;">
        <h1 style="color: white; margin: 0; font-size: 28px;">Welcome to ReplyCraft! 🎉</h1>
      </div>
      
      <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px;">
        <p style="font-size: 18px;">Hi ${user.name || 'there'},</p>
        
        <p>Thank you for joining <strong>ReplyCraft</strong>! We're excited to help you automate your customer review responses.</p>
        
        <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3 style="margin-top: 0; color: #667eea;">Here's what you can do:</h3>
          <ul style="margin: 0; padding-left: 20px;">
            <li>🤖 <strong>AI-Powered Replies</strong> - Generate professional responses instantly</li>
            <li>📊 <strong>Analytics Dashboard</strong> - Track your reviews and reputation</li>
            <li>🔗 <strong>Google Integration</strong> - Connect your Business Profile</li>
            <li>⚡ <strong>Automation</strong> - Set up automatic replies to reviews</li>
          </ul>
        </div>
        
        <p>Your current plan: <strong style="color: #667eea;">${user.plan || 'Free'}</strong></p>
        <p>Daily AI generation limit: <strong>${user.dailyUsage?.limit || 5}</strong> replies</p>
        
        <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/dashboard" 
           style="display: inline-block; background: #667eea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 25px; margin-top: 20px;">
          Get Started →
        </a>
        
        <p style="margin-top: 30px; color: #666; font-size: 14px;">
          Need help? Just reply to this email - we're here to help!
        </p>
        
        <p style="margin-top: 20px;">
          Best regards,<br>
          <strong>The ReplyCraft Team</strong>
        </p>
      </div>
      
      <div style="text-align: center; padding: 20px; color: #999; font-size: 12px;">
        <p>© ${new Date().getFullYear()} ReplyCraft. All rights reserved.</p>
      </div>
    </body>
    </html>
  `;

  return sendEmail(user.email, subject, html);
}

/**
 * Send daily limit reached email
 */
async function sendLimitReachedEmail(user) {
  const subject = 'Daily AI Limit Reached ⚠️';
  
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: #f59e0b; padding: 30px; border-radius: 10px 10px 0 0;">
        <h1 style="color: white; margin: 0; font-size: 24px;">Daily AI Limit Reached 📊</h1>
      </div>
      
      <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px;">
        <p style="font-size: 18px;">Hi ${user.name || 'there'},</p>
        
        <p>You've reached your daily AI generation limit for today. Don't worry - your limit will reset at midnight!</p>
        
        <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #f59e0b;">
          <h3 style="margin-top: 0; color: #333;">Your Usage:</h3>
          <p style="margin: 5px 0;">Used: <strong>${user.dailyUsage?.used || 0}</strong> / <strong>${user.dailyUsage?.limit || 5}</strong></p>
          <p style="margin: 5px 0;">Remaining: <strong>${user.dailyUsage?.remaining || 0}</strong></p>
        </div>
        
        <p>Need more generations? Consider upgrading your plan!</p>
        
        <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/dashboard/upgrade" 
           style="display: inline-block; background: #f59e0b; color: white; padding: 12px 30px; text-decoration: none; border-radius: 25px; margin-top: 10px;">
          View Plans →
        </a>
        
        <p style="margin-top: 30px; color: #666; font-size: 14px;">
          Your limit will reset at midnight. Thanks for using ReplyCraft!
        </p>
      </div>
    </body>
    </html>
  `;

  return sendEmail(user.email, subject, html);
}

/**
 * Send integration connected email
 */
async function sendIntegrationConnectedEmail(user, platform) {
  const platformName = platform === 'google' ? 'Google Business Profile' : platform;
  const subject = `${platformName} Connected! ✅`;
  
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: #10b981; padding: 30px; border-radius: 10px 10px 0 0;">
        <h1 style="color: white; margin: 0; font-size: 24px;">${platformName} Connected! 🎉</h1>
      </div>
      
      <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px;">
        <p style="font-size: 18px;">Hi ${user.name || 'there'},</p>
        
        <p>Great news! Your <strong>${platformName}</strong> account has been successfully connected to ReplyCraft.</p>
        
        <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #10b981;">
          <h3 style="margin-top: 0; color: #333;">What's Next:</h3>
          <ul style="margin: 0; padding-left: 20px;">
            <li>📥 We'll automatically fetch new reviews</li>
            <li>🤖 AI will generate professional replies</li>
            <li>✅ You can approve or edit before posting</li>
            <li>📊 Track everything from your dashboard</li>
          </ul>
        </div>
        
        <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/dashboard/integrations" 
           style="display: inline-block; background: #10b981; color: white; padding: 12px 30px; text-decoration: none; border-radius: 25px; margin-top: 20px;">
          View Integrations →
        </a>
        
        <p style="margin-top: 30px; color: #666; font-size: 14px;">
          You can manage your connected accounts at any time from the Integrations page.
        </p>
      </div>
    </body>
    </html>
  `;

  return sendEmail(user.email, subject, html);
}

/**
 * Send password reset email
 */
async function sendPasswordResetEmail(user, resetToken) {
  const subject = 'Reset Your ReplyCraft Password 🔐';
  const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/reset-password?token=${resetToken}`;
  
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: #667eea; padding: 30px; border-radius: 10px 10px 0 0;">
        <h1 style="color: white; margin: 0; font-size: 24px;">Reset Your Password</h1>
      </div>
      
      <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px;">
        <p>Hi ${user.name || 'there'},</p>
        
        <p>We received a request to reset your password. Click the button below to create a new password:</p>
        
        <a href="${resetUrl}" 
           style="display: inline-block; background: #667eea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 25px; margin: 20px 0;">
          Reset Password →
        </a>
        
        <p style="color: #666; font-size: 14px;">
          This link will expire in 1 hour.<br>
          If you didn't request this, please ignore this email.
        </p>
      </div>
    </body>
    </html>
  `;

  return sendEmail(user.email, subject, html);
}

module.exports = {
  sendEmail,
  sendWelcomeEmail,
  sendLimitReachedEmail,
  sendIntegrationConnectedEmail,
  sendPasswordResetEmail
};
