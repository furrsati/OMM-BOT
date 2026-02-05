import { Request, Response, NextFunction } from 'express';
import { logger } from '../../utils/logger';

export interface APIError extends Error {
  statusCode?: number;
  code?: string;
}

/**
 * Global Error Handler Middleware
 *
 * Catches all errors thrown in routes and formats them consistently
 */
export const errorHandler = (
  err: APIError,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  next: NextFunction
) => {
  // Log error details
  logger.error('API Error', {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    statusCode: err.statusCode || 500,
  });

  // Determine status code
  const statusCode = err.statusCode || 500;

  // Don't expose stack traces in production
  const errorResponse: any = {
    success: false,
    error: err.message || 'Internal Server Error',
    code: err.code || 'INTERNAL_ERROR',
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
export const asyncHandler = (fn: Function) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
