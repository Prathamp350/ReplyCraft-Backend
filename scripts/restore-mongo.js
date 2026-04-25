const { spawn } = require('child_process');
const fs = require('fs');

const mongoUri = process.env.MONGODB_URI;
const archivePath = process.env.BACKUP_ARCHIVE;

if (!mongoUri) {
  console.error('MONGODB_URI is required to restore a MongoDB backup.');
  process.exit(1);
}

if (!archivePath) {
  console.error('BACKUP_ARCHIVE is required and must point to a .archive.gz file.');
  process.exit(1);
}

if (!fs.existsSync(archivePath)) {
  console.error(`Backup archive not found: ${archivePath}`);
  process.exit(1);
}

const args = [
  `--uri=${mongoUri}`,
  `--archive=${archivePath}`,
  '--gzip',
];

if (process.env.RESTORE_DROP === 'true') {
  args.push('--drop');
}

const child = spawn('mongorestore', args, {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

child.on('exit', (code) => {
  if (code !== 0) {
    console.error(`mongorestore failed with exit code ${code}. Make sure MongoDB Database Tools are installed.`);
    process.exit(code || 1);
  }

  console.log('MongoDB restore completed.');
});
