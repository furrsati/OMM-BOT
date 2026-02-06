import winston from 'winston';
import Transport from 'winston-transport';
import path from 'path';
import fs from 'fs';

// Create logs directory if it doesn't exist
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

/**
 * Custom PostgreSQL Transport for Winston
 * Writes logs to the bot_logs table in the database
 */
class PostgresTransport extends Transport {
  private pool: any = null;
  private queue: Array<{ level: string; category: string; message: string; data: any }> = [];
  private isProcessing = false;
  private initialized = false;

  constructor(opts?: Transport.TransportStreamOptions) {
    super(opts);
    // Delay initialization to avoid circular dependency with db module
    setTimeout(() => this.initialize(), 1000);
  }

  async initialize() {
    try {
      // Dynamic import to avoid circular dependency
      const { getPool } = await import('../db/postgres');
      this.pool = getPool();
      this.initialized = true;
      // Process any queued logs
      this.processQueue();
    } catch (error) {
      // Database not ready yet, will retry on next log
      console.error('PostgresTransport: Failed to initialize, will retry');
    }
  }

  async processQueue() {
    if (this.isProcessing || this.queue.length === 0 || !this.initialized) return;
    this.isProcessing = true;

    while (this.queue.length > 0) {
      const log = this.queue.shift();
      if (log) {
        await this.writeToDb(log);
      }
    }

    this.isProcessing = false;
  }

  async writeToDb(log: { level: string; category: string; message: string; data: any }) {
    if (!this.pool) return;

    try {
      await this.pool.query(
        `INSERT INTO bot_logs (level, category, message, data) VALUES ($1, $2, $3, $4)`,
        [log.level, log.category, log.message, JSON.stringify(log.data)]
      );
    } catch (error: any) {
      // Silently fail - don't want logging to crash the bot
      // The log is still in files/console
    }
  }

  log(info: any, callback: () => void) {
    setImmediate(() => {
      this.emit('logged', info);
    });

    // Extract category from message or meta
    let category = 'general';
    let message = info.message || '';

    // Check for category patterns in message
    if (message.includes('[TRADE]')) {
      category = 'trade';
      message = message.replace('[TRADE] ', '');
    } else if (message.includes('[DANGER]')) {
      category = 'danger';
      message = message.replace('[DANGER] ', '');
    } else if (message.includes('[LEARNING]')) {
      category = 'learning';
      message = message.replace('[LEARNING] ', '');
    } else if (message.includes('[RPC]')) {
      category = 'rpc';
      message = message.replace('[RPC] ', '');
    } else if (message.includes('[KILL_SWITCH]')) {
      category = 'kill_switch';
      message = message.replace('[KILL_SWITCH] ', '');
    } else if (message.includes('[SCANNER]')) {
      category = 'scanner';
      message = message.replace('[SCANNER] ', '');
    } else if (message.includes('[POSITION]')) {
      category = 'position';
      message = message.replace('[POSITION] ', '');
    } else if (message.includes('[SAFETY]')) {
      category = 'safety';
      message = message.replace('[SAFETY] ', '');
    } else if (message.includes('[WALLET]')) {
      category = 'wallet';
      message = message.replace('[WALLET] ', '');
    } else if (message.includes('[MARKET]')) {
      category = 'market';
      message = message.replace('[MARKET] ', '');
    } else if (message.includes('[EXECUTION]')) {
      category = 'execution';
      message = message.replace('[EXECUTION] ', '');
    }

    // Extract data from info (excluding winston metadata)
    const { level, message: _, timestamp, ...data } = info;

    const logEntry = {
      level: info.level,
      category,
      message,
      data: Object.keys(data).length > 0 ? data : {},
    };

    if (this.initialized && this.pool) {
      this.writeToDb(logEntry);
    } else {
      // Queue the log for later
      this.queue.push(logEntry);
      if (this.queue.length > 1000) {
        // Prevent memory issues, drop oldest logs
        this.queue.shift();
      }
    }

    callback();
  }
}

// Define log format
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

// Console format (more readable)
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let msg = `${timestamp} [${level}]: ${message}`;
    if (Object.keys(meta).length > 0) {
      msg += ` ${JSON.stringify(meta)}`;
    }
    return msg;
  })
);

// Create logger instance
export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  transports: [
    // Write all logs to combined.log
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
      maxsize: 10485760, // 10MB
      maxFiles: 5,
    }),
    // Write error logs to error.log
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      maxsize: 10485760,
      maxFiles: 5,
    }),
    // Write trade logs to trade.log
    new winston.transports.File({
      filename: path.join(logsDir, 'trade.log'),
      level: 'info',
      maxsize: 10485760,
      maxFiles: 10,
    }),
  ],
});

// Always add console transport (critical for cloud deployments like Render)
// In production, logs need to go to stdout/stderr for the platform to capture them
logger.add(
  new winston.transports.Console({
    format: consoleFormat,
  })
);

// Add PostgreSQL transport to write logs to database
// This enables viewing logs in the dashboard
logger.add(new PostgresTransport({ level: 'info' }));

// Specialized logging functions
export const logTrade = (action: string, data: any) => {
  logger.info(`[TRADE] ${action}`, { trade: data, timestamp: new Date().toISOString() });
};

export const logDangerSignal = (signal: string, data: any) => {
  logger.warn(`[DANGER] ${signal}`, { danger: data, timestamp: new Date().toISOString() });
};

export const logLearningEngineAdjustment = (adjustment: string, data: any) => {
  logger.info(`[LEARNING] ${adjustment}`, { learning: data, timestamp: new Date().toISOString() });
};

export const logRPCFailover = (from: string, to: string, error?: any) => {
  logger.warn(`[RPC] Failover from ${from} to ${to}`, { error, timestamp: new Date().toISOString() });
};

export const logKillSwitch = (reason: string, data: any) => {
  logger.error(`[KILL_SWITCH] ${reason}`, { data, timestamp: new Date().toISOString() });
};

// Export default logger
export default logger;
