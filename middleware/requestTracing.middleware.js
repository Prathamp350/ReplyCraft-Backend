const crypto = require('crypto');
const logger = require('../utils/logger');
const { runWithRequestContext } = require('../utils/requestContext');
const { recordRequestStart, recordRequestComplete } = require('../utils/runtimeMetrics');

const shouldRedactPath = (path = '') => path.includes('/webhook');

const requestTracing = (req, res, next) => {
  const requestId = req.headers['x-request-id'] || crypto.randomUUID();
  const startedAt = process.hrtime.bigint();

  req.requestId = requestId;
  res.setHeader('x-request-id', requestId);

  runWithRequestContext(
    {
      requestId,
      method: req.method,
      path: req.path,
      route: req.originalUrl,
      clientIp: req.clientIp || req.ip,
    },
    () => {
      recordRequestStart({ method: req.method });

      res.on('finish', () => {
        const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
        recordRequestComplete({
          statusCode: res.statusCode,
          durationMs,
        });

        logger.http('HTTP request completed', {
          requestId,
          method: req.method,
          path: shouldRedactPath(req.path) ? '[redacted-webhook]' : req.path,
          route: shouldRedactPath(req.originalUrl) ? '[redacted-webhook]' : req.originalUrl,
          statusCode: res.statusCode,
          durationMs: Number(durationMs.toFixed(2)),
          ip: req.clientIp || req.ip,
          userId: req.user?._id || req.userId || null,
          role: req.user?.role || null,
          userAgent: req.headers['user-agent'] || '',
        });
      });

      next();
    }
  );
};

module.exports = {
  requestTracing,
};
