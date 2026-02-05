import { query } from './postgres';
import { logger } from '../utils/logger';

/**
 * PostgreSQL-based Cache Manager (Replaces Redis)
 *
 * Provides caching, real-time data storage, and rate limiting capabilities
 * using PostgreSQL instead of Redis.
 * Used for token metadata cache, wallet activity tracking, and rate limiting.
 */

let isInitialized = false;

/**
 * Initialize cache (cleanup expired entries on startup)
 */
export async function initializeCache(): Promise<void> {
  if (isInitialized) {
    return;
  }

  try {
    // Clean up expired cache entries
    await query('DELETE FROM cache WHERE expires_at IS NOT NULL AND expires_at < NOW()');
    await query('DELETE FROM rate_limits WHERE expires_at < NOW()');

    logger.info('Cache initialized successfully');
    isInitialized = true;
  } catch (error: any) {
    logger.error('Failed to initialize cache', { error: error.message });
    throw error;
  }
}

/**
 * Background cleanup job - run periodically to remove expired entries
 */
export async function cleanupExpiredCache(): Promise<void> {
  try {
    const cacheResult = await query('DELETE FROM cache WHERE expires_at IS NOT NULL AND expires_at < NOW()');
    const rateLimitResult = await query('DELETE FROM rate_limits WHERE expires_at < NOW()');

    const totalDeleted = (cacheResult.rowCount || 0) + (rateLimitResult.rowCount || 0);
    if (totalDeleted > 0) {
      logger.debug(`Cleaned up ${totalDeleted} expired cache entries`);
    }
  } catch (error: any) {
    logger.error('Failed to cleanup expired cache', { error: error.message });
  }
}

/**
 * Set value with optional TTL (time to live in seconds)
 */
export async function setCache(
  key: string,
  value: any,
  ttl?: number
): Promise<void> {
  const serialized = JSON.stringify(value);
  const expiresAt = ttl ? new Date(Date.now() + ttl * 1000) : null;

  try {
    await query(
      `INSERT INTO cache (key, value, expires_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (key)
       DO UPDATE SET value = $2, expires_at = $3, created_at = NOW()`,
      [key, serialized, expiresAt]
    );
    logger.debug('Cache set', { key, ttl });
  } catch (error: any) {
    logger.error('Failed to set cache', { key, error: error.message });
    throw error;
  }
}

/**
 * Get value from cache
 */
export async function getCache<T = any>(key: string): Promise<T | null> {
  try {
    const result = await query(
      `SELECT value FROM cache
       WHERE key = $1
       AND (expires_at IS NULL OR expires_at > NOW())`,
      [key]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return JSON.parse(result.rows[0].value) as T;
  } catch (error: any) {
    logger.error('Failed to get cache', { key, error: error.message });
    return null;
  }
}

/**
 * Delete value from cache
 */
export async function deleteCache(key: string): Promise<void> {
  try {
    await query('DELETE FROM cache WHERE key = $1', [key]);
    logger.debug('Cache deleted', { key });
  } catch (error: any) {
    logger.error('Failed to delete cache', { key, error: error.message });
    throw error;
  }
}

/**
 * Check if key exists
 */
export async function existsCache(key: string): Promise<boolean> {
  try {
    const result = await query(
      `SELECT 1 FROM cache
       WHERE key = $1
       AND (expires_at IS NULL OR expires_at > NOW())`,
      [key]
    );
    return result.rows.length > 0;
  } catch (error: any) {
    logger.error('Failed to check cache existence', { key, error: error.message });
    return false;
  }
}

/**
 * Increment counter (useful for rate limiting)
 */
export async function incrementCounter(
  key: string,
  ttl?: number
): Promise<number> {
  try {
    // Try to increment existing counter
    const result = await query(
      `UPDATE cache
       SET value = (CAST(value AS INTEGER) + 1)::TEXT
       WHERE key = $1
       AND (expires_at IS NULL OR expires_at > NOW())
       RETURNING CAST(value AS INTEGER) as count`,
      [key]
    );

    if (result.rows.length > 0) {
      return result.rows[0].count;
    }

    // Create new counter if doesn't exist
    const expiresAt = ttl ? new Date(Date.now() + ttl * 1000) : null;
    await query(
      `INSERT INTO cache (key, value, expires_at)
       VALUES ($1, '1', $2)`,
      [key, expiresAt]
    );
    return 1;
  } catch (error: any) {
    logger.error('Failed to increment counter', { key, error: error.message });
    throw error;
  }
}

/**
 * Token metadata cache patterns
 */

export async function cacheTokenMetadata(
  tokenAddress: string,
  metadata: any,
  ttl: number = 300 // 5 minutes default
): Promise<void> {
  const key = `token:metadata:${tokenAddress}`;
  await setCache(key, metadata, ttl);
}

export async function getTokenMetadata(tokenAddress: string): Promise<any | null> {
  const key = `token:metadata:${tokenAddress}`;
  return await getCache(key);
}

/**
 * Wallet activity cache patterns
 */

export async function cacheWalletActivity(
  walletAddress: string,
  activity: any,
  ttl: number = 60 // 1 minute default
): Promise<void> {
  const key = `wallet:activity:${walletAddress}`;
  await setCache(key, activity, ttl);
}

export async function getWalletActivity(walletAddress: string): Promise<any | null> {
  const key = `wallet:activity:${walletAddress}`;
  return await getCache(key);
}

/**
 * Rate limiting pattern
 */

export async function checkRateLimit(
  identifier: string,
  limit: number,
  windowSeconds: number
): Promise<{ allowed: boolean; remaining: number }> {
  try {
    const now = new Date();
    const expiresAt = new Date(Date.now() + windowSeconds * 1000);

    // Try to get existing rate limit
    const result = await query(
      `SELECT count, window_start, window_seconds, expires_at
       FROM rate_limits
       WHERE identifier = $1 AND expires_at > NOW()`,
      [identifier]
    );

    if (result.rows.length === 0) {
      // Create new rate limit entry
      await query(
        `INSERT INTO rate_limits (identifier, count, window_start, window_seconds, expires_at)
         VALUES ($1, 1, $2, $3, $4)`,
        [identifier, now, windowSeconds, expiresAt]
      );
      return { allowed: true, remaining: limit - 1 };
    }

    const row = result.rows[0];
    const windowStart = new Date(row.window_start);
    const windowEnd = new Date(windowStart.getTime() + row.window_seconds * 1000);

    // Check if we're still in the same window
    if (now < windowEnd) {
      // Increment count
      const count = row.count + 1;
      await query(
        `UPDATE rate_limits
         SET count = $1
         WHERE identifier = $2`,
        [count, identifier]
      );

      return {
        allowed: count <= limit,
        remaining: Math.max(0, limit - count)
      };
    } else {
      // Start new window
      await query(
        `UPDATE rate_limits
         SET count = 1, window_start = $1, expires_at = $2
         WHERE identifier = $3`,
        [now, expiresAt, identifier]
      );
      return { allowed: true, remaining: limit - 1 };
    }
  } catch (error: any) {
    logger.error('Failed to check rate limit', { identifier, error: error.message });
    // On error, allow the request (fail open)
    return { allowed: true, remaining: limit };
  }
}

/**
 * Health check
 */
export async function healthCheck(): Promise<boolean> {
  try {
    await query('SELECT 1');
    return true;
  } catch (error) {
    logger.error('Cache health check failed', { error });
    return false;
  }
}

/**
 * Convenience export matching Redis interface
 */
export const cache = {
  set: setCache,
  get: getCache,
  delete: deleteCache,
  exists: existsCache,
  increment: incrementCounter,
  tokenMetadata: {
    set: cacheTokenMetadata,
    get: getTokenMetadata,
  },
  walletActivity: {
    set: cacheWalletActivity,
    get: getWalletActivity,
  },
  rateLimit: checkRateLimit,
};
