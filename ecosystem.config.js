/**
 * PM2 Ecosystem Configuration
 *
 * This ensures the bot runs continuously with automatic restart on crashes.
 *
 * Usage:
 *   npm run pm2:start     - Start the bot with PM2
 *   npm run pm2:stop      - Stop the bot
 *   npm run pm2:restart   - Restart the bot
 *   npm run pm2:logs      - View logs
 *   npm run pm2:status    - Check status
 */

module.exports = {
  apps: [
    {
      name: 'omm-bot',
      script: 'dist/index.js',

      // Node.js arguments
      node_args: '--expose-gc --max-old-space-size=1536',

      // Restart policy
      autorestart: true,
      watch: false,
      max_restarts: 50,           // Max restarts in restart_delay window
      min_uptime: '10s',          // Consider app started after 10s
      restart_delay: 5000,        // Wait 5s between restarts

      // Memory management - restart if exceeds limit
      max_memory_restart: '1500M',

      // Exponential backoff restart delay
      exp_backoff_restart_delay: 1000,  // Start with 1s, doubles each restart

      // Environment
      env: {
        NODE_ENV: 'production',
      },

      // Logging
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: 'logs/pm2-error.log',
      out_file: 'logs/pm2-out.log',
      merge_logs: true,
      log_type: 'json',

      // Graceful shutdown
      kill_timeout: 15000,        // 15s to shutdown gracefully
      listen_timeout: 10000,
      shutdown_with_message: true,

      // Health check via HTTP
      // PM2 will restart if the health check fails
      // Uncomment if you want PM2 to monitor the health endpoint:
      // wait_ready: true,
      // listen_timeout: 30000,
    },

    // Development mode with watch
    {
      name: 'omm-bot-dev',
      script: 'src/index.ts',
      interpreter: './node_modules/.bin/ts-node',
      interpreter_args: '--transpile-only',

      // Watch for file changes
      watch: ['src'],
      watch_delay: 1000,
      ignore_watch: ['node_modules', 'logs', 'dist', '.git'],

      // Restart policy
      autorestart: true,
      max_restarts: 10,
      restart_delay: 2000,

      // Node.js arguments
      node_args: '--expose-gc --max-old-space-size=1024',

      // Environment
      env: {
        NODE_ENV: 'development',
      },

      // Logging
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: 'logs/pm2-dev-error.log',
      out_file: 'logs/pm2-dev-out.log',
      merge_logs: true,
    },
  ],
};
