const jwt = require('jsonwebtoken');
const User = require('../models/User');
const config = require('../config/config');
const logger = require('../utils/logger');
const { queueWelcomeEmail, queueOtpEmail } = require('../queues/email.queue');
const { OAuth2Client } = require('google-auth-library');
const { validatePassword } = require('../utils/validators');
const {
  logAccessEvent,
  detectSuspiciousLogin,
  getRequestIp,
  getUserAgent,
} = require('../services/auditLog.service');

const googleClient = new OAuth2Client(process.env.VITE_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID);

const getJwtConfig = () => ({
  secret: config?.jwt?.secret || process.env.JWT_SECRET,
  expiresIn: config?.jwt?.expiresIn || process.env.JWT_EXPIRES_IN || '7d',
});

/**
 * Generate a 6-digit OTP
 */
const generateOtp = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

/**
 * Google Login - Exchange Google ID token for JWT
 */
const googleLogin = async (req, res) => {
  try {
    const { idToken } = req.body;

    if (!idToken) {
      await logAccessEvent({
        req,
        email: null,
        eventType: 'google_login_failed',
        status: 'failed',
        riskLevel: 'low',
        suspicious: false,
        loginMethod: 'google',
        reason: 'Missing Google ID token',
      });
      return res.status(400).json({
        success: false,
        error: 'Google ID token is required'
      });
    }

    // Verify the Google ID token
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: process.env.VITE_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const googleId = payload.sub;
    const email = payload.email;
    const name = payload.name;
    const avatarUrl = payload.picture;

    // Check if user exists by googleId or email
    let user = await User.findOne({ 
      $or: [
        { googleId: googleId },
        { email: email?.toLowerCase() }
      ]
    });

    if (!user) {
      // New user - create account
      logger.logAuth('New Google user signup', { googleId, email });

      user = new User({
        name: name || email.split('@')[0],
        email: email?.toLowerCase(),
        googleId: googleId,
        isEmailVerified: true, // Google verifies email
        avatarUrl: avatarUrl,
        plan: config.defaultPlan
      });

      await user.save();

      // Queue welcome email
      queueWelcomeEmail(user).catch(err => {
        logger.error('Failed to queue welcome email', { error: err.message });
      });
    } else {
      // Existing user - update googleId if not set
      if (!user.googleId) {
        user.googleId = googleId;
        user.isEmailVerified = true;
      }
      if (avatarUrl && !user.avatarUrl) {
          user.avatarUrl = avatarUrl;
      }

      await user.save();

      // Check if user is active
      if (!user.isActive) {
        return res.status(403).json({
          success: false,
          error: 'Account is deactivated'
        });
      }

      logger.logAuth('Google user logged in', { userId: user._id, googleId });
    }

    const suspiciousLogin = detectSuspiciousLogin(user, req);
    user.lastLoginAt = new Date();
    user.lastLoginIp = getRequestIp(req);
    user.lastLoginUserAgent = getUserAgent(req);
    user.lastLoginMethod = 'google';
    await user.save();

    await logAccessEvent({
      req,
      user,
      email: user.email,
      eventType: 'google_login_success',
      status: 'success',
      riskLevel: suspiciousLogin.riskLevel,
      suspicious: suspiciousLogin.suspicious,
      loginMethod: 'google',
      reason: suspiciousLogin.reason,
      metadata: suspiciousLogin.metadata,
    });

    // Generate JWT token for backend
    const jwtConfig = getJwtConfig();
    const token = jwt.sign(
      { userId: user._id, email: user.email },
      jwtConfig.secret,
      { expiresIn: jwtConfig.expiresIn }
    );

    // Return user data and token
    return res.status(200).json({
      success: true,
      message: 'Login successful',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        plan: user.plan,
        monthlyUsage: user.monthlyUsage,
        avatarUrl: user.avatarUrl,
        role: user.role,
        isOnboarded: user.isOnboarded
      },
      token
    });

  } catch (error) {
    logger.error('Google Login Error', { error: error.message, stack: error.stack });
    await logAccessEvent({
      req,
      email: req.body?.email || null,
      eventType: 'google_login_failed',
      status: 'failed',
      riskLevel: 'medium',
      suspicious: true,
      loginMethod: 'google',
      reason: error.message,
    });
    return res.status(500).json({
      success: false,
      error: 'Failed to login with Google'
    });
  }
};

/**
 * Register a new user and send OTP
 */
const register = async (req, res) => {
  try {
    const { name, email, password, plan } = req.body;

    // Validate required fields
    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Name, email and password are required'
      });
    }

    // Validate name
    if (name.trim().length < 1) {
      return res.status(400).json({
        success: false,
        error: 'Name is required'
      });
    }

    const passwordError = validatePassword(password);
    if (passwordError) {
      return res.status(400).json({
        success: false,
        error: passwordError
      });
    }

    // Check if user already exists
    // Check if user already exists
    let user = await User.findOne({ email: email.toLowerCase() });
    
    // Validate plan if provided
    const userPlan = plan && config.validPlans.includes(plan.toLowerCase()) 
      ? plan.toLowerCase() 
      : config.defaultPlan;

    const otp = generateOtp();
    const otpExpiresAt = new Date(Date.now() + 5 * 60000); // 5 minutes

    if (user) {
      if (user.isEmailVerified) {
        return res.status(400).json({
          success: false,
          error: 'Email already registered'
        });
      }
      
      // User exists but is not verified. Update their details and send a new OTP.
      user.name = name.trim();
      user.password = password; // Mongoose middleware will hash this
      user.plan = userPlan;
      user.otp = otp;
      user.otpExpiresAt = otpExpiresAt;
      await user.save();
      
      logger.logAuth('Unverified user re-registered, sending new OTP', { userId: user._id, email: user.email });
    } else {
      // Create new user
      user = new User({
        name: name.trim(),
        email: email.toLowerCase(),
        password,
        plan: userPlan,
        isEmailVerified: false,
        otp,
        otpExpiresAt
      });
      await user.save();
      logger.logAuth('User registered, pending OTP', { userId: user._id, email: user.email });
    }

    // Queue OTP email
    queueOtpEmail(user.email, user.name, otp, { ip: req.ip, userAgent: req.headers['user-agent'] }).catch(err => {
      logger.error('Failed to queue OTP email', { error: err.message, userId: user._id });
    });

    // Return success response (no token yet)
    return res.status(201).json({
      success: true,
      message: 'Registration successful. Please verify OTP sent to your email.',
    });

  } catch (error) {
    logger.error('Register Error', { error: error.message, stack: error.stack });
    
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(e => e.message);
      return res.status(400).json({
        success: false,
        error: messages.join(', ')
      });
    }

    return res.status(500).json({
      success: false,
      error: 'Failed to register user'
    });
  }
};

/**
 * Login user and send OTP
 */
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate required fields
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email and password are required'
      });
    }

    // Find user by email (include password for comparison)
    const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
    
    if (!user) {
      logger.logAuth('Login failed - user not found', { email: email.toLowerCase() });
      await logAccessEvent({
        req,
        email: email.toLowerCase(),
        eventType: 'login_failed',
        status: 'failed',
        riskLevel: 'medium',
        suspicious: true,
        loginMethod: 'password',
        reason: 'User not found',
      });
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password'
      });
    }

    // Check if account is locked
    if (user.lockUntil && user.lockUntil > new Date()) {
      await logAccessEvent({
        req,
        user,
        email: user.email,
        eventType: 'login_blocked',
        status: 'blocked',
        riskLevel: 'high',
        suspicious: true,
        loginMethod: 'password',
        reason: 'Account is currently locked',
      });
      return res.status(403).json({
        success: false,
        error: 'Account locked due to too many failed attempts. Please reset your password.',
        requires_reset: true
      });
    }

    // Check if user is active
    if (!user.isActive) {
      logger.logAuth('Login failed - account deactivated', { userId: user._id });
      await logAccessEvent({
        req,
        user,
        email: user.email,
        eventType: 'login_blocked',
        status: 'blocked',
        riskLevel: 'medium',
        suspicious: true,
        loginMethod: 'password',
        reason: 'Account is deactivated',
      });
      return res.status(403).json({
        success: false,
        error: 'Account is deactivated'
      });
    }

    // If Google login user tries to login with email/password but no password was set
    if (!user.password && user.googleId) {
       return res.status(400).json({
         success: false,
         error: 'Please login using Continue with Google'
       });
    }

    // Compare password
    const isMatch = await user.comparePassword(password);
    
    if (!isMatch) {
      user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;
      
      if (user.failedLoginAttempts >= 3) {
        // Lock until midnight of next day
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);
        user.lockUntil = tomorrow;
        await user.save();
        
        logger.logAuth('Account locked (3 failed attempts)', { userId: user._id });
        await logAccessEvent({
          req,
          user,
          email: user.email,
          eventType: 'account_locked',
          status: 'blocked',
          riskLevel: 'high',
          suspicious: true,
          loginMethod: 'password',
          reason: 'Too many failed login attempts',
          metadata: {
            failedLoginAttempts: user.failedLoginAttempts,
          },
        });
        return res.status(403).json({
          success: false,
          error: 'Account locked due to too many failed attempts. Please reset your password.',
          requires_reset: true
        });
      }
      
      await user.save();
      logger.logAuth('Login failed - invalid password', { userId: user._id });
      await logAccessEvent({
        req,
        user,
        email: user.email,
        eventType: 'login_failed',
        status: 'failed',
        riskLevel: user.failedLoginAttempts >= 2 ? 'medium' : 'low',
        suspicious: user.failedLoginAttempts >= 2,
        loginMethod: 'password',
        reason: 'Invalid password',
        metadata: {
          failedLoginAttempts: user.failedLoginAttempts,
        },
      });
      return res.status(401).json({
        success: false,
        error: `Invalid email or password. ${3 - user.failedLoginAttempts} attempts remaining.`
      });
    }

    // Success - reset attempts
    if (user.failedLoginAttempts > 0 || user.lockUntil) {
      user.failedLoginAttempts = 0;
      user.lockUntil = null;
    }

    // Generate new OTP
    const otp = generateOtp();
    user.otp = otp;
    user.otpExpiresAt = new Date(Date.now() + 5 * 60000); // 5 mins
    await user.save();

    logger.logAuth('User initiated login, OTP sent', { userId: user._id, email: user.email });
    await logAccessEvent({
      req,
      user,
      email: user.email,
      eventType: 'otp_sent',
      status: 'success',
      riskLevel: 'low',
      suspicious: false,
      loginMethod: 'password',
      reason: 'Password login passed and OTP was sent',
    });

    // Queue OTP email
    queueOtpEmail(user.email, user.name, otp, { ip: req.ip, userAgent: req.headers['user-agent'] }).catch(err => {
      logger.error('Failed to queue OTP email during login', { error: err.message, userId: user._id });
    });

    // Return success response indicating OTP sent
    return res.status(200).json({
      success: true,
      message: 'OTP sent to your email',
    });

  } catch (error) {
    logger.error('Login Error', { error: error.message, stack: error.stack });
    await logAccessEvent({
      req,
      email: req.body?.email || null,
      eventType: 'login_error',
      status: 'failed',
      riskLevel: 'medium',
      suspicious: true,
      loginMethod: 'password',
      reason: error.message,
    });
    return res.status(500).json({
      success: false,
      error: 'Failed to login'
    });
  }
};

/**
 * Verify OTP
 */
const verifyOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ success: false, error: 'Email and OTP are required' });
    }

    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user) {
      return res.status(400).json({ success: false, error: 'Invalid operation' });
    }

    if (user.otp !== otp || !user.otpExpiresAt || user.otpExpiresAt < new Date()) {
      return res.status(400).json({ success: false, error: 'Invalid or expired OTP' });
    }

    // Mark email as verified if not already
    let newlyVerified = false;
    if (!user.isEmailVerified) {
      user.isEmailVerified = true;
      newlyVerified = true;
    }

    // Only queue welcome email if this is a brand new account (created within the last 10 minutes)
    // This prevents legacy accounts with missing isEmailVerified flags from getting welcome emails on login
    const isNewAccount = user.createdAt && (new Date() - new Date(user.createdAt) < 600000);

    // Clear OTP fields
    user.otp = null;
    user.otpExpiresAt = null;

    // Check and reset daily usage if needed
    user.checkMonthlyLimit();
    const suspiciousLogin = detectSuspiciousLogin(user, req);
    user.lastLoginAt = new Date();
    user.lastLoginIp = getRequestIp(req);
    user.lastLoginUserAgent = getUserAgent(req);
    user.lastLoginMethod = 'otp';
    await user.save();

    await logAccessEvent({
      req,
      user,
      email: user.email,
      eventType: 'login_success',
      status: 'success',
      riskLevel: suspiciousLogin.riskLevel,
      suspicious: suspiciousLogin.suspicious,
      loginMethod: 'otp',
      reason: suspiciousLogin.reason || 'OTP verified successfully',
      metadata: suspiciousLogin.metadata,
    });

    if (newlyVerified && isNewAccount) {
      // Queue welcome email asynchronously
      queueWelcomeEmail(user).catch(err => {
        logger.error('Failed to queue welcome email', { error: err.message });
      });
    }

    // Generate JWT token
    const jwtConfig = getJwtConfig();
    const token = jwt.sign(
      { userId: user._id, email: user.email },
      jwtConfig.secret,
      { expiresIn: jwtConfig.expiresIn }
    );

    logger.logAuth('User verified OTP and logged in', { userId: user._id, email: user.email });

    return res.status(200).json({
      success: true,
      message: 'Verification successful',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        plan: user.plan,
        monthlyUsage: user.monthlyUsage,
        avatarUrl: user.avatarUrl,
        role: user.role,
        isOnboarded: user.isOnboarded
      },
      token
    });
  } catch (error) {
    logger.error('Verify OTP Error', { error: error.message, stack: error.stack });
    await logAccessEvent({
      req,
      email: req.body?.email || null,
      eventType: 'otp_verify_failed',
      status: 'failed',
      riskLevel: 'medium',
      suspicious: true,
      loginMethod: 'otp',
      reason: error.message,
    });
    return res.status(500).json({ success: false, error: 'Failed to verify OTP' });
  }
};

/**
 * Resend OTP
 */
const resendOtp = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, error: 'Email is required' });
    }

    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user) {
      // Return 200 to prevent email enumeration
      return res.status(200).json({ success: true, message: 'If the email exists, an OTP will be sent.' });
    }

    // Generate new OTP
    const otp = generateOtp();
    user.otp = otp;
    user.otpExpiresAt = new Date(Date.now() + 5 * 60000); // 5 mins
    await user.save();

    logger.logAuth('Resent OTP', { userId: user._id, email: user.email });

    // Queue OTP email
    queueOtpEmail(user.email, user.name, otp, { ip: req.ip, userAgent: req.headers['user-agent'] }, 'resend-otp').catch(err => {
      logger.error('Failed to queue OTP email during resend', { error: err.message, userId: user._id });
    });

    return res.status(200).json({ success: true, message: 'OTP sent' });
  } catch (error) {
    logger.error('Resend OTP Error', { error: error.message, stack: error.stack });
    return res.status(500).json({ success: false, error: 'Failed to resend OTP' });
  }
};

/**
 * Get current authenticated user
 */
const getCurrentUser = async (req, res) => {
  try {
    // req.user is already attached by auth middleware
    const user = req.user;
    
    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    return res.status(200).json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        plan: user.plan,
        monthlyUsage: user.monthlyUsage,
        avatarUrl: user.avatarUrl,
        phoneNumber: user.phoneNumber,
        businessName: user.businessName,
        timezone: user.timezone,
        address: user.address,
        city: user.city,
        country: user.country,
        dob: user.dob,
        role: user.role,
        isOnboarded: user.isOnboarded,
        stripeCustomerId: user.stripeCustomerId,
        subscriptionStatus: user.subscriptionStatus,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      }
    });
  } catch (error) {
    logger.error('Get Current User Error', { error: error.message, userId: req.userId });
    return res.status(500).json({
      success: false,
      error: 'Failed to get user data'
    });
  }
};

/**
 * Forgot Password - Send OTP
 */
const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, error: 'Email is required' });
    }
    
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(200).json({ success: true, message: 'If the email exists, an OTP will be sent.' });
    }

    const otp = generateOtp();
    user.otp = otp;
    user.otpExpiresAt = new Date(Date.now() + 5 * 60000);
    await user.save();

    queueOtpEmail(user.email, user.name, otp, { ip: req.ip, userAgent: req.headers['user-agent'] }, 'password-reset').catch(err => {
      logger.error('Failed to queue OTP email for forgot password', { error: err.message });
    });

    return res.status(200).json({ success: true, message: 'OTP sent' });
  } catch (error) {
    logger.error('Forgot Password Error', { error: error.message, stack: error.stack });
    return res.status(500).json({ success: false, error: 'Failed to process request' });
  }
};

/**
 * Reset Password
 */
const resetPassword = async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;

    if (!email || !otp || !newPassword) {
      return res.status(400).json({ success: false, error: 'Email, OTP, and new password are required' });
    }

    const passwordError = validatePassword(newPassword);
    if (passwordError) {
      return res.status(400).json({ success: false, error: passwordError });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(400).json({ success: false, error: 'Invalid operation' });
    }

    if (user.otp !== otp || !user.otpExpiresAt || user.otpExpiresAt < new Date()) {
      return res.status(400).json({ success: false, error: 'Invalid or expired OTP' });
    }

    // Reset password and clear locks
    user.password = newPassword;
    user.otp = null;
    user.otpExpiresAt = null;
    user.failedLoginAttempts = 0;
    user.lockUntil = null;
    await user.save();

    logger.logAuth('Password reset successfully', { userId: user._id });

    return res.status(200).json({ success: true, message: 'Password reset successfully' });
  } catch (error) {
    logger.error('Reset Password Error', { error: error.message, stack: error.stack });
    return res.status(500).json({ success: false, error: 'Failed to reset password' });
  }
};

module.exports = {
  googleLogin,
  register,
  login,
  verifyOtp,
  resendOtp,
  getCurrentUser,
  forgotPassword,
  resetPassword
};
