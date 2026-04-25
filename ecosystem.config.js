module.exports = {
  apps: [
    {
      name: 'replycraft-api',
      cwd: __dirname,
      script: 'server.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '750M',
      env: {
        NODE_ENV: 'production',
        RUNTIME_ROLE: 'api',
      },
    },
    {
      name: 'replycraft-workers',
      cwd: __dirname,
      script: 'workers/index.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '750M',
      env: {
        NODE_ENV: 'production',
        RUNTIME_ROLE: 'workers',
      },
    },
    {
      name: 'replycraft-cron',
      cwd: __dirname,
      script: 'cron/index.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        RUNTIME_ROLE: 'cron',
      },
    },
  ],
};
