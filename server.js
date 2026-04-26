const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const mongoose = require('mongoose');

// Force Google DNS to resolve MongoDB Atlas SRV records correctly (Bypasses Windows/ISP ECONNREFUSED)
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);

const config = require('./config/config');
const authRoutes = require('./routes/auth.routes');
const replyRoutes = require('./routes/reply.routes');
const reviewRoutes = require('./routes/review.routes');
const googleRoutes = require('./routes/google.routes');
const profileRoutes = require('./routes/profile.routes');
const analyticsRoutes = require('./routes/analytics.routes');
const billingRoutes = require('./routes/billing.routes');
const aiConfigRoutes = require('./routes/aiConfig.routes');
const integrationRoutes = require('./routes/integration.routes');
const insightsRoutes = require('./routes/insights.routes');
const settingsRoutes = require('./routes/settings.routes');
const dashboardRoutes = require('./routes/dashboard.routes');
const contactRoutes = require('./routes/contact.routes');
const supportAssistantRoutes = require('./routes/supportAssistant.routes');
const adminRoutes = require('./routes/admin.routes');
const ticketRoutes = require('./routes/ticket.routes');
const trackingRoutes = require('./routes/tracking.routes');
const path = require('path');
const fs = require('fs');
const logger = require('./utils/logger');
const { generalLimiter, authLimiter } = require('./middleware/rateLimiter');
const { getLiveness, getReadiness, getHealth, getQueueMetrics, getRuntimeMetrics } = require('./controllers/health.controller');
const { sendTestEmail, getEmailStatus } = require('./controllers/test.controller');
const { validateEmailConfig } = require('./config/emailValidator');
const { syncAllSubscriptions } = require('./controllers/webhook.controller');
const { authenticate, authorizeRoles } = require('./middleware/auth.middleware');
const { bullBoardRouter } = require('./config/bullBoard');
const { loadConfig } = require('./services/configManager');
const { blockCommonExploitScans, protectForwardedHeaders } = require('./middleware/requestSecurity.middleware');
const { validateEnvironment } = require('./config/validateEnv');
const { requestTracing } = require('./middleware/requestTracing.middleware');

const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:8080',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5173',
  'https://replycraft.co.in',
  'https://www.replycraft.co.in',
];

const normalizeOrigin = (origin) => {
  if (!origin || typeof origin !== 'string') {
    return '';
  }

  return origin.trim().replace(/\/+$/, '').toLowerCase();
};

const isTrustedReplyCraftOrigin = (origin) => {
  try {
    const { hostname } = new URL(origin);
    const normalizedHost = hostname.toLowerCase();

    return (
      normalizedHost === 'replycraft.co.in' ||
      normalizedHost.endsWith('.replycraft.co.in')
    );
  } catch (error) {
    return false;
  }
};

const allowedOrigins = new Set(
  [
    ...DEFAULT_ALLOWED_ORIGINS,
    process.env.FRONTEND_URL,
    process.env.APP_URL,
    process.env.CLIENT_URL,
    process.env.WEBSITE_URL,
    process.env.PUBLIC_APP_URL,
    ...(process.env.ALLOWED_ORIGINS || '').split(',').map((origin) => origin.trim()),
  ]
    .map(normalizeOrigin)
    .filter(Boolean)
);

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads', 'avatars');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Validate email configuration at startup
validateEmailConfig();

const app = express();

// Trust the reverse proxy (required for Railway load balancer & express-rate-limit)
app.set('trust proxy', 1);

// Suppress Mongoose duplicate index warning
// Note: suppressNoSchemaWarning is not a valid option, so we just remove the call.

// Security middleware
app.use(helmet());
app.use(protectForwardedHeaders);
app.use(requestTracing);
app.use(blockCommonExploitScans);

// CORS configuration
app.use(cors({
  origin: function (origin, callback) {
    if (!origin) {
      return callback(null, true);
    }

    const normalizedOrigin = normalizeOrigin(origin);
    const isAllowed =
      allowedOrigins.has(normalizedOrigin) ||
      isTrustedReplyCraftOrigin(normalizedOrigin);

    if (isAllowed) {
      return callback(null, true);
    }

    logger.warn('Blocked request by CORS policy', {
      origin,
      normalizedOrigin,
      allowedOrigins: Array.from(allowedOrigins)
    });

    const corsError = new Error('Origin not allowed by CORS');
    corsError.statusCode = 403;
    return callback(corsError);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Body parsing middleware
app.use(express.json({
  limit: '10mb',
  verify: (req, res, buf) => {
    if (req.originalUrl === '/api/billing/webhook') {
      req.rawBody = Buffer.from(buf);
    }
  }
}));
app.use(express.urlencoded({ extended: true }));

// Expose static folder for uploads
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Apply global rate limiting
app.use(generalLimiter);

// Routes with rate limiting
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/reply', replyRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/google', googleRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/ai-config', aiConfigRoutes);
app.use('/api/integrations', integrationRoutes);
app.use('/api/insights', insightsRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/support-assistant', supportAssistantRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/tracking', trackingRoutes);

// Bull Board - Queue Monitoring UI (only in development)
if (process.env.NODE_ENV !== 'production' && bullBoardRouter) {
  app.use('/admin/queues', bullBoardRouter);
}

// Health check endpoints
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'ReplyCraft AI Backend',
    timestamp: new Date().toISOString(),
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  });
});

app.get('/livez', getLiveness);
app.get('/readyz', getReadiness);

// Detailed health check with database, redis, queue status
app.get('/api/health', getHealth);

// Queue metrics endpoint
app.get('/api/health/queue', getQueueMetrics);
app.get('/api/health/runtime', authenticate, authorizeRoles('admin', 'superadmin'), getRuntimeMetrics);

// Test endpoints (protected)
app.post('/api/test/email', authenticate, sendTestEmail);
app.get('/api/test/email/status', authenticate, getEmailStatus);

// Root endpoint
app.get('/', (req, res) => {
  res.status(200).json({
    name: 'ReplyCraft AI Backend',
    version: '1.0.0',
    endpoints: {
      health: 'GET /health',
      register: 'POST /api/auth/register',
      login: 'POST /api/auth/login',
      generateReply: 'POST /api/reply/generate-reply',
      processReview: 'POST /api/reviews/process'
    }
  });
});

// Get User Region via Cloudflare Header
app.get('/api/region', (req, res) => {
  res.status(200).json({
    countryCode: req.headers['cf-ipcountry'] || 'US'
  });
});

// 404 handler
app.use((req, res) => {
  logger.warn('Endpoint not found', { path: req.path, method: req.method });
  res.status(404).json({
    success: false,
    error: 'Endpoint not found'
  });
});

// Global error handler
app.use((err, req, res, next) => {
  logger.error('Unhandled Error', {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    origin: req.headers.origin
  });

  if (err.message === 'Origin not allowed by CORS') {
    return res.status(err.statusCode || 403).json({
      success: false,
      error: 'Origin not allowed by CORS'
    });
  }

  res.status(500).json({
    success: false,
    error: 'Internal server error'
  });
});

// Connect to MongoDB and start server
const startServer = async () => {
  try {
    const envCheck = validateEnvironment({ role: 'api' });
    envCheck.warnings.forEach((warning) => logger.warn('[EnvValidation]', { warning }));

    await mongoose.connect(config.mongodb.uri);
    logger.info('Connected to MongoDB');
    await loadConfig();
    
    // Sync subscriptions on startup (downgrade expired plans)
    await syncAllSubscriptions();
    
    const PORT = config.port;
    const server = app.listen(PORT, '0.0.0.0', () => {
      logger.info(`ReplyCraft AI Backend running on port ${PORT} bound to 0.0.0.0`);
      logger.info('Available endpoints: POST /api/auth/register, POST /api/auth/login, POST /api/reply/generate-reply, POST /api/reviews/process, GET /health');
    });
    return server;
  } catch (error) {
    logger.error('Backend startup failed', {
      error: error.message,
      stack: error.stack,
      validationErrors: error.validationErrors,
    });
    process.exit(1);
  }
};

if (require.main === module) {
  startServer();
}

module.exports = {
  app,
  startServer,
};
