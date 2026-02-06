import { Connection, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { logger } from '../utils/logger';
import { rateLimitedRPC } from '../utils/rate-limiter';
import axios from 'axios';

/**
 * Free alternative to paid social media APIs
 * Uses on-chain metrics and free DEX data to detect hype
 */

export interface HypeMetrics {
  score: number; // 0-100
  holderGrowthRate: number; // holders per hour
  transactionVelocity: number; // transactions per minute
  volumeGrowth: number; // % growth in last hour
  uniqueBuyers: number; // unique buyers in last 15 min
  socialLinks: {
    twitter?: string;
    telegram?: string;
    website?: string;
  };
}

export class HypeDetector {
  private connection: Connection;
  private dexScreenerBaseUrl = 'https://api.dexscreener.com/latest/dex';
  private birdeyeBaseUrl = 'https://public-api.birdeye.so';

  // Cache for holder counts (to calculate growth rate)
  private holderCountCache: Map<string, { count: number; timestamp: number }[]> = new Map();

  // Memory management limits - reduced for 512MB instances
  private readonly MAX_CACHED_TOKENS = 20;
  private readonly MAX_HISTORY_PER_TOKEN = 5;

  constructor(connection: Connection) {
    this.connection = connection;
  }

  /**
   * Get hype metrics for a token (FREE - no API keys needed)
   */
  async getHypeMetrics(tokenAddress: string): Promise<HypeMetrics> {
    try {
      // Get DexScreener data (free, no auth required)
      const dexData = await this.getDexScreenerData(tokenAddress);

      // Calculate on-chain hype signals
      const holderGrowthRate = await this.calculateHolderGrowthRate(tokenAddress);
      const transactionVelocity = await this.calculateTransactionVelocity(tokenAddress);

      // Calculate hype score (0-100)
      const score = this.calculateHypeScore({
        holderGrowthRate,
        transactionVelocity,
        volumeChange: dexData.volumeChange24h || 0,
        priceChange: dexData.priceChange24h || 0,
      });

      return {
        score,
        holderGrowthRate,
        transactionVelocity,
        volumeGrowth: dexData.volumeChange24h || 0,
        uniqueBuyers: await this.getUniqueBuyersLast15Min(tokenAddress),
        socialLinks: dexData.socialLinks || {},
      };
    } catch (error: any) {
      logger.error('Failed to get hype metrics', { tokenAddress, error: error.message });
      // Return neutral metrics on error
      return {
        score: 50,
        holderGrowthRate: 0,
        transactionVelocity: 0,
        volumeGrowth: 0,
        uniqueBuyers: 0,
        socialLinks: {},
      };
    }
  }

  /**
   * Get token data from DexScreener (FREE API)
   */
  private async getDexScreenerData(tokenAddress: string): Promise<any> {
    try {
      const response = await axios.get(
        `${this.dexScreenerBaseUrl}/tokens/${tokenAddress}`,
        { timeout: 5000 }
      );

      if (response.data?.pairs && response.data.pairs.length > 0) {
        const pair = response.data.pairs[0]; // Get primary pair

        return {
          priceUsd: parseFloat(pair.priceUsd || '0'),
          volumeChange24h: parseFloat(pair.volume?.h24 || '0'),
          priceChange24h: parseFloat(pair.priceChange?.h24 || '0'),
          liquidity: parseFloat(pair.liquidity?.usd || '0'),
          socialLinks: {
            twitter: pair.info?.socials?.find((s: any) => s.type === 'twitter')?.url,
            telegram: pair.info?.socials?.find((s: any) => s.type === 'telegram')?.url,
            website: pair.info?.websites?.[0]?.url,
          },
        };
      }

      return {};
    } catch (error: any) {
      logger.warn('DexScreener API error', { tokenAddress, error: error.message });
      return {};
    }
  }

  /**
   * Calculate holder growth rate from on-chain data
   * Returns holders per hour based on recent measurements
   */
  private async calculateHolderGrowthRate(tokenAddress: string): Promise<number> {
    try {
      // Get current holder count
      const currentCount = await this.getHolderCount(tokenAddress);

      // Get cached history
      const history = this.holderCountCache.get(tokenAddress) || [];

      // Add current measurement
      const now = Date.now();
      history.push({ count: currentCount, timestamp: now });

      // Keep only last hour of history AND limit entries per token
      const oneHourAgo = now - (60 * 60 * 1000);
      let recentHistory = history.filter(h => h.timestamp > oneHourAgo);

      // Enforce per-token limit
      if (recentHistory.length > this.MAX_HISTORY_PER_TOKEN) {
        recentHistory = recentHistory.slice(-this.MAX_HISTORY_PER_TOKEN);
      }

      // Enforce total cache size limit
      if (this.holderCountCache.size >= this.MAX_CACHED_TOKENS && !this.holderCountCache.has(tokenAddress)) {
        const oldestKey = this.holderCountCache.keys().next().value;
        if (oldestKey) this.holderCountCache.delete(oldestKey);
      }

      this.holderCountCache.set(tokenAddress, recentHistory);

      // Need at least 2 measurements to calculate rate
      if (recentHistory.length < 2) {
        return 0;
      }

      // Calculate growth rate
      const oldest = recentHistory[0];
      const newest = recentHistory[recentHistory.length - 1];

      const holderChange = newest.count - oldest.count;
      const timeElapsedHours = (newest.timestamp - oldest.timestamp) / (60 * 60 * 1000);

      if (timeElapsedHours === 0) return 0;

      const growthRate = holderChange / timeElapsedHours;

      logger.debug('Holder growth rate calculated', {
        token: tokenAddress.slice(0, 8),
        oldestCount: oldest.count,
        newestCount: newest.count,
        growthRate: growthRate.toFixed(2) + '/hour'
      });

      return Math.max(0, growthRate);

    } catch (error: any) {
      logger.debug('Error calculating holder growth rate', { error: error.message });
      return 0;
    }
  }

  /**
   * Get current holder count for a token
   */
  private async getHolderCount(tokenAddress: string): Promise<number> {
    try {
      const tokenPubkey = new PublicKey(tokenAddress);

      const accounts = await rateLimitedRPC(
        () => this.connection.getProgramAccounts(
          TOKEN_PROGRAM_ID,
          {
            filters: [
              { dataSize: 165 },
              {
                memcmp: {
                  offset: 0,
                  bytes: tokenPubkey.toBase58()
                }
              }
            ]
          }
        ),
        2 // low priority - hype detection is not time-critical
      );

      // Count accounts with non-zero balance
      let holderCount = 0;
      for (const account of accounts) {
        const balance = account.account.data.readBigUInt64LE(64);
        if (balance > 0n) {
          holderCount++;
        }
      }

      return holderCount;

    } catch (error: any) {
      logger.debug('Error getting holder count', { error: error.message });
      return 0;
    }
  }

  /**
   * Calculate transaction velocity (txs per minute)
   */
  private async calculateTransactionVelocity(tokenAddress: string): Promise<number> {
    try {
      const tokenPubkey = new PublicKey(tokenAddress);

      // Get transactions from the last 5 minutes
      const signatures = await rateLimitedRPC(
        () => this.connection.getSignaturesForAddress(tokenPubkey, { limit: 100 }, 'confirmed'),
        2
      );

      const fiveMinutesAgo = Date.now() / 1000 - 300;
      const recentTxs = signatures.filter(s => s.blockTime && s.blockTime > fiveMinutesAgo);

      // Calculate transactions per minute
      if (recentTxs.length === 0) return 0;

      // Find the time span of recent transactions
      const timestamps = recentTxs
        .filter(s => s.blockTime)
        .map(s => s.blockTime as number);

      if (timestamps.length < 2) {
        return recentTxs.length / 5; // Assume spread over 5 minutes
      }

      const oldestTime = Math.min(...timestamps);
      const newestTime = Math.max(...timestamps);
      const timeSpanMinutes = (newestTime - oldestTime) / 60;

      if (timeSpanMinutes === 0) return recentTxs.length;

      const velocity = recentTxs.length / timeSpanMinutes;

      logger.debug('Transaction velocity calculated', {
        token: tokenAddress.slice(0, 8),
        txCount: recentTxs.length,
        velocity: velocity.toFixed(2) + '/min'
      });

      return velocity;

    } catch (error: any) {
      logger.debug('Error calculating transaction velocity', { error: error.message });
      return 0;
    }
  }

  /**
   * Count unique buyers in last 15 minutes
   */
  private async getUniqueBuyersLast15Min(tokenAddress: string): Promise<number> {
    try {
      const tokenPubkey = new PublicKey(tokenAddress);
      const fifteenMinutesAgo = Date.now() / 1000 - 900;

      const signatures = await rateLimitedRPC(
        () => this.connection.getSignaturesForAddress(tokenPubkey, { limit: 100 }, 'confirmed'),
        2
      );

      const recentSigs = signatures.filter(s => s.blockTime && s.blockTime > fifteenMinutesAgo);
      const uniqueBuyers = new Set<string>();

      for (const sig of recentSigs.slice(0, 30)) {
        try {
          const tx = await rateLimitedRPC(
            () => this.connection.getParsedTransaction(sig.signature, { maxSupportedTransactionVersion: 0 }),
            1 // lowest priority
          );

          if (!tx || !tx.meta) continue;

          const postBalances = tx.meta.postTokenBalances || [];
          const preBalances = tx.meta.preTokenBalances || [];

          for (const post of postBalances) {
            if (post.mint !== tokenAddress) continue;

            const pre = preBalances.find(p => p.accountIndex === post.accountIndex);
            const preAmount = parseInt(pre?.uiTokenAmount?.amount || '0');
            const postAmount = parseInt(post.uiTokenAmount?.amount || '0');

            // If balance increased, this is a buyer
            if (postAmount > preAmount && post.owner) {
              uniqueBuyers.add(post.owner);
            }
          }
        } catch (txError: any) {
          continue;
        }
      }

      logger.debug('Unique buyers counted', {
        token: tokenAddress.slice(0, 8),
        count: uniqueBuyers.size
      });

      return uniqueBuyers.size;

    } catch (error: any) {
      logger.debug('Error counting unique buyers', { error: error.message });
      return 0;
    }
  }

  /**
   * Calculate overall hype score (0-100)
   * FREE alternative to tracking Twitter mentions
   */
  private calculateHypeScore(metrics: {
    holderGrowthRate: number;
    transactionVelocity: number;
    volumeChange: number;
    priceChange: number;
  }): number {
    let score = 0;

    // Holder growth (0-30 points)
    if (metrics.holderGrowthRate > 100) score += 30; // 100+ holders/hour = max points
    else if (metrics.holderGrowthRate > 50) score += 20;
    else if (metrics.holderGrowthRate > 20) score += 10;
    else if (metrics.holderGrowthRate > 5) score += 5;

    // Transaction velocity (0-30 points)
    if (metrics.transactionVelocity > 10) score += 30; // 10+ txs/min = max points
    else if (metrics.transactionVelocity > 5) score += 20;
    else if (metrics.transactionVelocity > 2) score += 10;
    else if (metrics.transactionVelocity > 1) score += 5;

    // Volume growth (0-20 points)
    if (metrics.volumeChange > 500) score += 20; // 500%+ volume growth
    else if (metrics.volumeChange > 200) score += 15;
    else if (metrics.volumeChange > 100) score += 10;
    else if (metrics.volumeChange > 50) score += 5;

    // Price action (0-20 points)
    if (metrics.priceChange > 100) score += 20; // 100%+ price increase
    else if (metrics.priceChange > 50) score += 15;
    else if (metrics.priceChange > 20) score += 10;
    else if (metrics.priceChange > 10) score += 5;

    return Math.min(score, 100); // Cap at 100
  }

  /**
   * Check if token has basic social presence (FREE)
   */
  async hasSocialPresence(tokenAddress: string): Promise<boolean> {
    const metrics = await this.getHypeMetrics(tokenAddress);
    const { socialLinks } = metrics;

    // Token must have at least one social link
    return !!(socialLinks.twitter || socialLinks.telegram || socialLinks.website);
  }
}
