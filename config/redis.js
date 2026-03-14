const IORedis = require('ioredis');
const logger = require('../utils/logger');

// Create a singleton Redis connection to be shared or a factory function
const createRedisConnection = () => {
  // Clean up host if user accidentally pasted https:// or rediss:// into REDIS_HOST
  let host = process.env.REDIS_HOST || '127.0.0.1';
  if (host.startsWith('http://')) host = host.replace('http://', '');
  if (host.startsWith('https://')) host = host.replace('https://', '');
  if (host.startsWith('redis://')) host = host.replace('redis://', '');
  if (host.startsWith('rediss://')) host = host.replace('rediss://', '');

  // Clean trailing port if accidentally included in host
  if (host.includes(':')) {
    host = host.split(':')[0];
  }

  const redisConfig = {
    host: host,
    port: parseInt(process.env.REDIS_PORT) || 6379,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    keepAlive: 10000,
    retryStrategy(times) {
      const delay = Math.min(times * 50, 2000);
      return delay; // Reconnect continuously
    }
  };

  if (process.env.REDIS_PASSWORD) {
    redisConfig.password = process.env.REDIS_PASSWORD;
  }

  // Upstash requires TLS for external connections
  if (process.env.NODE_ENV === 'production' || process.env.REDIS_TLS === 'true' || host.includes('upstash.io')) {
    redisConfig.tls = {};
  }

  let connection;

  if (process.env.REDIS_URL) {
    let url = process.env.REDIS_URL;
    // If they pasted the REST URL into REDIS_URL, convert it to a Rediss URI
    if (url.startsWith('https://') && url.includes('upstash.io')) {
      const cleanHost = url.replace('https://', '');
      url = `rediss://default:${process.env.REDIS_PASSWORD || ''}@${cleanHost}:${process.env.REDIS_PORT || 6379}`;
    }
    connection = new IORedis(url, { maxRetriesPerRequest: null });
  } else {
    connection = new IORedis(redisConfig);
  }

  return connection;
};

module.exports = createRedisConnection;
