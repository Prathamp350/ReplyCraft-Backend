const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const mongoUri = process.env.MONGODB_URI;
const backupRoot = process.env.BACKUP_DIR || path.join(__dirname, '..', 'backups');

if (!mongoUri) {
  console.error('MONGODB_URI is required to run a MongoDB backup.');
  process.exit(1);
}

fs.mkdirSync(backupRoot, { recursive: true });

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const archivePath = path.join(backupRoot, `replycraft-mongo-${timestamp}.archive.gz`);

const args = [
  `--uri=${mongoUri}`,
  `--archive=${archivePath}`,
  '--gzip',
];

const child = spawn('mongodump', args, {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

child.on('exit', (code) => {
  if (code !== 0) {
    console.error(`mongodump failed with exit code ${code}. Make sure MongoDB Database Tools are installed.`);
    process.exit(code || 1);
  }

  console.log(`MongoDB backup created: ${archivePath}`);
});
