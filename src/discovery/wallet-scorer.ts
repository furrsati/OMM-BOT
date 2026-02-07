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
import { randomUUID } from 'crypto';
import { logger } from '../utils/logger';
import { SmartWallet } from '../types';
import { query, isPoolShuttingDown } from '../db/postgres';

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
        // Abort early during shutdown
        if (isPoolShuttingDown()) {
          logger.info('Wallet scoring aborted due to shutdown');
          break;
        }

        try {
          const scored = await this.scoreWallet(walletAddress);
          if (scored) {
            scoredWallets.push(scored);
          }
        } catch (error: any) {
          // Ignore shutdown errors, log others
          if (!error.message?.includes('shutting down')) {
            logger.error(`Error scoring wallet ${walletAddress.slice(0, 8)}...`, {
              error: error.message
            });
          }
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

      // Filter: Must have at least 1 token entered
      // RELAXED: Changed from 3 to 1 to allow bootstrapping new wallets
      // Tier 3 wallets with 1-2 tokens will be scored but ranked lower
      if (performance.tokensEntered.length < 1) {
        logger.debug(`Wallet ${walletAddress.slice(0, 8)}... has no tokens, skipping`);
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
   * Get wallet performance data from wallet_discoveries table
   * This measures the wallet's ACTUAL performance - what happened to tokens after they bought
   */
  private async getWalletPerformance(walletAddress: string): Promise<WalletPerformance | null> {
    try {
      // Primary source: Get performance from wallet_discoveries table
      const discoveryResult = await query<{
        token_address: string;
        peak_multiplier: string;
        is_winner: boolean;
        entry_time: Date;
        seconds_after_launch: number;
      }>(
        `SELECT token_address, peak_multiplier, is_winner, entry_time, seconds_after_launch
         FROM wallet_discoveries
         WHERE wallet_address = $1
         AND entry_time > NOW() - INTERVAL '30 days'
         ORDER BY entry_time DESC`,
        [walletAddress]
      );

      // If we have discovery data, use it
      if (discoveryResult.rows.length > 0) {
        const tokensEntered: string[] = [];
        let wins = 0;
        let losses = 0;
        let totalMultiplier = 0;
        let lastActiveTimestamp = 0;
        let totalSecondsAfterLaunch = 0;

        for (const row of discoveryResult.rows) {
          if (!tokensEntered.includes(row.token_address)) {
            tokensEntered.push(row.token_address);
          }

          const multiplier = parseFloat(row.peak_multiplier) || 1;
          totalMultiplier += multiplier;

          // A win is defined as 2x+ peak (matching CLAUDE.md definition)
          if (row.is_winner || multiplier >= 2) {
            wins++;
          } else {
            losses++;
          }

          const entryTime = new Date(row.entry_time).getTime();
          if (entryTime > lastActiveTimestamp) {
            lastActiveTimestamp = entryTime;
          }

          totalSecondsAfterLaunch += row.seconds_after_launch || 0;
        }

        const totalTrades = discoveryResult.rows.length;
        const winRate = totalTrades > 0 ? wins / totalTrades : 0;
        const averageReturn = totalTrades > 0 ? totalMultiplier / totalTrades : 1;
        // Use average seconds after launch as a proxy for "hold time consistency"
        // Lower is better (entered earlier)
        const avgEntryDelay = totalTrades > 0 ? totalSecondsAfterLaunch / totalTrades : 300;
        // Convert to equivalent hold time metric (inverse relationship)
        const averageHoldTime = Math.max(3600, 14400 - avgEntryDelay * 10); // 1-4 hours ideal

        if (lastActiveTimestamp === 0) {
          lastActiveTimestamp = Date.now();
        }

        return {
          address: walletAddress,
          tokensEntered,
          wins,
          losses,
          totalReturn: totalMultiplier,
          averageReturn,
          winRate,
          lastActiveTimestamp,
          averageHoldTime
        };
      }

      // Fallback: Check smart_wallets table for existing data (manually added wallets)
      const walletResult = await query<{
        tokens_entered: number;
        tokens_won: number;
        last_active: Date;
        win_rate: string;
        average_return: string;
        avg_peak_multiplier: string;
      }>(
        `SELECT tokens_entered, COALESCE(tokens_won, 0) as tokens_won, last_active,
                win_rate, average_return, COALESCE(avg_peak_multiplier, 0) as avg_peak_multiplier
         FROM smart_wallets WHERE address = $1`,
        [walletAddress]
      );

      if (walletResult.rows.length > 0) {
        const w = walletResult.rows[0];
        const tokensEntered = w.tokens_entered || 0;
        const tokensWon = w.tokens_won || 0;

        // If wallet has some data, return it
        if (tokensEntered > 0) {
          return {
            address: walletAddress,
            tokensEntered: Array(tokensEntered).fill('unknown'),
            wins: tokensWon,
            losses: tokensEntered - tokensWon,
            totalReturn: parseFloat(w.avg_peak_multiplier || w.average_return) * tokensEntered,
            averageReturn: parseFloat(w.avg_peak_multiplier || w.average_return) || 1,
            winRate: parseFloat(w.win_rate) || 0,
            lastActiveTimestamp: new Date(w.last_active).getTime(),
            averageHoldTime: 7200 // Default to 2 hours (middle of ideal range)
          };
        }
      }

      return null;

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

    // Diversity penalty: wallets with < 3 tokens aren't proven
    // Per CLAUDE.md: "Keep only wallets that hit early entries across 3+ different winning tokens"
    if (performance.tokensEntered.length < 3) {
      score -= 15; // Heavy penalty for unproven wallets
    } else if (performance.wins < 3) {
      score -= 10; // Penalty for not enough wins across tokens
    }

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
   * Assign wallets to tiers based on quality requirements (not just ranking)
   * Per CLAUDE.md:
   * - Tier 1: "Highest conviction, most consistent, least crowded. These trigger entries alone."
   * - Tier 2: "Strong but slightly crowded or less consistent. Need 3+ to trigger."
   * - Tier 3: "Promising but unproven. Used for confirmation only, never as primary signal."
   */
  private assignTiers(wallets: SmartWallet[]): SmartWallet[] {
    let tier1Count = 0;
    let tier2Count = 0;
    const tier1Max = 20;
    const tier2Max = 40;

    for (const wallet of wallets) {
      const wins = wallet.metrics.successfulTrades;
      const winRate = wallet.winRate;

      // Tier 1: Top performers with proven track record
      // Must have 5+ wins AND 40%+ win rate to be trusted alone
      if (tier1Count < tier1Max && wins >= 5 && winRate >= 0.4) {
        wallet.tier = 1;
        tier1Count++;
      }
      // Tier 2: Strong but need more proof or slightly lower win rate
      // Must have 3+ wins AND 25%+ win rate
      else if (tier2Count < tier2Max && wins >= 3 && winRate >= 0.25) {
        wallet.tier = 2;
        tier2Count++;
      }
      // Tier 3: Promising but unproven - everyone else
      else {
        wallet.tier = 3;
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
        // Ensure all numeric values are properly formatted
        // Some columns may be INTEGER in the database, so we round appropriately
        const tier = Math.round(wallet.tier);
        const score = Math.round(wallet.score * 100) / 100; // 2 decimal places
        const winRate = Math.round(wallet.winRate * 100) / 100; // 2 decimal places
        const averageReturn = Math.round(wallet.averageReturn * 100) / 100; // 2 decimal places, capped
        const tokensEntered = Math.round(wallet.tokensEntered);
        const totalTrades = Math.round(wallet.metrics.totalTrades);
        const successfulTrades = Math.round(wallet.metrics.successfulTrades);
        const averageHoldTime = Math.round(wallet.metrics.averageHoldTime || 0);

        await query(`
          INSERT INTO smart_wallets (
            id, address, tier, score, win_rate, average_return,
            tokens_entered, last_active, total_trades, successful_trades, average_hold_time, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
          ON CONFLICT (address)
          DO UPDATE SET
            tier = $3,
            score = $4,
            win_rate = $5,
            average_return = $6,
            tokens_entered = $7,
            last_active = $8,
            total_trades = $9,
            successful_trades = $10,
            average_hold_time = $11,
            updated_at = NOW()
        `, [
          randomUUID(),
          wallet.address,
          tier,
          score,
          winRate,
          averageReturn,
          tokensEntered,
          wallet.lastActive,
          totalTrades,
          successfulTrades,
          averageHoldTime
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
        `SELECT address FROM (
           SELECT DISTINCT ON (address) address, last_active
           FROM smart_wallets
           WHERE is_active = true
           ORDER BY address, last_active DESC
         ) sub
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
