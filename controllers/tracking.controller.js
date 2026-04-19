const TrackingEvent = require('../models/TrackingEvent');
const ActiveSession = require('../models/ActiveSession');
const logger = require('../utils/logger');
const HEARTBEAT_SESSION_REFRESH_MS = 2 * 60 * 1000;

const countryNames = typeof Intl.DisplayNames === 'function'
  ? new Intl.DisplayNames(['en'], { type: 'region' })
  : null;

const normalizeCountryCode = (value) => {
  if (!value || typeof value !== 'string') return 'US';
  const normalized = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(normalized) ? normalized : 'US';
};

const resolveCountryName = (countryCode, fallbackCountry) => {
  if (fallbackCountry) return fallbackCountry;

  try {
    return countryNames?.of(countryCode) || countryCode;
  } catch (error) {
    return countryCode;
  }
};

const detectDeviceType = (userAgent = '', metadata = {}) => {
  if (metadata.deviceType) return metadata.deviceType;

  const normalizedAgent = String(userAgent).toLowerCase();
  if (/ipad|tablet/.test(normalizedAgent)) return 'tablet';
  if (/mobile|iphone|android/.test(normalizedAgent)) return 'mobile';
  return 'desktop';
};

const buildSessionSnapshot = (req, payload) => {
  const metadata = payload.metadata || {};
  const user = req.user || null;
  const countryCode = normalizeCountryCode(
    metadata.countryCode || req.headers['cf-ipcountry'] || user?.countryCode || 'US'
  );

  return {
    sessionId: payload.sessionId || `anonymous_${Date.now()}`,
    userId: req.userId || null,
    userName: user?.name || null,
    userEmail: user?.email || null,
    plan: user?.plan || 'free',
    subscriptionStatus: user?.subscriptionStatus || (user?.plan === 'free' ? 'free' : null),
    businessName: user?.businessName || metadata.businessName || null,
    pagePath: payload.pagePath || '/',
    referrer: payload.referrer || '',
    eventType: payload.eventType,
    ipAddress: req.clientIp || req.ip,
    userAgent: req.headers['user-agent'] || '',
    deviceType: detectDeviceType(req.headers['user-agent'], metadata),
    browserLanguage: metadata.language || req.headers['accept-language']?.split(',')[0] || null,
    timezone: metadata.timezone || user?.timezone || null,
    countryCode,
    country: resolveCountryName(countryCode, metadata.country || user?.country),
    state: metadata.state || user?.state || null,
    city: metadata.city || user?.city || null,
    screen: {
      width: Number(metadata.screenWidth) || null,
      height: Number(metadata.screenHeight) || null,
    },
    lastSeenAt: new Date(),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  };
};

const trackEvent = async (req, res) => {
  try {
    const {
      sessionId,
      eventType,
      pagePath,
      referrer,
      metadata,
      consent,
    } = req.body || {};

    if (!eventType) {
      return res.status(400).json({
        success: false,
        error: 'eventType is required'
      });
    }

    const analyticsConsent = Boolean(consent?.analytics);
    const normalizedEventType = String(eventType).trim().toLowerCase();
    const isHeartbeat = normalizedEventType === 'heartbeat';

    if (!analyticsConsent && normalizedEventType !== 'consent_updated') {
      return res.status(202).json({
        success: true,
        skipped: true
      });
    }

    const sessionSnapshot = buildSessionSnapshot(req, {
      sessionId,
      eventType,
      pagePath,
      referrer,
      metadata,
    });

    const sessionKey = {
      sessionId: sessionSnapshot.sessionId,
      userId: sessionSnapshot.userId || null,
    };

    if (isHeartbeat) {
      const existingSession = await ActiveSession.findOne(sessionKey).select('lastSeenAt');

      if (
        existingSession?.lastSeenAt &&
        Date.now() - new Date(existingSession.lastSeenAt).getTime() < HEARTBEAT_SESSION_REFRESH_MS
      ) {
        return res.status(202).json({ success: true, throttled: true });
      }
    } else {
      await TrackingEvent.create({
        userId: req.userId || null,
        sessionId: sessionSnapshot.sessionId,
        eventType: normalizedEventType,
        pagePath: pagePath || '/',
        referrer: referrer || '',
        metadata: {
          ...(metadata || {}),
          countryCode: sessionSnapshot.countryCode,
          country: sessionSnapshot.country,
          state: sessionSnapshot.state,
          city: sessionSnapshot.city,
          timezone: sessionSnapshot.timezone,
          deviceType: sessionSnapshot.deviceType,
        },
        consent: {
          essential: true,
          analytics: analyticsConsent
        },
        ipAddress: sessionSnapshot.ipAddress,
        userAgent: sessionSnapshot.userAgent
      });
    }

    await ActiveSession.findOneAndUpdate(
      sessionKey,
      sessionSnapshot,
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
      }
    );

    return res.status(201).json({ success: true });
  } catch (error) {
    logger.error('Track event error', { error: error.message, stack: error.stack });
    return res.status(500).json({
      success: false,
      error: 'Failed to track event'
    });
  }
};

module.exports = {
  trackEvent
};
