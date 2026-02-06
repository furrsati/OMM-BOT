import { Request, Response, NextFunction } from 'express';
import { getPool } from '../../db/postgres';
import { logger } from '../../utils/logger';
import { AuthenticatedRequest } from './auth';

/**
 * Audit Logging Middleware
 *
 * Logs all sensitive operations to the database for security audit trail.
 * Captures: who did what, when, from where, and what changed.
 */

export type AuditAction =
  | 'BOT_START'
  | 'BOT_STOP'
  | 'BOT_PAUSE'
  | 'BOT_RESUME'
  | 'BOT_KILL'
  | 'CONFIG_UPDATE'
  | 'REGIME_OVERRIDE'
  | 'WALLET_SWEEP'
  | 'SETTINGS_UPDATE'
  | 'SETTINGS_RESET'
  | 'SMART_WALLET_ADD'
  | 'SMART_WALLET_UPDATE'
  | 'SMART_WALLET_REMOVE'
  | 'BLACKLIST_ADD'
  | 'BLACKLIST_REMOVE'
  | 'AUTH_SUCCESS'
  | 'AUTH_FAILURE';

export interface AuditLogEntry {
  action: AuditAction;
  apiKeyId?: string;
  ipAddress?: string;
  userAgent?: string;
  path: string;
  method: string;
  requestBody?: Record<string, any>;
  responseStatus?: number;
  details?: string;
  timestamp: Date;
}

/**
 * Get client IP address from request
 * Handles proxy headers (X-Forwarded-For)
 */
function getClientIp(req: Request): string {
  const forwardedFor = req.headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string') {
    return forwardedFor.split(',')[0].trim();
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
}

/**
 * Redact sensitive fields from request body
 */
function redactSensitiveFields(body: Record<string, any>): Record<string, any> {
  const sensitiveFields = [
    'password',
    'privateKey',
    'secret',
    'token',
    'apiKey',
    'api_key',
    'discordWebhook',
  ];

  const redacted = { ...body };

  for (const field of sensitiveFields) {
    if (field in redacted) {
      redacted[field] = '[REDACTED]';
    }
  }

  return redacted;
}

/**
 * Write audit log entry to database
 */
export async function writeAuditLog(entry: AuditLogEntry): Promise<void> {
  try {
    const pool = getPool();
    await pool.query(
      `INSERT INTO audit_log (
        action, api_key_id, ip_address, user_agent,
        path, method, request_body, response_status,
        details, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        entry.action,
        entry.apiKeyId || null,
        entry.ipAddress || null,
        entry.userAgent || null,
        entry.path,
        entry.method,
        entry.requestBody ? JSON.stringify(entry.requestBody) : null,
        entry.responseStatus || null,
        entry.details || null,
        entry.timestamp,
      ]
    );
  } catch (error: any) {
    // Log to file if database write fails - never lose audit data
    logger.error('Failed to write audit log to database', {
      error: error.message,
      entry,
    });
  }
}

/**
 * Create audit middleware for specific action
 */
export function auditLog(action: AuditAction) {
  return async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    const startTime = Date.now();

    // Intercept response finish to capture audit data
    res.on('finish', () => {
      const entry: AuditLogEntry = {
        action,
        apiKeyId: req.apiKeyId,
        ipAddress: getClientIp(req),
        userAgent: req.headers['user-agent']?.substring(0, 500),
        path: req.path,
        method: req.method,
        requestBody: req.body ? redactSensitiveFields(req.body) : undefined,
        responseStatus: res.statusCode,
        details: `Duration: ${Date.now() - startTime}ms`,
        timestamp: new Date(),
      };

      // Write audit log asynchronously (don't block response)
      writeAuditLog(entry).catch(() => {
        // Already logged in writeAuditLog
      });
    });

    next();
  };
}

/**
 * Log authentication failure
 */
export async function logAuthFailure(
  req: Request,
  reason: string
): Promise<void> {
  await writeAuditLog({
    action: 'AUTH_FAILURE',
    ipAddress: getClientIp(req),
    userAgent: req.headers['user-agent']?.substring(0, 500),
    path: req.path,
    method: req.method,
    details: reason,
    timestamp: new Date(),
  });
}

/**
 * Log authentication success
 */
export async function logAuthSuccess(
  req: AuthenticatedRequest
): Promise<void> {
  await writeAuditLog({
    action: 'AUTH_SUCCESS',
    apiKeyId: req.apiKeyId,
    ipAddress: getClientIp(req),
    userAgent: req.headers['user-agent']?.substring(0, 500),
    path: req.path,
    method: req.method,
    timestamp: new Date(),
  });
}
