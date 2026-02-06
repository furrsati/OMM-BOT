import { Request, Response, NextFunction } from 'express';
import { logger } from '../../utils/logger';

export interface APIError extends Error {
  statusCode?: number;
  code?: string;
  isOperational?: boolean; // Distinguishes expected errors from bugs
}

/**
 * Map of internal error patterns to safe user-facing messages
 * SECURITY: Never expose internal details in error messages
 */
const SAFE_ERROR_MESSAGES: Record<string, string> = {
  'ECONNREFUSED': 'Service temporarily unavailable',
  'ETIMEDOUT': 'Request timed out',
  'ENOTFOUND': 'Service unavailable',
  'connect ECONNREFUSED': 'Database connection failed',
  'Connection terminated': 'Database connection lost',
  'syntax error': 'Invalid request',
  'duplicate key': 'Resource already exists',
  'violates foreign key': 'Invalid reference',
  'null value in column': 'Missing required field',
};

/**
 * Sanitize error message for external display
 * Removes internal details, file paths, stack traces
 */
function sanitizeErrorMessage(message: string, isOperational: boolean): string {
  // If it's an operational (expected) error, use the message as-is
  if (isOperational) {
    return message;
  }

  // Check for known error patterns and return safe message
  for (const [pattern, safeMessage] of Object.entries(SAFE_ERROR_MESSAGES)) {
    if (message.toLowerCase().includes(pattern.toLowerCase())) {
      return safeMessage;
    }
  }

  // Remove file paths and internal details
  if (message.includes('/') || message.includes('\\')) {
    return 'An internal error occurred';
  }

  // For unknown errors in production, return generic message
  if (process.env.NODE_ENV === 'production') {
    return 'An unexpected error occurred';
  }

  // In development, return the original message (but not stack)
  return message;
}

/**
 * Global Error Handler Middleware
 *
 * Catches all errors thrown in routes and formats them consistently.
 * SECURITY: Never exposes internal details in production.
 */
export const errorHandler = (
  err: APIError,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  next: NextFunction
) => {
  // Generate a unique error ID for correlation
  const errorId = `err_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 11)}`;

  // Log full error details (server-side only)
  logger.error('API Error', {
    errorId,
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    statusCode: err.statusCode || 500,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });

  // Determine status code
  const statusCode = err.statusCode || 500;

  // Sanitize error message for client
  const isOperational = err.isOperational === true || statusCode < 500;
  const safeMessage = sanitizeErrorMessage(err.message || 'Internal Server Error', isOperational);

  // Build response - minimal info in production
  const errorResponse: {
    success: boolean;
    error: string;
    code: string;
    errorId: string;
    stack?: string;
  } = {
    success: false,
    error: safeMessage,
    code: err.code || 'INTERNAL_ERROR',
    errorId, // Allow users to reference this when reporting issues
  };

  // Include stack trace only in development
  if (process.env.NODE_ENV === 'development') {
    errorResponse.stack = err.stack;
  }

  res.status(statusCode).json(errorResponse);
};

/**
 * Not Found Handler
 *
 * Handles 404 errors for routes that don't exist
 */
export const notFoundHandler = (
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  next: NextFunction
) => {
  res.status(404).json({
    success: false,
    error: `Route not found: ${req.method} ${req.path}`,
    code: 'ROUTE_NOT_FOUND',
  });
};

/**
 * Async Error Wrapper
 *
 * Wraps async route handlers to catch errors and pass to error handler
 */
export const asyncHandler = (
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
