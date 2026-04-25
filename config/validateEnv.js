const PLACEHOLDER_VALUES = new Set([
  '',
  'your-super-secret-jwt-key-change-in-production',
  'changeme',
  'change-me',
  'replace-me',
  'your_jwt_secret',
  'your-secret',
]);

const getMode = () => process.env.NODE_ENV || 'development';

const isPlaceholder = (value) => {
  if (typeof value !== 'string') {
    return true;
  }

  const normalized = value.trim().toLowerCase();
  return PLACEHOLDER_VALUES.has(normalized);
};

const assertPresent = (name, errors) => {
  if (!process.env[name] || !process.env[name].trim()) {
    errors.push(`${name} is required`);
  }
};

const assertSecure = (name, errors) => {
  const value = process.env[name];
  if (!value || isPlaceholder(value)) {
    errors.push(`${name} must be set to a secure non-placeholder value`);
  }
};

const validateEnvironment = ({ role = 'api' } = {}) => {
  const mode = getMode();
  const isProduction = mode === 'production';

  const errors = [];
  const warnings = [];

  assertPresent('MONGODB_URI', errors);
  assertSecure('JWT_SECRET', errors);

  if (isProduction) {
    assertPresent('FRONTEND_URL', errors);

    if (!process.env.REDIS_URL && !process.env.REDIS_HOST) {
      errors.push('REDIS_URL or REDIS_HOST is required in production');
    }

    if (role === 'workers' || role === 'cron') {
      if (!process.env.REDIS_URL && !process.env.REDIS_HOST) {
        errors.push(`${role} role requires Redis connectivity`);
      }
    }
  } else {
    if (!process.env.JWT_SECRET || isPlaceholder(process.env.JWT_SECRET)) {
      warnings.push('Using a development JWT secret. Set JWT_SECRET before production deploys.');
    }
  }

  if (errors.length) {
    const error = new Error(`Environment validation failed for ${role}: ${errors.join(' | ')}`);
    error.validationErrors = errors;
    throw error;
  }

  return {
    ok: true,
    mode,
    role,
    warnings,
  };
};

module.exports = {
  validateEnvironment,
};
