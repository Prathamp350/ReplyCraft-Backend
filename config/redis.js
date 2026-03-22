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

  const isProduction = process.env.NODE_ENV === 'production';

  const redisConfig = {
    host: host,
    port: parseInt(process.env.REDIS_PORT) || 6379,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    keepAlive: 10000,
    retryStrategy(times) {
      // In production, backoff indefinitely (Upstash/Railway will reconnect)
      if (isProduction) {
        return Math.min(times * 50, 2000);
      }
      // In development, stop retrying after 5 attempts to reduce noise
      if (times > 5) {
        logger.warn(`[Redis] No local Redis found after ${times} attempts. Workers will be inactive.`);
        return null; // Stop retrying
      }
      return Math.min(times * 200, 2000);
    }
  };

  if (process.env.REDIS_PASSWORD) {
    redisConfig.password = process.env.REDIS_PASSWORD;
  }

  // Enable TLS only when explicitly requested (Upstash or ElastiCache with in-transit encryption)
  // AWS ElastiCache standard clusters do NOT use TLS by default
  if (process.env.REDIS_TLS === 'true' || host.includes('upstash.io')) {
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
