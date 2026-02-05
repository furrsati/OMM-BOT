import winston from 'winston';
import path from 'path';
import fs from 'fs';

// Create logs directory if it doesn't exist
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
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
