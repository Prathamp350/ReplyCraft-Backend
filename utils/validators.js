/**
 * Shared validation utilities
 */

const validatePassword = (password) => {
  if (password.length < 8) return 'Password must be at least 8 characters';
  if (!/[A-Z]/.test(password)) return 'Password must contain at least one uppercase letter';
  if (!/[a-z]/.test(password)) return 'Password must contain at least one lowercase letter';
  if (!/[^A-Za-z0-9]/.test(password)) return 'Password must contain at least one symbol';
  return null;
};

module.exports = {
  validatePassword
};
