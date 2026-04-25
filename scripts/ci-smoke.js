const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const TARGET_DIRS = [
  'config',
  'controllers',
  'cron',
  'middleware',
  'models',
  'queues',
  'routes',
  'services',
  'utils',
  'workers',
  'server.js',
];

const IGNORE_DIRS = new Set(['node_modules', 'uploads']);

function collectJavaScriptFiles(targetPath) {
  if (!fs.existsSync(targetPath)) {
    return [];
  }

  const stats = fs.statSync(targetPath);

  if (stats.isFile()) {
    return targetPath.endsWith('.js') ? [targetPath] : [];
  }

  return fs.readdirSync(targetPath, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) {
        return [];
      }

      return collectJavaScriptFiles(path.join(targetPath, entry.name));
    }

    if (entry.isFile() && entry.name.endsWith('.js')) {
      return [path.join(targetPath, entry.name)];
    }

    return [];
  });
}

const files = TARGET_DIRS.flatMap((target) => collectJavaScriptFiles(path.join(ROOT, target)))
  .sort((a, b) => a.localeCompare(b));

if (files.length === 0) {
  console.error('No backend JavaScript files found for CI smoke check.');
  process.exit(1);
}

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], {
    cwd: ROOT,
    stdio: 'pipe',
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    process.stderr.write(result.stderr || `Syntax check failed for ${file}\n`);
    process.exit(result.status || 1);
  }
}

console.log(`Backend smoke check passed for ${files.length} files.`);
