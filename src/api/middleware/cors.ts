import cors from 'cors';
import { logger } from '../../utils/logger';

/**
 * CORS Configuration
 *
 * SECURITY: Strict origin validation - no wildcard subdomains.
 * Only explicitly configured origins are allowed.
 *
 * Configure allowed origins via:
 * - CORS_ALLOWED_ORIGINS env var (comma-separated)
 * - DASHBOARD_URL env var
 */

// Build allowed origins list - ONLY explicit origins, no wildcards
const buildAllowedOrigins = (): Set<string> => {
  const origins = new Set<string>();

  // Development localhost origins (only in development)
  if (process.env.NODE_ENV === 'development') {
    origins.add('http://localhost:3000');
    origins.add('http://localhost:3001');
    origins.add('http://localhost:5173'); // Vite default
  }

  // Add origins from environment variable (comma-separated)
  // Example: CORS_ALLOWED_ORIGINS=https://dashboard.example.com,https://app.example.com
  if (process.env.CORS_ALLOWED_ORIGINS) {
    const envOrigins = process.env.CORS_ALLOWED_ORIGINS.split(',')
      .map(o => o.trim())
      .filter(o => o.length > 0);

    for (const origin of envOrigins) {
      // Validate origin format
      try {
        new URL(origin);
        origins.add(origin);
      } catch {
        logger.warn(`Invalid CORS origin ignored: ${origin}`);
      }
    }
  }

  // Add specific dashboard URL if provided
  if (process.env.DASHBOARD_URL) {
    try {
      new URL(process.env.DASHBOARD_URL);
      origins.add(process.env.DASHBOARD_URL);
    } catch {
      logger.warn(`Invalid DASHBOARD_URL ignored: ${process.env.DASHBOARD_URL}`);
    }
  }

  return origins;
};

const allowedOrigins = buildAllowedOrigins();

// Log configured origins on startup (without exposing in responses)
if (allowedOrigins.size > 0) {
  logger.info(`CORS configured with ${allowedOrigins.size} allowed origins`);
} else {
  logger.warn('No CORS origins configured - all cross-origin requests will be blocked in production');
}

export const corsMiddleware = cors({
  origin: (origin, callback) => {
    // Requests with no origin (server-to-server, curl) - only allow if API key is required
    // This is handled by the auth middleware, so we allow it here
    if (!origin) {
      return callback(null, true);
    }

    // Check if origin is in the explicit allowlist
    if (allowedOrigins.has(origin)) {
      callback(null, true);
    } else {
      logger.warn(`CORS blocked origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
  // Limit preflight cache to 1 hour
  maxAge: 3600,
});
