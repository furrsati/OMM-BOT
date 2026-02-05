import { createClient, RedisClientType } from 'redis';
import { logger } from '../utils/logger';

/**
 * Redis Connection Manager
 *
 * Provides caching, real-time data storage, and pub/sub capabilities.
 * Used for token metadata cache, wallet activity tracking, and rate limiting.
 */

let client: RedisClientType | null = null;

/**
 * Initialize Redis connection
 */
export async function initializeRedis(): Promise<RedisClientType> {
  if (client) {
    return client;
  }

  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

  client = createClient({
    url: redisUrl,
    socket: {
      reconnectStrategy: (retries) => {
        if (retries > 10) {
          logger.error('Redis max reconnection attempts reached');
          return new Error('Redis reconnection failed');
        }
        const delay = Math.min(retries * 100, 3000);
        logger.warn(`Redis reconnecting in ${delay}ms (attempt ${retries})`);
        return delay;
      }
    }
  });

  // Error handling
  client.on('error', (err) => {
    logger.error('Redis client error', { error: err.message });
  });

  client.on('connect', () => {
    logger.info('Redis connection established');
  });

  client.on('reconnecting', () => {
    logger.warn('Redis reconnecting...');
  });

  client.on('ready', () => {
    logger.info('Redis client ready');
  });

  await client.connect();
  logger.info('Redis initialized successfully');

  return client;
}

/**
 * Get Redis client
 */
export function getRedisClient(): RedisClientType {
  if (!client) {
    throw new Error('Redis client not initialized. Call initializeRedis() first.');
  }
  return client;
}

/**
 * Cache utilities
 */

/**
 * Set value with optional TTL (time to live in seconds)
 */
export async function setCache(
  key: string,
  value: any,
  ttl?: number
): Promise<void> {
  const client = getRedisClient();
  const serialized = JSON.stringify(value);

  try {
    if (ttl) {
      await client.setEx(key, ttl, serialized);
    } else {
      await client.set(key, serialized);
    }
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
  const client = getRedisClient();

  try {
    const value = await client.get(key);
    if (!value) {
      return null;
    }
    return JSON.parse(value) as T;
  } catch (error: any) {
    logger.error('Failed to get cache', { key, error: error.message });
    return null;
  }
}

/**
 * Delete value from cache
 */
export async function deleteCache(key: string): Promise<void> {
  const client = getRedisClient();

  try {
    await client.del(key);
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
  const client = getRedisClient();

  try {
    const exists = await client.exists(key);
    return exists === 1;
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
  const client = getRedisClient();

  try {
    const value = await client.incr(key);
    if (ttl && value === 1) {
      await client.expire(key, ttl);
    }
    return value;
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
  const key = `ratelimit:${identifier}`;
  const count = await incrementCounter(key, windowSeconds);

  return {
    allowed: count <= limit,
    remaining: Math.max(0, limit - count)
  };
}

/**
 * Health check
 */
export async function healthCheck(): Promise<boolean> {
  try {
    const client = getRedisClient();
    const result = await client.ping();
    return result === 'PONG';
  } catch (error) {
    logger.error('Redis health check failed', { error });
    return false;
  }
}

/**
 * Close connection
 */
export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit();
    client = null;
    logger.info('Redis connection closed');
  }
}

/**
 * Convenience export
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
