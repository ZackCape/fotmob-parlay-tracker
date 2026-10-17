module.exports = {
  apps: [
    {
      name: 'football-analytics-bot',
      script: 'node_modules/.bin/tsx',
      args: 'backend/src/server.ts',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 5000,
        ENABLE_DISCORD_HOURLY: 'true',
        DISCORD_UPDATE_INTERVAL: '5m',
      },
    },
  ],
};
