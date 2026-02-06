import rateLimit from 'express-rate-limit';

/**
 * Rate Limiting Configuration
 *
 * Prevents API abuse by limiting requests per IP address.
 * SECURITY: Rate limiting is enforced in ALL environments including development.
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
  // SECURITY: Never skip rate limiting - removed skip function
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
  // SECURITY: Never skip rate limiting
});

// Very strict rate limit for critical/dangerous endpoints (wallet sweep, kill switch)
export const criticalLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // Only 5 critical operations per hour
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many critical operations. Please wait before trying again.',
    code: 'CRITICAL_RATE_LIMIT_EXCEEDED',
  },
  // SECURITY: Never skip rate limiting for critical operations
});
