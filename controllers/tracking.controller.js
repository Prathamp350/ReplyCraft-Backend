const TrackingEvent = require('../models/TrackingEvent');
const logger = require('../utils/logger');

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

    if (!analyticsConsent && eventType !== 'consent_updated') {
      return res.status(202).json({
        success: true,
        skipped: true
      });
    }

    await TrackingEvent.create({
      userId: req.userId || null,
      sessionId: sessionId || null,
      eventType,
      pagePath: pagePath || '/',
      referrer: referrer || '',
      metadata: metadata || {},
      consent: {
        essential: true,
        analytics: analyticsConsent
      },
      ipAddress: req.clientIp || req.ip,
      userAgent: req.headers['user-agent'] || ''
    });

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
