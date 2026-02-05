import { logger } from '../utils/logger';
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
  private dexScreenerBaseUrl = 'https://api.dexscreener.com/latest/dex';
  private birdeyeBaseUrl = 'https://public-api.birdeye.so';

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
   * This requires your RPC connection to query token accounts
   */
  private async calculateHolderGrowthRate(tokenAddress: string): Promise<number> {
    // TODO: Implement using Solana RPC
    // For now, return 0 (will implement in Phase 2)
    return 0;
  }

  /**
   * Calculate transaction velocity (txs per minute)
   */
  private async calculateTransactionVelocity(tokenAddress: string): Promise<number> {
    // TODO: Implement using Solana RPC to count recent transactions
    // For now, return 0 (will implement in Phase 2)
    return 0;
  }

  /**
   * Count unique buyers in last 15 minutes
   */
  private async getUniqueBuyersLast15Min(tokenAddress: string): Promise<number> {
    // TODO: Implement using Solana RPC
    // For now, return 0 (will implement in Phase 2)
    return 0;
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
