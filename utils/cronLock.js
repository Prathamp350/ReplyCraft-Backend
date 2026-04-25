const crypto = require('crypto');
const createRedisConnection = require('../config/redis');
const logger = require('./logger');

const DEFAULT_LOCK_TTL_MS = 10 * 60 * 1000;
const localLocks = new Map();

const createLockValue = () => `${process.pid}:${Date.now()}:${crypto.randomUUID()}`;

const acquireLocalLock = (lockKey, ttlMs, value) => {
  const now = Date.now();
  const existing = localLocks.get(lockKey);

  if (existing && existing.expiresAt > now) {
    return null;
  }

  localLocks.set(lockKey, {
    value,
    expiresAt: now + ttlMs,
  });
  return value;
};

const releaseLocalLock = (lockKey, value) => {
  const existing = localLocks.get(lockKey);
  if (existing?.value === value) {
    localLocks.delete(lockKey);
  }
};

const withCronLock = async (
  jobName,
  task,
  {
    ttlMs = DEFAULT_LOCK_TTL_MS,
    redisFactory = createRedisConnection,
    allowLocalFallback = process.env.NODE_ENV !== 'production',
  } = {}
) => {
  const lockKey = `cron-lock:${jobName}`;
  const lockValue = createLockValue();
  let redisClient = null;
  let usedLocalLock = false;
  let acquired = false;

  try {
    redisClient = redisFactory();
    if (redisClient.status === 'wait') {
      await redisClient.connect();
    }

    const result = await redisClient.set(lockKey, lockValue, 'PX', ttlMs, 'NX');
    acquired = result === 'OK';

    if (!acquired) {
      logger.info('[CronLock] Skipping job because another runner owns the lock', {
        jobName,
        lockKey,
      });
      return {
        acquired: false,
        skipped: true,
      };
    }
  } catch (error) {
    if (!allowLocalFallback) {
      logger.error('[CronLock] Failed to acquire distributed lock', {
        jobName,
        lockKey,
        error: error.message,
      });
      return {
        acquired: false,
        skipped: true,
        error,
      };
    }

    const localValue = acquireLocalLock(lockKey, ttlMs, lockValue);
    if (!localValue) {
      logger.info('[CronLock] Skipping job because local fallback lock is active', {
        jobName,
        lockKey,
      });
      return {
        acquired: false,
        skipped: true,
      };
    }

    usedLocalLock = true;
    acquired = true;
    logger.warn('[CronLock] Using local fallback lock because Redis is unavailable', {
      jobName,
      lockKey,
      error: error.message,
    });
  }

  try {
    logger.info('[CronLock] Acquired job lock', { jobName, lockKey, ttlMs });
    const result = await task();
    return {
      acquired: true,
      skipped: false,
      result,
    };
  } finally {
    if (usedLocalLock) {
      releaseLocalLock(lockKey, lockValue);
    } else if (redisClient && acquired) {
      try {
        await redisClient.eval(
          "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
          1,
          lockKey,
          lockValue
        );
      } catch (releaseError) {
        logger.warn('[CronLock] Failed to release job lock', {
          jobName,
          lockKey,
          error: releaseError.message,
        });
      }
    }

    if (redisClient) {
      try {
        await redisClient.quit?.();
      } catch (quitError) {
        redisClient.disconnect?.();
      }
    }
  }
};

module.exports = {
  withCronLock,
};
