import { createClient, RedisClientType } from 'redis';
import { logger } from './logger';

/**
 * Redis Cache Manager for high-frequency data caching
 * Falls back gracefully if Redis is unavailable
 */
class CacheManager {
  private client: RedisClientType | null = null;
  private enabled: boolean = false;
  private memoryCache: Map<string, { value: any; expiresAt: number }> = new Map();

  async initialize(): Promise<void> {
    try {
      this.client = createClient({
        url: process.env.REDIS_URL || 'redis://localhost:6379',
        socket: {
          reconnectStrategy: (retries) => {
            if (retries > 10) {
              logger.warn('Redis reconnection failed - falling back to memory cache');
              this.enabled = false;
              return new Error('Max reconnection attempts reached');
            }
            return Math.min(retries * 100, 3000);
          }
        }
      });

      this.client.on('error', (error) => {
        logger.debug('Redis client error', { error: error.message });
      });

      this.client.on('reconnecting', () => {
        logger.debug('Redis client reconnecting...');
      });

      await this.client.connect();
      this.enabled = true;
      logger.info('✅ Cache Manager initialized (Redis)');
    } catch (error: any) {
      logger.warn('Cache disabled - Redis not available, using memory cache', {
        error: error.message
      });
      this.enabled = false;
    }
  }

  async get<T>(key: string): Promise<T | null> {
    // Try Redis first
    if (this.enabled && this.client) {
      try {
        const value = await this.client.get(key);
        return value ? JSON.parse(value) : null;
      } catch (error: any) {
        logger.debug('Cache get error (Redis)', { key, error: error.message });
      }
    }

    // Fallback to memory cache
    const cached = this.memoryCache.get(key);
    if (cached) {
      if (Date.now() < cached.expiresAt) {
        return cached.value;
      }
      this.memoryCache.delete(key);
    }
    return null;
  }

  async set(key: string, value: any, ttlSeconds: number = 60): Promise<void> {
    // Try Redis first
    if (this.enabled && this.client) {
      try {
        await this.client.setEx(key, ttlSeconds, JSON.stringify(value));
        return;
      } catch (error: any) {
        logger.debug('Cache set error (Redis)', { key, error: error.message });
      }
    }

    // Fallback to memory cache
    this.memoryCache.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000
    });
  }

  async del(key: string): Promise<void> {
    // Try Redis first
    if (this.enabled && this.client) {
      try {
        await this.client.del(key);
      } catch (error: any) {
        logger.debug('Cache delete error (Redis)', { key, error: error.message });
      }
    }

    // Fallback to memory cache
    this.memoryCache.delete(key);
  }

  async delPattern(pattern: string): Promise<void> {
    if (this.enabled && this.client) {
      try {
        const keys = await this.client.keys(pattern);
        if (keys.length > 0) {
          await this.client.del(keys);
        }
      } catch (error: any) {
        logger.debug('Cache delete pattern error', { pattern, error: error.message });
      }
    }

    // For memory cache, delete matching keys
    for (const key of this.memoryCache.keys()) {
      if (this.matchPattern(key, pattern)) {
        this.memoryCache.delete(key);
      }
    }
  }

  private matchPattern(key: string, pattern: string): boolean {
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    return regex.test(key);
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.quit();
    }
    this.memoryCache.clear();
  }

  getStats() {
    return {
      enabled: this.enabled,
      type: this.enabled ? 'redis' : 'memory',
      memoryCacheSize: this.memoryCache.size
    };
  }

  // Cleanup expired memory cache entries
  cleanupMemoryCache(): void {
    const now = Date.now();
    for (const [key, cached] of this.memoryCache.entries()) {
      if (now >= cached.expiresAt) {
        this.memoryCache.delete(key);
      }
    }
  }
}

export const cacheManager = new CacheManager();

// Cleanup memory cache every 5 minutes
setInterval(() => {
  cacheManager.cleanupMemoryCache();
}, 5 * 60 * 1000);
