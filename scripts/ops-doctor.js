const mongoose = require('mongoose');
const dns = require('dns');
const config = require('../config/config');
const createRedisConnection = require('../config/redis');

dns.setServers(['8.8.8.8', '8.8.4.4']);

const baseUrl = (process.env.DOCTOR_BASE_URL || `http://localhost:${config.port}`).replace(/\/+$/, '');
const timeoutMs = Number(process.env.DOCTOR_TIMEOUT_MS || 5000);

const requiredEnv = [
  'JWT_SECRET',
  'MONGODB_URI',
  'REDIS_HOST',
  'REDIS_PORT',
];

const withTimeout = async (promise, label) => {
  let timeoutHandle;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
};

const checkEnv = () => {
  const missing = requiredEnv.filter((name) => !process.env[name]);
  const unsafe = [];

  if (process.env.JWT_SECRET === 'your-super-secret-jwt-key-change-in-production') {
    unsafe.push('JWT_SECRET is using the old placeholder value');
  }

  return {
    name: 'environment',
    ok: missing.length === 0 && unsafe.length === 0,
    details: {
      missing,
      unsafe,
    },
  };
};

const checkMongo = async () => {
  try {
    await withTimeout(mongoose.connect(config.mongodb.uri), 'MongoDB connect');
    return {
      name: 'mongodb',
      ok: true,
      details: { state: 'connected' },
    };
  } catch (error) {
    return {
      name: 'mongodb',
      ok: false,
      details: { error: error.message },
    };
  } finally {
    await mongoose.disconnect().catch(() => undefined);
  }
};

const checkRedis = async () => {
  let redisClient;
  try {
    redisClient = createRedisConnection();
    redisClient.on('error', () => {});
    if (redisClient.status === 'wait') {
      await withTimeout(redisClient.connect(), 'Redis connect');
    }
    await withTimeout(redisClient.ping(), 'Redis ping');
    return {
      name: 'redis',
      ok: true,
      details: { state: 'connected' },
    };
  } catch (error) {
    return {
      name: 'redis',
      ok: false,
      details: { error: error.message },
    };
  } finally {
    if (redisClient) {
      await redisClient.quit().catch(() => redisClient.disconnect());
    }
  }
};

const checkHttp = async (path, expectedStatuses = [200]) => {
  try {
    const response = await withTimeout(fetch(`${baseUrl}${path}`), `HTTP ${path}`);
    const body = await response.text();
    return {
      name: `http ${path}`,
      ok: expectedStatuses.includes(response.status),
      details: {
        status: response.status,
        body: body.slice(0, 300),
      },
    };
  } catch (error) {
    return {
      name: `http ${path}`,
      ok: false,
      details: { error: error.message },
    };
  }
};

const run = async () => {
  const checks = [
    checkEnv(),
    await checkMongo(),
    await checkRedis(),
    await checkHttp('/health'),
    await checkHttp('/livez'),
    await checkHttp('/readyz'),
  ];

  const failed = checks.filter((check) => !check.ok);

  checks.forEach((check) => {
    const marker = check.ok ? 'PASS' : 'FAIL';
    console.log(`${marker} ${check.name}`);
    console.log(JSON.stringify(check.details, null, 2));
  });

  if (failed.length > 0) {
    console.error(`Ops doctor found ${failed.length} failing check(s).`);
    process.exit(1);
  }

  console.log('Ops doctor checks passed.');
};

run().catch((error) => {
  console.error(`Ops doctor failed: ${error.message}`);
  process.exit(1);
});
