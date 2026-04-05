const net = require('net');
const logger = require('../utils/logger');

const normalizeIp = (value = '') =>
  String(value)
    .trim()
    .replace(/^::ffff:/, '');

const isPrivateOrLoopbackIp = (ip) => {
  const value = normalizeIp(ip);

  if (!value) return false;
  if (value === '127.0.0.1' || value === '::1') return true;
  if (value.startsWith('10.')) return true;
  if (value.startsWith('192.168.')) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(value)) return true;
  if (value.startsWith('fc') || value.startsWith('fd')) return true;

  return false;
};

const getValidatedForwardedIps = (headerValue) =>
  String(headerValue || '')
    .split(',')
    .map((part) => normalizeIp(part))
    .filter(Boolean);

const protectForwardedHeaders = (req, res, next) => {
  const forwardedFor = req.headers['x-forwarded-for'];
  const remoteAddress = normalizeIp(req.socket?.remoteAddress || '');

  if (forwardedFor) {
    const hops = getValidatedForwardedIps(forwardedFor);
    const invalid = hops.some((ip) => net.isIP(ip) === 0);

    if (invalid || hops.length > 5) {
      logger.warn('Blocked malformed X-Forwarded-For header', {
        remoteAddress,
        forwardedFor
      });
      return res.status(400).json({
        success: false,
        error: 'Malformed forwarding header rejected.'
      });
    }

    if (!isPrivateOrLoopbackIp(remoteAddress) && process.env.NODE_ENV !== 'production') {
      logger.warn('Blocked direct client supplied X-Forwarded-For header', {
        remoteAddress,
        forwardedFor
      });
      return res.status(400).json({
        success: false,
        error: 'Spoofed forwarding header rejected.'
      });
    }

    req.clientIp = hops[0] || remoteAddress;
  } else {
    req.clientIp = remoteAddress;
  }

  next();
};

module.exports = {
  protectForwardedHeaders
};
