const { sendMail } = require('./mailService');

const AUTH_FROM = 'ReplyCraft Auth <auth@replycraft.co.in>';

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

  return sendMail({
    to: user.email,
    subject,
    html,
    from: AUTH_FROM
  });
}

async function sendAuthEmail(to, subject, html, text = null) {
  return sendMail({ to, subject, html, text, from: AUTH_FROM });
}

module.exports = {
  sendPasswordResetEmail,
  sendAuthEmail
};
