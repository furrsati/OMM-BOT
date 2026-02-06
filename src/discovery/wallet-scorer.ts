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
  private async getWalletPerformance(walletAddress: string): Promise<WalletPerformance | null> {
    try {
      // Get wallet's trade history from trades table
      const tradesResult = await query<{
        token_address: string;
        profit_loss_percent: string | null;
        outcome: string | null;
        entry_time: Date;
        exit_time: Date | null;
      }>(
        `SELECT token_address, profit_loss_percent, outcome, entry_time, exit_time
         FROM trades
         WHERE fingerprint->'smartWallets'->'addresses' ? $1
         AND exit_time IS NOT NULL
         ORDER BY entry_time DESC
         LIMIT 100`,
        [walletAddress]
      );

      // Also get cached alpha discoveries
      const discoveryResult = await query<{ value: string }>(
        `SELECT value FROM cache
         WHERE key LIKE $1
         AND expires_at > NOW()`,
        [`alpha_discovery:${walletAddress}:%`]
      );

      // Parse discoveries
      const tokensEntered: string[] = [];
      let lastActiveTimestamp = 0;

      for (const row of discoveryResult.rows) {
        try {
          const data = JSON.parse(row.value);
          if (!tokensEntered.includes(data.tokenAddress)) {
            tokensEntered.push(data.tokenAddress);
          }
          if (data.discoveredAt > lastActiveTimestamp) {
            lastActiveTimestamp = data.discoveredAt;
          }
        } catch {
          continue;
        }
      }

      // If no discoveries but we have trades, use trade tokens
      if (tokensEntered.length === 0) {
        for (const trade of tradesResult.rows) {
          if (!tokensEntered.includes(trade.token_address)) {
            tokensEntered.push(trade.token_address);
          }
          const tradeTime = new Date(trade.entry_time).getTime();
          if (tradeTime > lastActiveTimestamp) {
            lastActiveTimestamp = tradeTime;
          }
        }
      }

      if (tokensEntered.length === 0) {
        // Check smart_wallets table for existing data
        const walletResult = await query<{
          tokens_entered: number;
          last_active: Date;
          win_rate: string;
          average_return: string;
          successful_trades: number;
          total_trades: number;
          average_hold_time: number;
        }>(
          `SELECT tokens_entered, last_active, win_rate, average_return,
                  successful_trades, total_trades, average_hold_time
           FROM smart_wallets WHERE address = $1`,
          [walletAddress]
        );

        if (walletResult.rows.length > 0) {
          const w = walletResult.rows[0];
          return {
            address: walletAddress,
            tokensEntered: Array(w.tokens_entered).fill('unknown'),
            wins: w.successful_trades,
            losses: w.total_trades - w.successful_trades,
            totalReturn: parseFloat(w.average_return) * w.total_trades,
            averageReturn: parseFloat(w.average_return),
            winRate: parseFloat(w.win_rate),
            lastActiveTimestamp: new Date(w.last_active).getTime(),
            averageHoldTime: w.average_hold_time
          };
        }

        return null;
      }

      // Calculate performance from trades
      let wins = 0;
      let losses = 0;
      let totalReturn = 0;
      let totalHoldTime = 0;

      for (const trade of tradesResult.rows) {
        const profitPercent = parseFloat(trade.profit_loss_percent || '0');
        const multiplier = 1 + (profitPercent / 100);

        if (trade.outcome === 'WIN' || profitPercent >= 100) {
          wins++;
        } else if (trade.outcome === 'LOSS' || trade.outcome === 'RUG') {
          losses++;
        }

        totalReturn += multiplier;

        if (trade.exit_time && trade.entry_time) {
          const holdTime = (new Date(trade.exit_time).getTime() - new Date(trade.entry_time).getTime()) / 1000;
          totalHoldTime += holdTime;
        }
      }

      const totalTrades = wins + losses;
      const winRate = totalTrades > 0 ? wins / totalTrades : 0;
      const averageReturn = totalTrades > 0 ? totalReturn / totalTrades : 0;
      const averageHoldTime = totalTrades > 0 ? totalHoldTime / totalTrades : 0;

      // Update last active from trades if more recent
      if (tradesResult.rows.length > 0) {
        const latestTrade = new Date(tradesResult.rows[0].entry_time).getTime();
        if (latestTrade > lastActiveTimestamp) {
          lastActiveTimestamp = latestTrade;
        }
      }

      if (lastActiveTimestamp === 0) {
        lastActiveTimestamp = Date.now();
      }

      return {
        address: walletAddress,
        tokensEntered,
        wins,
        losses,
        totalReturn,
        averageReturn,
        winRate,
        lastActiveTimestamp,
        averageHoldTime
      };

    } catch (error: any) {
      logger.debug('Error getting wallet performance', { error: error.message });
      return null;
    }
  }

  /**
   * Get token performance for a specific wallet
   */
  private async getTokenPerformance(
    walletAddress: string,
    tokenAddress: string
  ): Promise<{ multiplier: number; holdTime: number } | null> {
    try {
      // Check if we have trade data for this wallet/token combination
      const tradeResult = await query<{
        entry_price: string;
        exit_price: string | null;
        entry_time: Date;
        exit_time: Date | null;
        profit_loss_percent: string | null;
      }>(
        `SELECT entry_price, exit_price, entry_time, exit_time, profit_loss_percent
         FROM trades
         WHERE token_address = $1
         AND fingerprint->'smartWallets'->'addresses' ? $2
         ORDER BY entry_time DESC
         LIMIT 1`,
        [tokenAddress, walletAddress]
      );

      if (tradeResult.rows.length > 0) {
        const trade = tradeResult.rows[0];
        const entryPrice = parseFloat(trade.entry_price);
        const exitPrice = trade.exit_price ? parseFloat(trade.exit_price) : entryPrice;

        const multiplier = exitPrice / entryPrice;
        const holdTime = trade.exit_time && trade.entry_time
          ? (new Date(trade.exit_time).getTime() - new Date(trade.entry_time).getTime()) / 1000
          : 0;

        return { multiplier, holdTime };
      }

      // Try to get from DexScreener if no trade data
      try {
        const response = await fetch(
          `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`,
          { signal: AbortSignal.timeout(5000) }
        );

        if (response.ok) {
          const data = await response.json() as { pairs?: any[] };
          const pair = data.pairs?.[0];

          if (pair) {
            const priceChange24h = parseFloat(pair.priceChange?.h24 || '0');
            const multiplier = 1 + (priceChange24h / 100);
            // Estimate hold time from pair age
            const pairCreatedAt = pair.pairCreatedAt || Date.now();
            const holdTime = (Date.now() - pairCreatedAt) / 1000;

            return { multiplier: Math.max(0.1, multiplier), holdTime };
          }
        }
      } catch {
        // Ignore fetch errors
      }

      return null;

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
   * Get all alpha wallet addresses from database
   */
  private async getAlphaWallets(): Promise<string[]> {
    try {
      // Get wallets from smart_wallets table (all active wallets)
      const walletsResult = await query<{ address: string }>(
        `SELECT DISTINCT address FROM smart_wallets
         WHERE is_active = true
         ORDER BY last_active DESC
         LIMIT 200`
      );

      // Also get wallets from cache discoveries
      const discoveryResult = await query<{ key: string }>(
        `SELECT DISTINCT key FROM cache
         WHERE key LIKE 'alpha_discovery:%'
         AND expires_at > NOW()`
      );

      const walletSet = new Set<string>();

      // Add from smart_wallets
      for (const row of walletsResult.rows) {
        walletSet.add(row.address);
      }

      // Add from discovery cache
      for (const row of discoveryResult.rows) {
        // key format: alpha_discovery:walletAddress:tokenAddress
        const parts = row.key.split(':');
        if (parts.length >= 2) {
          walletSet.add(parts[1]);
        }
      }

      // Also check trades for wallets that participated in winning trades
      const tradesResult = await query<{ wallet: string }>(
        `SELECT DISTINCT jsonb_array_elements_text(fingerprint->'smartWallets'->'addresses') as wallet
         FROM trades
         WHERE outcome = 'WIN'
         AND exit_time > NOW() - INTERVAL '30 days'
         LIMIT 100`
      );

      for (const row of tradesResult.rows) {
        if (row.wallet) {
          walletSet.add(row.wallet);
        }
      }

      logger.info(`Found ${walletSet.size} alpha wallets to score`);
      return Array.from(walletSet);

    } catch (error: any) {
      logger.error('Error getting alpha wallets', { error: error.message });
      return [];
    }
  }
}
