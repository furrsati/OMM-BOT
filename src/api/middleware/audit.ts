import { Request, Response, NextFunction } from 'express';
import { createHash } from 'crypto';
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
  | 'SMART_WALLET_BULK_IMPORT'
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
 * Generate checksum for tamper-proof audit log
 */
function generateChecksum(action: string, details: object, timestamp: Date): string {
  const data = JSON.stringify({ action, details, timestamp: timestamp.toISOString() });
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Write audit log entry to database
 * Consolidates all entry fields into the 'details' JSONB column to match schema
 */
export async function writeAuditLog(entry: AuditLogEntry): Promise<void> {
  try {
    const pool = getPool();

    // Consolidate all entry data into the details JSONB field
    const details = {
      apiKeyId: entry.apiKeyId || null,
      ipAddress: entry.ipAddress || null,
      userAgent: entry.userAgent || null,
      path: entry.path,
      method: entry.method,
      requestBody: entry.requestBody || null,
      responseStatus: entry.responseStatus || null,
      additionalDetails: entry.details || null,
    };

    // Generate checksum for tamper detection
    const checksum = generateChecksum(entry.action, details, entry.timestamp);

    await pool.query(
      `INSERT INTO audit_log (action, details, checksum, created_at)
       VALUES ($1, $2, $3, $4)`,
      [
        entry.action,
        JSON.stringify(details),
        checksum,
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
