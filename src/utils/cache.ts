import { setCache, getCache, deleteCache } from '../db/cache';
import { query } from '../db/postgres';
import { logger } from './logger';

/**
 * PostgreSQL Cache Manager for high-frequency data caching
 * Uses PostgreSQL-based caching with in-memory fallback
 */
class CacheManager {
  private enabled: boolean = true;
  private memoryCache: Map<string, { value: any; expiresAt: number }> = new Map();
  private cleanupIntervalId: NodeJS.Timeout | null = null;

  // Memory management - prevent unbounded cache growth
  private readonly MAX_MEMORY_CACHE_SIZE = 400; // Proportional for 2GB RAM (200 * 2)

  async initialize(): Promise<void> {
    try {
      // Test PostgreSQL connection
      await query('SELECT 1');
      this.enabled = true;
      logger.info('✅ Cache Manager initialized (PostgreSQL)');
    } catch (error: any) {
      logger.warn('Cache disabled - PostgreSQL not available, using memory cache only', {
        error: error.message
      });
      this.enabled = false;
    }
  }

  async get<T>(key: string): Promise<T | null> {
    // Try PostgreSQL cache first
    if (this.enabled) {
      try {
        const value = await getCache<T>(key);
        if (value !== null) {
          return value;
        }
      } catch (error: any) {
        logger.debug('Cache get error (PostgreSQL)', { key, error: error.message });
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
    // Try PostgreSQL cache first
    if (this.enabled) {
      try {
        await setCache(key, value, ttlSeconds);
        return;
      } catch (error: any) {
        logger.debug('Cache set error (PostgreSQL)', { key, error: error.message });
      }
    }

    // Fallback to memory cache
    // Enforce size limit - evict oldest entries if at capacity
    if (this.memoryCache.size >= this.MAX_MEMORY_CACHE_SIZE) {
      this.cleanupMemoryCache(); // First try removing expired

      // If still at capacity, remove oldest entries
      if (this.memoryCache.size >= this.MAX_MEMORY_CACHE_SIZE) {
        const entriesToRemove = Math.max(1, Math.floor(this.MAX_MEMORY_CACHE_SIZE * 0.1)); // Remove 10%
        const keys = Array.from(this.memoryCache.keys()).slice(0, entriesToRemove);
        for (const k of keys) {
          this.memoryCache.delete(k);
        }
      }
    }

    this.memoryCache.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000
    });
  }

  async del(key: string): Promise<void> {
    // Try PostgreSQL cache first
    if (this.enabled) {
      try {
        await deleteCache(key);
      } catch (error: any) {
        logger.debug('Cache delete error (PostgreSQL)', { key, error: error.message });
      }
    }

    // Fallback to memory cache
    this.memoryCache.delete(key);
  }

  async delPattern(pattern: string): Promise<void> {
    if (this.enabled) {
      try {
        // Convert wildcard pattern to SQL LIKE pattern
        const likePattern = pattern.replace(/\*/g, '%');
        await query('DELETE FROM cache WHERE key LIKE $1', [likePattern]);
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
    // PostgreSQL connection is managed by the pool, no need to close here
    this.stop();
  }

  // Start periodic cleanup (call after initialize)
  startCleanupInterval(): void {
    if (this.cleanupIntervalId) return; // Already running
    this.cleanupIntervalId = setInterval(() => {
      this.cleanupMemoryCache();
    }, 5 * 60 * 1000); // 5 minutes
  }

  // Stop cleanup interval and clear cache (call on shutdown)
  stop(): void {
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId);
      this.cleanupIntervalId = null;
    }
    this.memoryCache.clear();
  }

  getStats() {
    return {
      enabled: this.enabled,
      type: this.enabled ? 'postgresql' : 'memory',
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

// Start cleanup interval - this is now properly tracked and can be stopped
cacheManager.startCleanupInterval();
