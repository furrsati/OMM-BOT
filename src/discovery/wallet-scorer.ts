/**
 * Wallet Scorer
 *
 * Scores discovered alpha wallets based on:
 * - Win rate (% of tokens that went 2×+)
 * - Average return across all tokens
 * - Number of winning tokens entered
 * - Hold time consistency
 * - Recency of activity
 *
 * Assigns wallets to tiers:
 * - Tier 1: Top 10-20 wallets (highest conviction, least crowded)
 * - Tier 2: Next 20-40 wallets (strong but slightly crowded)
 * - Tier 3: Next 20-40 wallets (promising but unproven)
 */

import { Connection } from '@solana/web3.js';
import { logger } from '../utils/logger';
import { SmartWallet } from '../types';
import { query } from '../db/postgres';

interface WalletPerformance {
  address: string;
  tokensEntered: string[];
  wins: number;
  losses: number;
  totalReturn: number;
  averageReturn: number;
  winRate: number;
  lastActiveTimestamp: number;
  averageHoldTime: number;
}

export class WalletScorer {
  private connection: Connection;

  constructor(connection: Connection) {
    this.connection = connection;
  }

  /**
   * Score all discovered alpha wallets
   */
  async scoreAllWallets(): Promise<SmartWallet[]> {
    logger.info('📊 Scoring alpha wallets...');

    try {
      // Get all cached alpha wallets
      const alphaWallets = await this.getAlphaWallets();
      logger.info(`Found ${alphaWallets.length} alpha wallets to score`);

      if (alphaWallets.length === 0) {
        return [];
      }

      // Score each wallet
      const scoredWallets: SmartWallet[] = [];

      for (const walletAddress of alphaWallets) {
        try {
          const scored = await this.scoreWallet(walletAddress);
          if (scored) {
            scoredWallets.push(scored);
          }
        } catch (error: any) {
          logger.error(`Error scoring wallet ${walletAddress.slice(0, 8)}...`, {
            error: error.message
          });
        }
      }

      // Sort by score (highest first)
      scoredWallets.sort((a, b) => b.score - a.score);

      // Assign tiers
      const tieredWallets = this.assignTiers(scoredWallets);

      // Save to database
      await this.saveWalletsToDatabase(tieredWallets);

      logger.info(`✅ Scored ${tieredWallets.length} wallets`, {
        tier1: tieredWallets.filter(w => w.tier === 1).length,
        tier2: tieredWallets.filter(w => w.tier === 2).length,
        tier3: tieredWallets.filter(w => w.tier === 3).length
      });

      return tieredWallets;

    } catch (error: any) {
      logger.error('Error scoring wallets', { error: error.message });
      throw error;
    }
  }

  /**
   * Score a single wallet
   */
  async scoreWallet(walletAddress: string): Promise<SmartWallet | null> {
    try {
      // Get wallet performance data
      const performance = await this.getWalletPerformance(walletAddress);

      if (!performance) {
        return null;
      }

      // Filter: Must have 3+ tokens entered
      if (performance.tokensEntered.length < 3) {
        logger.debug(`Wallet ${walletAddress.slice(0, 8)}... has < 3 tokens, skipping`);
        return null;
      }

      // Filter: Must be active within last 7 days
      const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
      if (performance.lastActiveTimestamp < sevenDaysAgo) {
        logger.debug(`Wallet ${walletAddress.slice(0, 8)}... inactive, skipping`);
        return null;
      }

      // Calculate score (0-100)
      const score = this.calculateWalletScore(performance);

      const smartWallet: SmartWallet = {
        address: walletAddress,
        tier: 3, // Default, will be reassigned later
        score,
        winRate: performance.winRate,
        averageReturn: performance.averageReturn,
        tokensEntered: performance.tokensEntered.length,
        lastActive: new Date(performance.lastActiveTimestamp),
        metrics: {
          totalTrades: performance.tokensEntered.length,
          successfulTrades: performance.wins,
          averageHoldTime: performance.averageHoldTime
        }
      };

      return smartWallet;

    } catch (error: any) {
      logger.error(`Error scoring wallet ${walletAddress}`, { error: error.message });
      return null;
    }
  }

  /**
   * Get wallet performance data
   */
  private async getWalletPerformance(_walletAddress: string): Promise<WalletPerformance | null> {
    try {
      // REDIS REMOVED - caching disabled
      // Get cached data
      // const key = `alpha_wallet:${walletAddress}`;
      // const cached = await this.redis.get(key);

      // if (!cached) {
      //   return null;
      // }

      // const data = JSON.parse(cached);

      // Analyze performance for each token
      // let wins = 0;
      // let losses = 0;
      // let totalReturn = 0;
      // let totalHoldTime = 0;

      // for (const tokenAddress of data.tokens) {
      //   // Get token performance (STUB - needs price data integration)
      //   const tokenPerformance = await this.getTokenPerformance(
      //     walletAddress,
      //     tokenAddress
      //   );

      //   if (tokenPerformance) {
      //     if (tokenPerformance.multiplier >= 2) {
      //       wins++;
      //     } else {
      //       losses++;
      //     }

      //     totalReturn += tokenPerformance.multiplier;
      //     totalHoldTime += tokenPerformance.holdTime;
      //   }
      // }

      // const totalTrades = wins + losses;
      // const winRate = totalTrades > 0 ? wins / totalTrades : 0;
      // const averageReturn = totalTrades > 0 ? totalReturn / totalTrades : 0;
      // const averageHoldTime = totalTrades > 0 ? totalHoldTime / totalTrades : 0;

      // return {
      //   address: walletAddress,
      //   tokensEntered: data.tokens,
      //   wins,
      //   losses,
      //   totalReturn,
      //   averageReturn,
      //   winRate,
      //   lastActiveTimestamp: data.lastUpdated,
      //   averageHoldTime
      // };

      return null; // Redis disabled, no cached data available

    } catch (error: any) {
      logger.debug('Error getting wallet performance', { error: error.message });
      return null;
    }
  }

  /**
   * Get token performance for a specific wallet
   *
   * STUB: In production, this would query price data service
   */
  private async getTokenPerformance(
    _walletAddress: string,
    _tokenAddress: string
  ): Promise<{ multiplier: number; holdTime: number } | null> {
    try {
      // STUB: Query price data for this wallet's entry/exit
      // For now, return mock data
      // In production, this would:
      // 1. Find wallet's entry transaction and price
      // 2. Find wallet's exit transaction and price (or current price if still holding)
      // 3. Calculate multiplier and hold time

      // Mock: Random performance for testing
      const multiplier = Math.random() * 10; // 0x-10x
      const holdTime = Math.random() * 24 * 60 * 60; // 0-24 hours

      return { multiplier, holdTime };

    } catch (error: any) {
      logger.debug('Error getting token performance', { error: error.message });
      return null;
    }
  }

  /**
   * Calculate wallet score (0-100)
   */
  private calculateWalletScore(performance: WalletPerformance): number {
    let score = 0;

    // Win rate (0-40 points)
    // 60%+ win rate = 40 points
    // 40% win rate = 24 points
    // 20% win rate = 8 points
    score += performance.winRate * 40;

    // Average return (0-30 points)
    // 5x avg = 30 points
    // 3x avg = 18 points
    // 2x avg = 12 points
    const returnPoints = Math.min((performance.averageReturn / 5) * 30, 30);
    score += returnPoints;

    // Number of tokens (0-15 points)
    // 10+ tokens = 15 points
    // 5 tokens = 7.5 points
    // 3 tokens = 4.5 points
    const tokenPoints = Math.min((performance.tokensEntered.length / 10) * 15, 15);
    score += tokenPoints;

    // Hold time consistency (0-10 points)
    // Ideal: 4-24 hours
    // Too short (< 1 hour) = possible dump bot = -5 points
    // Too long (> 48 hours) = missed exits = -2 points
    const holdTimeHours = performance.averageHoldTime / 3600;
    if (holdTimeHours < 1) {
      score -= 5; // Likely dump bot
    } else if (holdTimeHours >= 4 && holdTimeHours <= 24) {
      score += 10; // Perfect range
    } else if (holdTimeHours > 48) {
      score -= 2; // Holds too long
    } else {
      score += 5; // Acceptable
    }

    // Recency (0-5 points)
    // Active within 24 hours = 5 points
    // Active within 3 days = 3 points
    // Active within 7 days = 1 point
    const daysSinceActive = (Date.now() - performance.lastActiveTimestamp) / (24 * 60 * 60 * 1000);
    if (daysSinceActive < 1) {
      score += 5;
    } else if (daysSinceActive < 3) {
      score += 3;
    } else if (daysSinceActive < 7) {
      score += 1;
    }

    // Clamp to 0-100
    return Math.max(0, Math.min(100, score));
  }

  /**
   * Assign wallets to tiers based on score ranking
   */
  private assignTiers(wallets: SmartWallet[]): SmartWallet[] {
    const tier1Size = 20;
    const tier2Size = 40;

    for (let i = 0; i < wallets.length; i++) {
      if (i < tier1Size) {
        wallets[i].tier = 1;
      } else if (i < tier1Size + tier2Size) {
        wallets[i].tier = 2;
      } else {
        wallets[i].tier = 3;
      }
    }

    return wallets;
  }

  /**
   * Save scored wallets to database
   */
  private async saveWalletsToDatabase(wallets: SmartWallet[]): Promise<void> {
    try {
      for (const wallet of wallets) {
        await query(`
          INSERT INTO smart_wallets (
            address, tier, score, win_rate, average_return,
            tokens_entered, last_active, total_trades,
            successful_trades, average_hold_time, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
          ON CONFLICT (address)
          DO UPDATE SET
            tier = $2,
            score = $3,
            win_rate = $4,
            average_return = $5,
            tokens_entered = $6,
            last_active = $7,
            total_trades = $8,
            successful_trades = $9,
            average_hold_time = $10,
            updated_at = NOW()
        `, [
          wallet.address,
          wallet.tier,
          wallet.score,
          wallet.winRate,
          wallet.averageReturn,
          wallet.tokensEntered,
          wallet.lastActive,
          wallet.metrics.totalTrades,
          wallet.metrics.successfulTrades,
          wallet.metrics.averageHoldTime
        ]);
      }

      logger.info(`Saved ${wallets.length} wallets to database`);

    } catch (error: any) {
      logger.error('Error saving wallets to database', { error: error.message });
      throw error;
    }
  }

  /**
   * Get all alpha wallet addresses from cache
   */
  private async getAlphaWallets(): Promise<string[]> {
    try {
      // REDIS REMOVED - caching disabled
      // const keys = await this.redis.keys('alpha_wallet:*');
      // return keys.map(key => key.replace('alpha_wallet:', ''));
      return []; // Redis disabled, no cached wallets available
    } catch (error: any) {
      logger.error('Error getting alpha wallets', { error: error.message });
      return [];
    }
  }
}
