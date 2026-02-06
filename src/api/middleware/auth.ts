import { Request, Response, NextFunction } from 'express';
import { createHash, timingSafeEqual } from 'crypto';
import { logger } from '../../utils/logger';

/**
 * Authentication Middleware
 *
 * Provides API key authentication for protecting sensitive endpoints.
 * Uses timing-safe comparison to prevent timing attacks.
 */

export interface AuthenticatedRequest extends Request {
  apiKeyId?: string;
  isAuthenticated?: boolean;
}

/**
 * Hash API key for secure comparison
 */
function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/**
 * Timing-safe comparison of API keys
 */
function secureCompare(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) {
      return false;
    }
    return timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

/**
 * Get configured API keys from environment
 * Supports multiple keys: API_KEY, API_KEY_1, API_KEY_2, etc.
 */
function getConfiguredApiKeys(): Map<string, string> {
  const keys = new Map<string, string>();

  // Primary API key
  if (process.env.API_KEY) {
    keys.set('primary', hashApiKey(process.env.API_KEY));
  }

  // Dashboard API key (separate for dashboard access)
  if (process.env.DASHBOARD_API_KEY) {
    keys.set('dashboard', hashApiKey(process.env.DASHBOARD_API_KEY));
  }

  // Additional numbered keys (for key rotation)
  for (let i = 1; i <= 5; i++) {
    const key = process.env[`API_KEY_${i}`];
    if (key) {
      keys.set(`key_${i}`, hashApiKey(key));
    }
  }

  return keys;
}

/**
 * Extract API key from request
 * Supports: Authorization header (Bearer), X-API-Key header, query parameter
 */
function extractApiKey(req: Request): string | null {
  // Check Authorization header (Bearer token)
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }

  // Check X-API-Key header
  const apiKeyHeader = req.headers['x-api-key'];
  if (typeof apiKeyHeader === 'string') {
    return apiKeyHeader;
  }

  // Check query parameter (least preferred, but useful for testing)
  const queryKey = req.query.api_key;
  if (typeof queryKey === 'string') {
    return queryKey;
  }

  return null;
}

/**
 * Validate API key and return key identifier
 */
function validateApiKey(providedKey: string): string | null {
  const configuredKeys = getConfiguredApiKeys();

  if (configuredKeys.size === 0) {
    // No API keys configured - log warning but don't authenticate
    logger.warn('No API keys configured - authentication disabled');
    return null;
  }

  const hashedProvided = hashApiKey(providedKey);

  for (const [keyId, hashedKey] of configuredKeys) {
    if (secureCompare(hashedProvided, hashedKey)) {
      return keyId;
    }
  }

  return null;
}

/**
 * Authentication middleware for sensitive endpoints
 * Requires valid API key in Authorization header, X-API-Key header, or query param
 */
export const requireAuth = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void => {
  const providedKey = extractApiKey(req);

  if (!providedKey) {
    logger.warn('Authentication failed - no API key provided', {
      path: req.path,
      method: req.method,
      ip: req.ip,
    });

    res.status(401).json({
      success: false,
      error: 'Authentication required',
      code: 'AUTH_REQUIRED',
    });
    return;
  }

  const keyId = validateApiKey(providedKey);

  if (!keyId) {
    logger.warn('Authentication failed - invalid API key', {
      path: req.path,
      method: req.method,
      ip: req.ip,
    });

    res.status(401).json({
      success: false,
      error: 'Invalid API key',
      code: 'INVALID_API_KEY',
    });
    return;
  }

  // Attach auth info to request
  req.apiKeyId = keyId;
  req.isAuthenticated = true;

  logger.debug('Authentication successful', {
    keyId,
    path: req.path,
    method: req.method,
  });

  next();
};

/**
 * Optional authentication middleware
 * Attempts to authenticate but allows request to proceed if no key provided
 * Sets isAuthenticated flag for downstream handlers
 */
export const optionalAuth = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void => {
  const providedKey = extractApiKey(req);

  if (providedKey) {
    const keyId = validateApiKey(providedKey);
    if (keyId) {
      req.apiKeyId = keyId;
      req.isAuthenticated = true;
    } else {
      // Invalid key provided - still reject
      res.status(401).json({
        success: false,
        error: 'Invalid API key',
        code: 'INVALID_API_KEY',
      });
      return;
    }
  } else {
    req.isAuthenticated = false;
  }

  next();
};

/**
 * Check if API key authentication is configured
 */
export function isAuthConfigured(): boolean {
  return getConfiguredApiKeys().size > 0;
}
