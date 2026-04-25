const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-ci';
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/replycraft-test';

const { app } = require('../server');
const { authenticate, authorizeRoles } = require('../middleware/auth.middleware');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');

const originalFindById = User.findById;
const originalFindOne = User.findOne;
const originalAuditCreate = AuditLog.create;

const buildUser = (role = 'user') => ({
  _id: `507f1f77bcf86cd7994390${role.length}`.padEnd(24, '0'),
  id: `507f1f77bcf86cd7994390${role.length}`.padEnd(24, '0'),
  role,
  isActive: true,
  plan: 'free',
  syncSubscriptionStatus: async () => undefined,
  checkMonthlyLimit: () => ({ exceeded: false, used: 0, limit: 100, remaining: 100 }),
  isModified: () => false,
  save: async () => undefined,
});

const signToken = (userId) =>
  jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '1h' });

const stubUserLookup = (role) => {
  const user = buildUser(role);
  User.findById = async (id) => {
    if (String(id) !== String(user._id)) {
      return null;
    }
    return user;
  };
  return user;
};

const createRoleProbeApp = (...roles) => {
  const probe = express();
  probe.get('/probe', authenticate, authorizeRoles(...roles), (req, res) => {
    res.status(200).json({
      success: true,
      role: req.user.role,
      allowedRoles: roles,
    });
  });
  return probe;
};

test.after(() => {
  User.findById = originalFindById;
  User.findOne = originalFindOne;
  AuditLog.create = originalAuditCreate;
});

test.beforeEach(() => {
  User.findOne = originalFindOne;
  AuditLog.create = originalAuditCreate;
});

test('GET / returns backend metadata', async () => {
  const response = await request(app).get('/');

  assert.equal(response.status, 200);
  assert.equal(response.body.name, 'ReplyCraft AI Backend');
  assert.equal(response.body.endpoints.health, 'GET /health');
});

test('GET /health returns basic liveness payload', async () => {
  const response = await request(app).get('/health');

  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'ok');
  assert.equal(response.body.service, 'ReplyCraft AI Backend');
  assert.ok(response.body.timestamp);
});

test('GET /livez returns runtime liveness status', async () => {
  const response = await request(app).get('/livez');

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.status, 'alive');
  assert.ok(typeof response.body.uptime === 'number');
});

test('GET /readyz returns readiness payload shape', async () => {
  const response = await request(app).get('/readyz');

  assert.ok([200, 503].includes(response.status));
  assert.ok(typeof response.body.success === 'boolean');
  assert.ok(typeof response.body.database === 'string');
  assert.ok(typeof response.body.redis === 'string');
  assert.ok(typeof response.body.queue === 'string');
});

test('GET /api/profile rejects unauthenticated requests', async () => {
  const response = await request(app).get('/api/profile');

  assert.equal(response.status, 401);
  assert.equal(response.body.success, false);
});

test('GET /api/admin rejects unauthenticated requests', async () => {
  const response = await request(app).get('/api/admin');

  assert.equal(response.status, 401);
  assert.equal(response.body.success, false);
});

test('GET /api/health/runtime rejects unauthenticated requests', async () => {
  const response = await request(app).get('/api/health/runtime');

  assert.equal(response.status, 401);
  assert.equal(response.body.success, false);
});

test('GET /api/admin/staff rejects basic user role', async () => {
  const user = stubUserLookup('user');
  const response = await request(app)
    .get('/api/admin/staff')
    .set('Authorization', `Bearer ${signToken(user._id)}`);

  assert.equal(response.status, 403);
  assert.equal(response.body.success, false);
});

test('GET /api/admin/staff rejects support role for admin-only route', async () => {
  const user = stubUserLookup('support');
  const response = await request(app)
    .get('/api/admin/staff')
    .set('Authorization', `Bearer ${signToken(user._id)}`);

  assert.equal(response.status, 403);
  assert.equal(response.body.success, false);
});

test('GET /api/tickets rejects finance role for support route', async () => {
  const user = stubUserLookup('finance');
  const response = await request(app)
    .get('/api/tickets')
    .set('Authorization', `Bearer ${signToken(user._id)}`);

  assert.equal(response.status, 403);
  assert.equal(response.body.success, false);
});

test('GET /api/admin/analytics/god-mode rejects finance role for admin-only analytics', async () => {
  const user = stubUserLookup('finance');
  const response = await request(app)
    .get('/api/admin/analytics/god-mode')
    .set('Authorization', `Bearer ${signToken(user._id)}`);

  assert.equal(response.status, 403);
  assert.equal(response.body.success, false);
});

test('GET /api/health/runtime allows admin role on runtime metrics route', async () => {
  const user = stubUserLookup('admin');
  const response = await request(app)
    .get('/api/health/runtime')
    .set('Authorization', `Bearer ${signToken(user._id)}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.role, 'api');
  assert.ok(response.body.runtime);
});

test('GET /api/admin/system/health allows admin role and returns system posture', async () => {
  const user = stubUserLookup('admin');
  const response = await request(app)
    .get('/api/admin/system/health')
    .set('Authorization', `Bearer ${signToken(user._id)}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.ok(['ok', 'degraded', 'error'].includes(response.body.status));
  assert.ok(Array.isArray(response.body.services));
  assert.equal(response.body.security.adminRoutesProtected, true);
});

test('middleware allows support role on support-authorized route', async () => {
  const user = stubUserLookup('support');
  const probeApp = createRoleProbeApp('superadmin', 'admin', 'support');
  const response = await request(probeApp)
    .get('/probe')
    .set('Authorization', `Bearer ${signToken(user._id)}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.role, 'support');
});

test('middleware allows finance role on finance-authorized route', async () => {
  const user = stubUserLookup('finance');
  const probeApp = createRoleProbeApp('superadmin', 'admin', 'finance');
  const response = await request(probeApp)
    .get('/probe')
    .set('Authorization', `Bearer ${signToken(user._id)}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.role, 'finance');
});

test('middleware allows admin role on admin-authorized route', async () => {
  const user = stubUserLookup('admin');
  const probeApp = createRoleProbeApp('superadmin', 'admin');
  const response = await request(probeApp)
    .get('/probe')
    .set('Authorization', `Bearer ${signToken(user._id)}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.role, 'admin');
});

test('POST /api/auth/login reuses an unexpired OTP to avoid stale queued email codes', async () => {
  const user = {
    _id: '507f1f77bcf86cd799439011',
    name: 'OTP User',
    email: 'otp@example.com',
    password: 'hashed-password',
    isActive: true,
    failedLoginAttempts: 0,
    otp: '123456',
    otpExpiresAt: new Date(Date.now() + 5 * 60000),
    comparePassword: async () => true,
    save: async () => user,
  };

  User.findOne = () => ({
    select: async () => user,
  });
  AuditLog.create = async () => ({});

  const response = await request(app)
    .post('/api/auth/login')
    .send({ email: ' OTP@example.com ', password: 'valid-password' });

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(user.otp, '123456');
});

test('POST /api/auth/verify-otp normalizes typed OTP before comparing', async () => {
  const user = {
    _id: '507f1f77bcf86cd799439012',
    name: 'OTP User',
    email: 'otp@example.com',
    plan: 'free',
    monthlyUsage: { count: 0, lastReset: new Date() },
    avatarUrl: null,
    role: 'user',
    isOnboarded: false,
    isEmailVerified: true,
    isActive: true,
    otp: '123456',
    otpExpiresAt: new Date(Date.now() + 5 * 60000),
    checkMonthlyLimit: () => ({ exceeded: false, used: 0, limit: 100, remaining: 100 }),
    save: async () => user,
  };

  User.findOne = () => ({
    then: (resolve) => Promise.resolve(resolve(user)),
    catch: () => undefined,
  });
  AuditLog.create = async () => ({});

  const response = await request(app)
    .post('/api/auth/verify-otp')
    .send({ email: ' OTP@example.com ', otp: ' 123-456 ' });

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.ok(response.body.token);
  assert.equal(user.otp, null);
});
