/**
 * Winston Logger Configuration
 * Production-grade logging with file rotation
 */

const winston = require('winston');
const path = require('path');
const fs = require('fs');

// Ensure logs directory exists
const logsDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Define log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

// Define colors for console output
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'blue',
};

// Add colors to winston
winston.addColors(colors);

// Create format for console output
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.colorize({ all: true }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let msg = `${timestamp} [${level}]: ${message}`;
    if (Object.keys(meta).length > 0 && meta.stack) {
      msg += `\n${meta.stack}`;
    } else if (Object.keys(meta).length > 0) {
      msg += ` ${JSON.stringify(meta)}`;
    }
    return msg;
  })
);

// Create format for file output
const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Create logger instance
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  levels,
  format: fileFormat,
  transports: [
    // Error log file
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      maxsize: 5 * 1024 * 1024, // 5MB
      maxFiles: 5
    }),
    
    // Combined log file
    new winston.transports.File({
      filename: path.join(logsDir, 'app.log'),
      maxsize: 5 * 1024 * 1024, // 5MB
      maxFiles: 5
    }),
    
    // HTTP requests log
    new winston.transports.File({
      filename: path.join(logsDir, 'http.log'),
      level: 'http',
      maxsize: 5 * 1024 * 1024, // 5MB
      maxFiles: 3
    })
  ],
  exceptionHandlers: [
    new winston.transports.File({
      filename: path.join(logsDir, 'exceptions.log'),
      maxsize: 5 * 1024 * 1024
    })
  ],
  rejectionHandlers: [
    new winston.transports.File({
      filename: path.join(logsDir, 'rejections.log'),
      maxsize: 5 * 1024 * 1024
    })
  ]
});

// Add console transport in development
logger.add(new winston.transports.Console({
  format: consoleFormat
}));

// Helper methods for structured logging
logger.logAuth = (action, data) => {
  logger.info(`[AUTH] ${action}`, { action, ...data });
};

logger.logAI = (action, data) => {
  logger.info(`[AI] ${action}`, { action, ...data });
};

logger.logReview = (action, data) => {
  logger.info(`[REVIEW] ${action}`, { action, ...data });
};

logger.logSecurity = (action, data) => {
  logger.warn(`[SECURITY] ${action}`, { action, ...data });
};

logger.logRateLimit = (action, data) => {
  logger.warn(`[RATE LIMIT] ${action}`, { action, ...data });
};

logger.logBilling = (action, data) => {
  logger.info(`[BILLING] ${action}`, { action, ...data });
};

logger.logWarn = (message, data) => {
  logger.warn(message, data);
};

module.exports = logger;
