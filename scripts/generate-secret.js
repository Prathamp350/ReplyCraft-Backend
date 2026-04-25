const crypto = require('crypto');

const bytes = Number(process.argv[2] || 64);

if (!Number.isInteger(bytes) || bytes < 32) {
  console.error('Usage: npm run secret:jwt -- [bytes]');
  console.error('Choose at least 32 bytes. Production JWT secrets should be long and random.');
  process.exit(1);
}

console.log(crypto.randomBytes(bytes).toString('hex'));
