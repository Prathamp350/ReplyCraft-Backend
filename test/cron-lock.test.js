const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const { withCronLock } = require('../utils/cronLock');

const createFakeRedisFactory = () => {
  const locks = new Map();

  return () => ({
    status: 'ready',
    async set(key, value, px, ttlMs, nx) {
      assert.equal(px, 'PX');
      assert.equal(nx, 'NX');
      assert.ok(ttlMs > 0);

      if (locks.has(key)) {
        return null;
      }

      locks.set(key, value);
      return 'OK';
    },
    async eval(script, keyCount, key, value) {
      assert.equal(keyCount, 1);

      if (locks.get(key) === value) {
        locks.delete(key);
        return 1;
      }

      return 0;
    },
    async quit() {},
    disconnect() {},
  });
};

test('withCronLock skips a duplicate concurrent cron runner', async () => {
  const redisFactory = createFakeRedisFactory();
  let releaseFirstJob;
  let runCount = 0;

  const firstRun = withCronLock(
    'duplicate-probe',
    async () => {
      runCount += 1;
      await new Promise((resolve) => {
        releaseFirstJob = resolve;
      });
      return 'first-complete';
    },
    { redisFactory, ttlMs: 10000 }
  );

  await new Promise((resolve) => setImmediate(resolve));

  const duplicateRun = await withCronLock(
    'duplicate-probe',
    async () => {
      runCount += 1;
      return 'should-not-run';
    },
    { redisFactory, ttlMs: 10000 }
  );

  assert.equal(duplicateRun.acquired, false);
  assert.equal(duplicateRun.skipped, true);
  assert.equal(runCount, 1);

  releaseFirstJob();
  const firstResult = await firstRun;

  assert.equal(firstResult.acquired, true);
  assert.equal(firstResult.result, 'first-complete');
  assert.equal(runCount, 1);
});

test('withCronLock releases the lock after a successful run', async () => {
  const redisFactory = createFakeRedisFactory();
  let runCount = 0;

  const firstResult = await withCronLock(
    'release-probe',
    async () => {
      runCount += 1;
      return 'first';
    },
    { redisFactory, ttlMs: 10000 }
  );

  const secondResult = await withCronLock(
    'release-probe',
    async () => {
      runCount += 1;
      return 'second';
    },
    { redisFactory, ttlMs: 10000 }
  );

  assert.equal(firstResult.result, 'first');
  assert.equal(secondResult.result, 'second');
  assert.equal(runCount, 2);
});
