const logger = require('../utils/logger');

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

const isTurnstileEnabled = () => {
  if (process.env.TURNSTILE_ENABLED === 'true') return true;
  if (process.env.TURNSTILE_ENABLED === 'false') return false;
  return process.env.NODE_ENV === 'production' && Boolean(process.env.TURNSTILE_SECRET_KEY);
};

const getClientIp = (req) => {
  const forwardedFor = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'];
  if (Array.isArray(forwardedFor)) return forwardedFor[0];
  if (typeof forwardedFor === 'string') return forwardedFor.split(',')[0].trim();
  return req.ip;
};

const verifyTurnstileToken = async ({ token, remoteIp, expectedAction }) => {
  const secret = process.env.TURNSTILE_SECRET_KEY;

  if (!secret) {
    throw new Error('TURNSTILE_SECRET_KEY is required when Turnstile is enabled');
  }

  const body = new URLSearchParams({
    secret,
    response: token,
  });

  if (remoteIp) {
    body.set('remoteip', remoteIp);
  }

  const response = await fetch(VERIFY_URL, {
    method: 'POST',
    body,
  });

  if (!response.ok) {
    throw new Error(`Turnstile verification failed with HTTP ${response.status}`);
  }

  const result = await response.json();

  if (!result.success) {
    return {
      ok: false,
      reason: Array.isArray(result['error-codes']) ? result['error-codes'].join(', ') : 'challenge_failed',
    };
  }

  if (expectedAction && result.action && result.action !== expectedAction) {
    return {
      ok: false,
      reason: 'challenge_action_mismatch',
    };
  }

  return { ok: true };
};

const requireTurnstile = (expectedAction) => async (req, res, next) => {
  if (!isTurnstileEnabled()) {
    return next();
  }

  const token = req.body?.cfTurnstileToken || req.headers['x-turnstile-token'];

  if (!token || typeof token !== 'string') {
    return res.status(400).json({
      success: false,
      error: 'Security check required. Please complete the captcha and try again.',
    });
  }

  try {
    const result = await verifyTurnstileToken({
      token,
      remoteIp: getClientIp(req),
      expectedAction,
    });

    if (!result.ok) {
      logger.warn('Turnstile challenge rejected', {
        action: expectedAction,
        reason: result.reason,
        path: req.originalUrl,
      });
      return res.status(403).json({
        success: false,
        error: 'Captcha verification failed. Please refresh and try again.',
      });
    }

    return next();
  } catch (error) {
    logger.error('Turnstile verification error', {
      action: expectedAction,
      error: error.message,
      path: req.originalUrl,
    });
    return res.status(503).json({
      success: false,
      error: 'Security check is temporarily unavailable. Please try again shortly.',
    });
  }
};

module.exports = {
  requireTurnstile,
  verifyTurnstileToken,
};
