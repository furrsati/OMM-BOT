/**
 * RPC Rate Limiter
 *
 * Prevents overwhelming Solana RPC endpoints (Helius, etc.) with too many requests.
 * Implements a token bucket algorithm with configurable rates.
 *
 * Helius free tier: ~10 requests/second
 * Helius paid tier: ~50-100 requests/second
 */

import { logger } from './logger';

interface RateLimiterConfig {
  maxRequestsPerSecond: number;
  maxBurst: number;
  name: string;
}

interface QueuedRequest<T> {
  execute: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  priority: number;
}

export class RateLimiter {
  private tokens: number;
  private maxTokens: number;
  private refillRate: number; // tokens per ms
  private lastRefill: number;
  private queue: QueuedRequest<any>[] = [];
  private processing: boolean = false;
  private name: string;
  private requestCount: number = 0;
  private lastRequestCountReset: number = Date.now();

  constructor(config: RateLimiterConfig) {
    this.maxTokens = config.maxBurst;
    this.tokens = config.maxBurst;
    this.refillRate = config.maxRequestsPerSecond / 1000; // per ms
    this.lastRefill = Date.now();
    this.name = config.name;
  }

  /**
   * Execute a function with rate limiting
   */
  async execute<T>(fn: () => Promise<T>, priority: number = 0): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push({ execute: fn, resolve, reject, priority });

      // Sort by priority (higher = more important)
      this.queue.sort((a, b) => b.priority - a.priority);

      this.processQueue();
    });
  }

  /**
   * Process queued requests
   */
  private async processQueue(): Promise<void> {
    if (this.processing || this.queue.length === 0) {
      return;
    }

    this.processing = true;

    while (this.queue.length > 0) {
      this.refillTokens();

      if (this.tokens < 1) {
        // Wait for tokens to refill
        const waitTime = Math.ceil((1 - this.tokens) / this.refillRate);
        await this.sleep(Math.min(waitTime, 1000)); // Max 1 second wait
        continue;
      }

      // Consume a token and process request
      this.tokens -= 1;
      const request = this.queue.shift()!;

      // Track request count for logging
      this.requestCount++;
      const now = Date.now();
      if (now - this.lastRequestCountReset > 10000) {
        const rate = this.requestCount / ((now - this.lastRequestCountReset) / 1000);
        if (rate > 5) {
          logger.debug(`[${this.name}] RPC rate: ${rate.toFixed(1)}/s, queue: ${this.queue.length}`);
        }
        this.requestCount = 0;
        this.lastRequestCountReset = now;
      }

      try {
        const result = await request.execute();
        request.resolve(result);
      } catch (error: any) {
        // Check for rate limit error from RPC
        if (error.message?.includes('429') || error.message?.includes('Too Many Requests')) {
          logger.warn(`[${this.name}] RPC rate limit hit, backing off...`);
          // Reduce tokens significantly on rate limit
          this.tokens = Math.min(this.tokens, 0);
          // Re-queue the request with slight delay
          await this.sleep(2000);
          this.queue.unshift(request);
        } else {
          request.reject(error);
        }
      }

      // Small delay between requests to smooth out bursts
      await this.sleep(50);
    }

    this.processing = false;
  }

  /**
   * Refill tokens based on elapsed time
   */
  private refillTokens(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    const newTokens = elapsed * this.refillRate;

    this.tokens = Math.min(this.maxTokens, this.tokens + newTokens);
    this.lastRefill = now;
  }

  /**
   * Get current queue length
   */
  getQueueLength(): number {
    return this.queue.length;
  }

  /**
   * Get current token count
   */
  getTokens(): number {
    this.refillTokens();
    return this.tokens;
  }

  /**
   * Clear the queue (for shutdown)
   */
  clear(): void {
    for (const request of this.queue) {
      request.reject(new Error('Rate limiter cleared'));
    }
    this.queue = [];
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Global RPC rate limiter instance
 * Configured for Helius free tier limits (conservative)
 */
let globalRateLimiter: RateLimiter | null = null;

export function getRPCRateLimiter(): RateLimiter {
  if (!globalRateLimiter) {
    // Conservative limits for Helius free tier
    // Adjust these based on your plan
    const maxRPS = parseInt(process.env.RPC_MAX_REQUESTS_PER_SECOND || '8', 10);
    const maxBurst = parseInt(process.env.RPC_MAX_BURST || '15', 10);

    globalRateLimiter = new RateLimiter({
      name: 'RPC',
      maxRequestsPerSecond: maxRPS,
      maxBurst: maxBurst,
    });

    logger.info(`RPC Rate Limiter initialized: ${maxRPS} req/s, burst: ${maxBurst}`);
  }
  return globalRateLimiter;
}

/**
 * Convenience wrapper for rate-limited RPC calls
 */
export async function rateLimitedRPC<T>(
  fn: () => Promise<T>,
  priority: number = 0
): Promise<T> {
  return getRPCRateLimiter().execute(fn, priority);
}

/**
 * Batch multiple RPC calls with rate limiting
 * Processes in parallel but respects rate limits
 */
export async function batchRateLimitedRPC<T>(
  fns: Array<() => Promise<T>>,
  priority: number = 0
): Promise<T[]> {
  const limiter = getRPCRateLimiter();
  return Promise.all(fns.map(fn => limiter.execute(fn, priority)));
}
