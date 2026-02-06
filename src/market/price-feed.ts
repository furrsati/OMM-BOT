/**
 * Price Feed System
 *
 * Provides real-time token price data:
 * - Fetches prices from Raydium, Jupiter, and other DEXs
 * - Caches prices in Redis with TTL
 * - Tracks price history for pattern detection
 * - Calculates dip depth, ATH distance, volume
 *
 * Price sources (in order of preference):
 * 1. Jupiter Aggregator API (best liquidity aggregation)
 * 2. Raydium SDK (direct pool queries)
 * 3. On-chain pool state parsing (fallback)
 */

import { Connection } from '@solana/web3.js';
import axios from 'axios';
import { logger } from '../utils/logger';

interface TokenPrice {
  tokenAddress: string;
  priceUSD: number;
  priceSOL: number;
  volume24h: number;
  priceChange24h: number;
  liquidityUSD: number;
  timestamp: number;
}

interface PriceHistory {
  prices: { time: number; price: number }[];
  ath: number;
  athTime: number;
  localHigh: number;
  localHighTime: number;
}

export class PriceFeed {
  private connection: Connection;
  private priceCache: Map<string, TokenPrice> = new Map();
  private updateIntervalMs: number = 10000; // 10 seconds
  private monitoredTokens: Set<string> = new Set();
  private isRunning: boolean = false;

  constructor(connection: Connection) {
    this.connection = connection;
  }

  /**
   * Start price feed monitoring
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Price feed already running');
      return;
    }

    this.isRunning = true;
    logger.info('📊 Starting price feed...');

    // Start price update loop
    this.updateLoop();
  }

  /**
   * Stop price feed
   */
  stop(): void {
    this.isRunning = false;
    logger.info('Price feed stopped');
  }

  /**
   * Add token to monitoring
   */
  addToken(tokenAddress: string): void {
    if (!this.monitoredTokens.has(tokenAddress)) {
      this.monitoredTokens.add(tokenAddress);
      logger.debug(`Added token ${tokenAddress.slice(0, 8)}... to price monitoring`);
    }
  }

  /**
   * Remove token from monitoring
   */
  removeToken(tokenAddress: string): void {
    this.monitoredTokens.delete(tokenAddress);
    logger.debug(`Removed token ${tokenAddress.slice(0, 8)}... from price monitoring`);
  }

  /**
   * Get current price for a token
   */
  async getPrice(tokenAddress: string): Promise<TokenPrice | null> {
    // Check cache first
    const cached = this.priceCache.get(tokenAddress);
    if (cached && Date.now() - cached.timestamp < this.updateIntervalMs) {
      return cached;
    }

    // Fetch fresh price
    const price = await this.fetchPrice(tokenAddress);
    if (price) {
      this.priceCache.set(tokenAddress, price);
      await this.savePriceToHistory(price);
    }

    return price;
  }

  /**
   * Get price history for a token
   */
  async getPriceHistory(tokenAddress: string, _hours: number = 24): Promise<PriceHistory | null> {
    try {
      // REDIS REMOVED - caching disabled
      // const key = `price_history:${tokenAddress}`;
      // const data = await this.redis.get(key);

      // if (!data) {
      //   return null;
      // }

      // const history: PriceHistory = JSON.parse(data);

      // // Filter to requested time window
      // const cutoff = Date.now() - (hours * 60 * 60 * 1000);
      // history.prices = history.prices.filter(p => p.time > cutoff);

      // return history;
      return null; // Redis disabled, no price history available

    } catch (error: any) {
      logger.error('Error getting price history', { error: error.message });
      return null;
    }
  }

  /**
   * Calculate dip depth from local high
   */
  async getDipDepth(tokenAddress: string): Promise<number> {
    const history = await this.getPriceHistory(tokenAddress, 4); // Last 4 hours
    if (!history || history.prices.length === 0) {
      return 0;
    }

    const currentPrice = await this.getPrice(tokenAddress);
    if (!currentPrice) {
      return 0;
    }

    // Calculate dip from local high
    const dipPercent = ((history.localHigh - currentPrice.priceUSD) / history.localHigh) * 100;

    return Math.max(0, dipPercent);
  }

  /**
   * Calculate distance from ATH
   */
  async getDistanceFromATH(tokenAddress: string): Promise<number> {
    const history = await this.getPriceHistory(tokenAddress, 24);
    if (!history) {
      return 0;
    }

    const currentPrice = await this.getPrice(tokenAddress);
    if (!currentPrice) {
      return 0;
    }

    const distancePercent = ((history.ath - currentPrice.priceUSD) / history.ath) * 100;

    return Math.max(0, distancePercent);
  }

  /**
   * Price update loop
   */
  private async updateLoop(): Promise<void> {
    while (this.isRunning) {
      try {
        // Update prices for all monitored tokens
        const updatePromises = Array.from(this.monitoredTokens).map(tokenAddress =>
          this.updateTokenPrice(tokenAddress)
        );

        await Promise.allSettled(updatePromises);

        // Wait before next update
        await this.sleep(this.updateIntervalMs);

      } catch (error: any) {
        logger.error('Error in price update loop', { error: error.message });
        await this.sleep(5000);
      }
    }
  }

  /**
   * Update price for a single token
   */
  private async updateTokenPrice(tokenAddress: string): Promise<void> {
    try {
      const price = await this.fetchPrice(tokenAddress);
      if (price) {
        this.priceCache.set(tokenAddress, price);
        await this.savePriceToHistory(price);
      }
    } catch (error: any) {
      logger.debug(`Error updating price for ${tokenAddress.slice(0, 8)}...`, {
        error: error.message
      });
    }
  }

  /**
   * Fetch price from external sources
   */
  private async fetchPrice(tokenAddress: string): Promise<TokenPrice | null> {
    // Try Jupiter first (best aggregation)
    const jupiterPrice = await this.fetchFromJupiter(tokenAddress);
    if (jupiterPrice) {
      return jupiterPrice;
    }

    // Try Raydium as fallback
    const raydiumPrice = await this.fetchFromRaydium(tokenAddress);
    if (raydiumPrice) {
      return raydiumPrice;
    }

    // Try on-chain fallback
    const onChainPrice = await this.fetchOnChain(tokenAddress);
    if (onChainPrice) {
      return onChainPrice;
    }

    logger.warn(`Could not fetch price for ${tokenAddress.slice(0, 8)}...`);
    return null;
  }

  /**
   * Fetch price from Jupiter API
   */
  private async fetchFromJupiter(tokenAddress: string): Promise<TokenPrice | null> {
    try {
      const response = await axios.get(`https://price.jup.ag/v4/price`, {
        params: {
          ids: tokenAddress
        },
        timeout: 5000
      });

      const data = response.data?.data?.[tokenAddress];
      if (!data) {
        return null;
      }

      return {
        tokenAddress,
        priceUSD: data.price || 0,
        priceSOL: 0, // Jupiter doesn't provide SOL price directly
        volume24h: 0, // Not available from Jupiter price API
        priceChange24h: 0,
        liquidityUSD: 0,
        timestamp: Date.now()
      };

    } catch (error: any) {
      logger.debug('Jupiter price fetch failed', { error: error.message });
      return null;
    }
  }

  /**
   * Fetch price from Raydium
   * STUB: Full implementation requires Raydium SDK integration
   */
  private async fetchFromRaydium(_tokenAddress: string): Promise<TokenPrice | null> {
    try {
      // STUB: In production, use Raydium SDK to query pool state
      // Example:
      // const poolKeys = await getRaydiumPoolKeys(tokenAddress);
      // const poolInfo = await getPoolInfo(poolKeys);
      // Calculate price from reserves

      logger.debug('Raydium price fetch (STUB)');
      return null;

    } catch (error: any) {
      logger.debug('Raydium price fetch failed', { error: error.message });
      return null;
    }
  }

  /**
   * Fetch price from on-chain pool state
   * STUB: Requires pool parsing logic
   */
  private async fetchOnChain(_tokenAddress: string): Promise<TokenPrice | null> {
    try {
      // STUB: Parse pool account data directly
      // This is the most reliable but slowest method

      logger.debug('On-chain price fetch (STUB)');
      return null;

    } catch (error: any) {
      logger.debug('On-chain price fetch failed', { error: error.message });
      return null;
    }
  }

  /**
   * Save price to history
   */
  private async savePriceToHistory(_price: TokenPrice): Promise<void> {
    try {
      // REDIS REMOVED - caching disabled
      // const key = `price_history:${price.tokenAddress}`;

      // // Get existing history
      // const existing = await this.redis.get(key);
      // let history: PriceHistory;

      // if (existing) {
      //   history = JSON.parse(existing);
      // } else {
      //   history = {
      //     prices: [],
      //     ath: price.priceUSD,
      //     athTime: price.timestamp,
      //     localHigh: price.priceUSD,
      //     localHighTime: price.timestamp
      //   };
      // }

      // // Add new price point
      // history.prices.push({
      //   time: price.timestamp,
      //   price: price.priceUSD
      // });

      // // Keep only last 48 hours
      // const cutoff = Date.now() - (48 * 60 * 60 * 1000);
      // history.prices = history.prices.filter(p => p.time > cutoff);

      // // Update ATH
      // if (price.priceUSD > history.ath) {
      //   history.ath = price.priceUSD;
      //   history.athTime = price.timestamp;
      // }

      // // Update local high (last 4 hours)
      // const fourHoursAgo = Date.now() - (4 * 60 * 60 * 1000);
      // const recentPrices = history.prices.filter(p => p.time > fourHoursAgo);
      // if (recentPrices.length > 0) {
      //   const localMax = Math.max(...recentPrices.map(p => p.price));
      //   if (localMax > history.localHigh || price.timestamp - history.localHighTime > 4 * 60 * 60 * 1000) {
      //     history.localHigh = localMax;
      //     const localMaxPoint = recentPrices.find(p => p.price === localMax);
      //     history.localHighTime = localMaxPoint?.time || price.timestamp;
      //   }
      // }

      // // Save back to Redis (expire after 7 days)
      // await this.redis.setEx(key, 7 * 24 * 60 * 60, JSON.stringify(history));

    } catch (error: any) {
      logger.debug('Error saving price history', { error: error.message });
    }
  }

  /**
   * Helper: Sleep
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get SOL price in USD
   */
  async getSOLPrice(): Promise<number> {
    const SOL_MINT = 'So11111111111111111111111111111111111111112';
    const price = await this.getPrice(SOL_MINT);
    return price?.priceUSD || 0;
  }

  /**
   * Get all monitored tokens
   */
  getMonitoredTokens(): string[] {
    return Array.from(this.monitoredTokens);
  }
}
