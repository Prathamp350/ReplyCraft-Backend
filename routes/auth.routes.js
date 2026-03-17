const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');

// POST /api/auth/google-login - Google authentication (new)
router.post('/google-login', authController.googleLogin);

// GET /api/auth/me - Get current user (requires authentication)
router.get('/me', require('../middleware/auth.middleware').authenticate, authController.getCurrentUser);

// POST /api/auth/register - Register new user and send OTP
router.post('/register', authController.register);

// POST /api/auth/login - Login user and send OTP
router.post('/login', authController.login);

// POST /api/auth/verify-otp - Verify OTP and login
router.post('/verify-otp', authController.verifyOtp);

// POST /api/auth/resend-otp - Resend OTP
router.post('/resend-otp', authController.resendOtp);

// POST /api/auth/forgot-password - Send OTP for password reset
router.post('/forgot-password', authController.forgotPassword);

// POST /api/auth/reset-password - Reset password with OTP
router.post('/reset-password', authController.resetPassword);

module.exports = router;
