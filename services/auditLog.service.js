const AuditLog = require('../models/AuditLog');
const logger = require('../utils/logger');

const getRequestIp = (req) =>
  req?.ip ||
  req?.headers?.['x-forwarded-for']?.split(',')?.[0]?.trim() ||
  req?.connection?.remoteAddress ||
  null;

const getUserAgent = (req) => String(req?.headers?.['user-agent'] || '');

async function logAccessEvent({
  req,
  user = null,
  email = null,
  eventType,
  status = 'success',
  riskLevel = 'low',
  suspicious = false,
  loginMethod = null,
  reason = '',
  metadata = {},
}) {
  try {
    await AuditLog.create({
      userId: user?._id || null,
      email: (email || user?.email || null)?.toLowerCase?.() || null,
      eventType,
      status,
      riskLevel,
      suspicious,
      loginMethod,
      ipAddress: getRequestIp(req),
      userAgent: getUserAgent(req),
      reason,
      metadata,
    });
  } catch (error) {
    logger.error('Failed to persist audit log', { error: error.message, eventType, email });
  }
}

function detectSuspiciousLogin(user, req) {
  const currentIp = getRequestIp(req);
  const userAgent = getUserAgent(req);

  const previousIp = user?.lastLoginIp || null;
  const previousAgent = user?.lastLoginUserAgent || '';

  const ipChanged = !!(previousIp && currentIp && previousIp !== currentIp);
  const userAgentChanged = !!(previousAgent && userAgent && previousAgent !== userAgent);

  if (ipChanged) {
    return {
      suspicious: true,
      riskLevel: 'medium',
      reason: 'Login from a new IP address',
      metadata: {
        previousIp,
        currentIp,
        previousUserAgent: previousAgent,
        currentUserAgent: userAgent,
        userAgentChanged,
      },
    };
  }

  return {
    suspicious: false,
    riskLevel: 'low',
    reason: '',
    metadata: {
      currentIp,
      currentUserAgent: userAgent,
      userAgentChanged,
    },
  };
}

module.exports = {
  logAccessEvent,
  detectSuspiciousLogin,
  getRequestIp,
  getUserAgent,
};
