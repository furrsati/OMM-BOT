import rateLimit from 'express-rate-limit';

/**
 * Rate Limiting Configuration
 *
 * Prevents API abuse by limiting requests per IP address
 */

// General API rate limit: 100 requests per 15 minutes
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per window
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  message: {
    success: false,
    error: 'Too many requests from this IP, please try again later.',
    code: 'RATE_LIMIT_EXCEEDED',
  },
  skip: (_req) => {
    // Skip rate limiting in development
    return process.env.NODE_ENV === 'development';
  },
});

// Stricter rate limit for control endpoints (pause, resume, kill-switch)
export const controlLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 10, // Limit each IP to 10 control actions per window
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many control requests, please try again later.',
    code: 'CONTROL_RATE_LIMIT_EXCEEDED',
  },
  skip: (_req) => {
    return process.env.NODE_ENV === 'development';
  },
});
