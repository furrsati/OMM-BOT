import { Connection, PublicKey } from '@solana/web3.js';
import { logger } from '../utils/logger';
import { query } from '../db/postgres';

/**
 * ON-CHAIN SOCIAL INTELLIGENCE SYSTEM
 *
 * Replaces expensive social media APIs with FREE on-chain analysis.
 * Instead of tracking what people SAY, we track what they DO with their money.
 *
 * This is BETTER than Twitter/Telegram because:
 * 1. Money doesn't lie - real conviction shows in buys
 * 2. Can't be faked - blockchain is immutable
 * 3. Detects insider activity - coordinated buying patterns
 * 4. 100% FREE - just RPC calls
 * 5. More reliable - actions > words
 */

export interface OnChainSocialScore {
  overall: number; // 0-100
  breakdown: {
    walletClustering: number;      // 0-25 points
    earlyBuyerQuality: number;     // 0-25 points
    organicVsCoordinated: number;  // 0-25 points
    holderNetworkQuality: number;  // 0-25 points
  };
  signals: {
    uniqueBuyersLast15Min: number;
    averageBuySize: number;
    buyerQualityScore: number;
    coordinatedBuyingDetected: boolean;
    knownGoodWalletsPresent: number;
    suspiciousPatternDetected: boolean;
  };
  warnings: string[];
  greenFlags: string[];
}

export interface WalletRelationship {
  wallet1: string;
  wallet2: string;
  sharedTokens: string[];
  relationshipStrength: number; // 0-1
  profitableTogetherCount: number;
}

export interface BuyerProfile {
  walletAddress: string;
  historicalWinRate: number;
  averageReturn: number;
  totalTrades: number;
  isNewWallet: boolean;
  connectedToRugs: boolean;
  buyTimestamp: Date;
  buyAmount: number;
}

export class OnChainSocialIntelligence {
  private connection: Connection;

  // In-memory cache for wallet relationships (will move to Redis in production)
  private walletRelationships: Map<string, WalletRelationship[]> = new Map();

  // Known good wallets (from smart wallet discovery)
  private knownGoodWallets: Set<string> = new Set();

  // Known bad wallets (rugs, scammers)
  private knownBadWallets: Set<string> = new Set();

  // Memory management limits - reduced for 512MB instances
  private readonly MAX_WALLET_RELATIONSHIPS = 50;
  private readonly MAX_KNOWN_WALLETS = 100;

  constructor(connection: Connection) {
    this.connection = connection;
  }

  /**
   * Enforce size limits on in-memory collections
   */
  private enforceMemoryLimits(): void {
    // Limit wallet relationships
    if (this.walletRelationships.size > this.MAX_WALLET_RELATIONSHIPS) {
      const entries = Array.from(this.walletRelationships.keys());
      const toRemove = entries.slice(0, entries.length - this.MAX_WALLET_RELATIONSHIPS);
      for (const key of toRemove) {
        this.walletRelationships.delete(key);
      }
    }

    // Limit known good wallets
    if (this.knownGoodWallets.size > this.MAX_KNOWN_WALLETS) {
      const entries = Array.from(this.knownGoodWallets);
      const toRemove = entries.slice(0, entries.length - this.MAX_KNOWN_WALLETS);
      for (const key of toRemove) {
        this.knownGoodWallets.delete(key);
      }
    }

    // Limit known bad wallets
    if (this.knownBadWallets.size > this.MAX_KNOWN_WALLETS) {
      const entries = Array.from(this.knownBadWallets);
      const toRemove = entries.slice(0, entries.length - this.MAX_KNOWN_WALLETS);
      for (const key of toRemove) {
        this.knownBadWallets.delete(key);
      }
    }
  }

  /**
   * MAIN FUNCTION: Get complete on-chain social intelligence score
   * This replaces ALL social media APIs
   */
  async getOnChainSocialScore(tokenAddress: string): Promise<OnChainSocialScore> {
    logger.info('Analyzing on-chain social intelligence', { tokenAddress });

    // Enforce memory limits before processing
    this.enforceMemoryLimits();

    try {
      // Get all recent buyers (last 15 minutes)
      const recentBuyers = await this.getRecentBuyers(tokenAddress, 15);

      // Analyze each component
      const walletClustering = await this.analyzeWalletClustering(recentBuyers);
      const earlyBuyerQuality = await this.analyzeEarlyBuyerQuality(tokenAddress, recentBuyers);
      const organicVsCoordinated = this.detectOrganicVsCoordinated(recentBuyers);
      const holderNetworkQuality = await this.analyzeHolderNetworkQuality(tokenAddress);

      // Calculate signals
      const signals = this.calculateSignals(recentBuyers);

      // Generate warnings and green flags
      const warnings: string[] = [];
      const greenFlags: string[] = [];

      // Warnings
      if (organicVsCoordinated < 10) {
        warnings.push('🚩 Coordinated buying detected - likely insider/shill campaign');
      }
      if (signals.suspiciousPatternDetected) {
        warnings.push('🚩 Suspicious transaction patterns detected');
      }
      if (earlyBuyerQuality < 10) {
        warnings.push('⚠️ Low quality early buyers - mostly new or losing wallets');
      }
      if (signals.uniqueBuyersLast15Min < 5) {
        warnings.push('⚠️ Very few unique buyers - low organic interest');
      }

      // Green flags
      if (walletClustering > 20) {
        greenFlags.push('✅ Known successful wallet clusters buying together');
      }
      if (organicVsCoordinated > 20) {
        greenFlags.push('✅ Organic buying pattern - genuine interest detected');
      }
      if (signals.knownGoodWalletsPresent > 0) {
        greenFlags.push(`✅ ${signals.knownGoodWalletsPresent} proven successful wallets present`);
      }
      if (earlyBuyerQuality > 20 && signals.uniqueBuyersLast15Min > 20) {
        greenFlags.push('✅ High quality buyers + strong activity - excellent signal');
      }

      // Calculate overall score
      const overall = walletClustering + earlyBuyerQuality + organicVsCoordinated + holderNetworkQuality;

      return {
        overall: Math.min(overall, 100),
        breakdown: {
          walletClustering,
          earlyBuyerQuality,
          organicVsCoordinated,
          holderNetworkQuality,
        },
        signals,
        warnings,
        greenFlags,
      };

    } catch (error: any) {
      logger.error('Failed to analyze on-chain social intelligence', {
        tokenAddress,
        error: error.message,
      });

      // Return neutral score on error
      return this.getNeutralScore();
    }
  }

  /**
   * COMPONENT 1: Wallet Clustering Analysis (0-25 points)
   *
   * Analyzes if wallets that historically bought together are buying this token.
   * If a "friend group" of successful wallets all buy → strong signal
   */
  private async analyzeWalletClustering(buyers: BuyerProfile[]): Promise<number> {
    let score = 0;

    // Check for known good wallet clusters
    const knownGoodBuyers = buyers.filter(b => this.knownGoodWallets.has(b.walletAddress));

    if (knownGoodBuyers.length >= 5) {
      score += 25; // 5+ known good wallets = max points
    } else if (knownGoodBuyers.length >= 3) {
      score += 20;
    } else if (knownGoodBuyers.length >= 2) {
      score += 15;
    } else if (knownGoodBuyers.length === 1) {
      score += 10;
    }

    // Check for connected wallet groups (wallets that buy together)
    const clusterCount = this.detectWalletClusters(buyers);
    if (clusterCount > 0) {
      score += Math.min(clusterCount * 5, 10); // Up to 10 bonus points for clusters
    }

    return Math.min(score, 25);
  }

  /**
   * COMPONENT 2: Early Buyer Quality Analysis (0-25 points)
   *
   * Analyzes the quality of wallets buying this token.
   * Proven winners buying = good. New/losing wallets = bad.
   */
  private async analyzeEarlyBuyerQuality(
        _tokenAddress: string,
    buyers: BuyerProfile[]
  ): Promise<number> {
    if (buyers.length === 0) return 0;

    let qualityScore = 0;
    let totalWeight = 0;

    for (const buyer of buyers) {
      let buyerScore = 0;
      let weight = 1;

      // Score based on historical performance
      if (buyer.historicalWinRate > 0.7) {
        buyerScore += 10; // 70%+ win rate = excellent
        weight = 2; // Double weight for proven winners
      } else if (buyer.historicalWinRate > 0.5) {
        buyerScore += 7; // 50-70% win rate = good
        weight = 1.5;
      } else if (buyer.historicalWinRate > 0.3) {
        buyerScore += 4; // 30-50% win rate = mediocre
      }

      // Penalty for new wallets (might be sybil)
      if (buyer.isNewWallet) {
        buyerScore -= 5;
      }

      // Major penalty for rug connections
      if (buyer.connectedToRugs) {
        buyerScore -= 15;
      }

      // Bonus for established traders
      if (buyer.totalTrades > 50) {
        buyerScore += 3;
      }

      qualityScore += buyerScore * weight;
      totalWeight += weight;
    }

    const averageQuality = totalWeight > 0 ? qualityScore / totalWeight : 0;
    return Math.min(Math.max(averageQuality, 0), 25);
  }

  /**
   * COMPONENT 3: Organic vs Coordinated Detection (0-25 points)
   *
   * Detects if buying is organic (good) or coordinated shill campaign (bad).
   *
   * Organic buying:
   * - Random timing (not all at once)
   * - Diverse buy sizes
   * - Unconnected wallets
   *
   * Coordinated buying:
   * - All buys within tight window
   * - Similar buy sizes
   * - Connected wallet patterns
   */
  private detectOrganicVsCoordinated(buyers: BuyerProfile[]): number {
    if (buyers.length < 5) return 15; // Not enough data, neutral score

    let organicScore = 0;

    // 1. Timing distribution (0-10 points)
    const timeSpread = this.calculateTimeSpread(buyers);
    if (timeSpread > 600) {
      // 10+ minutes spread = very organic
      organicScore += 10;
    } else if (timeSpread > 300) {
      // 5-10 min spread = moderately organic
      organicScore += 7;
    } else if (timeSpread > 120) {
      // 2-5 min spread = slightly organic
      organicScore += 4;
    } else {
      // < 2 min spread = coordinated (penalty)
      organicScore -= 5;
    }

    // 2. Buy size diversity (0-10 points)
    const sizeVariation = this.calculateBuySizeVariation(buyers);
    if (sizeVariation > 0.5) {
      // High variation = organic
      organicScore += 10;
    } else if (sizeVariation > 0.3) {
      organicScore += 6;
    } else if (sizeVariation > 0.1) {
      organicScore += 3;
    } else {
      // Very similar sizes = coordinated (penalty)
      organicScore -= 5;
    }

    // 3. Wallet connection analysis (0-5 points)
    const connectionScore = this.analyzeWalletConnections(buyers);
    organicScore += connectionScore;

    return Math.min(Math.max(organicScore, 0), 25);
  }

  /**
   * COMPONENT 4: Holder Network Quality (0-25 points)
   *
   * Analyzes the overall holder base quality.
   * Good holders = previous winners. Bad holders = rug participants.
   */
  private async analyzeHolderNetworkQuality(_tokenAddress: string): Promise<number> {
    // TODO: Implement full holder analysis (Phase 2)
    // For now, return neutral score
    return 12;
  }

  // ============================================================
  // HELPER FUNCTIONS
  // ============================================================

  /**
   * Get recent buyers for a token (last N minutes)
   */
  private async getRecentBuyers(
    tokenAddress: string,
    minutes: number
  ): Promise<BuyerProfile[]> {
    const buyers: BuyerProfile[] = [];

    try {
      const tokenPubkey = new PublicKey(tokenAddress);
      const cutoffTime = Math.floor(Date.now() / 1000) - (minutes * 60);

      // Get recent signatures for the token
      const signatures = await this.connection.getSignaturesForAddress(
        tokenPubkey,
        { limit: 100 },
        'confirmed'
      );

      // Filter to recent and process
      const recentSigs = signatures.filter(s => s.blockTime && s.blockTime > cutoffTime);

      for (const sig of recentSigs.slice(0, 30)) { // Limit to avoid rate limits
        try {
          const tx = await this.connection.getParsedTransaction(
            sig.signature,
            { maxSupportedTransactionVersion: 0 }
          );

          if (!tx || !tx.meta) continue;

          // Look for token balance increases (buys)
          const postBalances = tx.meta.postTokenBalances || [];
          const preBalances = tx.meta.preTokenBalances || [];

          for (const post of postBalances) {
            if (post.mint !== tokenAddress) continue;

            const pre = preBalances.find(p => p.accountIndex === post.accountIndex);
            const preAmount = parseInt(pre?.uiTokenAmount?.amount || '0');
            const postAmount = parseInt(post.uiTokenAmount?.amount || '0');

            // If balance increased, this is a buy
            if (postAmount > preAmount && post.owner) {
              const walletAddress = post.owner;
              const buyAmount = postAmount - preAmount;

              // Get wallet history from database
              const walletHistory = await this.getWalletHistory(walletAddress);

              buyers.push({
                walletAddress,
                historicalWinRate: walletHistory.winRate,
                averageReturn: walletHistory.avgReturn,
                totalTrades: walletHistory.totalTrades,
                isNewWallet: walletHistory.totalTrades < 5,
                connectedToRugs: await this.checkRugConnection(walletAddress),
                buyTimestamp: new Date((sig.blockTime || 0) * 1000),
                buyAmount
              });
            }
          }
        } catch (txError: any) {
          logger.debug('Error parsing transaction', { error: txError.message });
          continue;
        }
      }

      logger.debug(`Found ${buyers.length} recent buyers`, {
        token: tokenAddress.slice(0, 8),
        minutes
      });

      return buyers;

    } catch (error: any) {
      logger.error('Error getting recent buyers', { error: error.message });
      return [];
    }
  }

  /**
   * Get wallet trading history from database
   */
  private async getWalletHistory(walletAddress: string): Promise<{
    winRate: number;
    avgReturn: number;
    totalTrades: number;
  }> {
    try {
      // Check smart_wallets table first
      const walletResult = await query<{
        win_rate: string;
        average_return: string;
        total_trades: number;
      }>(
        `SELECT win_rate, average_return, total_trades
         FROM smart_wallets WHERE address = $1`,
        [walletAddress]
      );

      if (walletResult.rows.length > 0) {
        const w = walletResult.rows[0];
        return {
          winRate: parseFloat(w.win_rate) || 0,
          avgReturn: parseFloat(w.average_return) || 0,
          totalTrades: w.total_trades || 0
        };
      }

      // Check trades table for this wallet's performance
      const tradesResult = await query<{
        total: string;
        wins: string;
        avg_return: string;
      }>(
        `SELECT
           COUNT(*) as total,
           COUNT(CASE WHEN outcome = 'WIN' THEN 1 END) as wins,
           AVG(profit_loss_percent) as avg_return
         FROM trades
         WHERE fingerprint->'smartWallets'->'addresses' ? $1
         AND exit_time IS NOT NULL`,
        [walletAddress]
      );

      if (tradesResult.rows.length > 0) {
        const t = tradesResult.rows[0];
        const total = parseInt(t.total) || 0;
        const wins = parseInt(t.wins) || 0;
        return {
          winRate: total > 0 ? wins / total : 0,
          avgReturn: parseFloat(t.avg_return) || 0,
          totalTrades: total
        };
      }

      // No history found
      return { winRate: 0, avgReturn: 0, totalTrades: 0 };

    } catch (error: any) {
      logger.debug('Error getting wallet history', { error: error.message });
      return { winRate: 0, avgReturn: 0, totalTrades: 0 };
    }
  }

  /**
   * Check if wallet is connected to known rugs
   */
  private async checkRugConnection(walletAddress: string): Promise<boolean> {
    try {
      // Check blacklist table (direct match only - connection checking is handled by BlacklistManager)
      const blacklistResult = await query<{ address: string }>(
        `SELECT address FROM blacklist WHERE address = $1`,
        [walletAddress]
      );

      if (blacklistResult.rows.length > 0) {
        return true;
      }

      // Check if wallet participated in any rug trades
      const rugResult = await query<{ count: string }>(
        `SELECT COUNT(*) as count FROM trades
         WHERE fingerprint->'smartWallets'->'addresses' ? $1
         AND outcome = 'RUG'`,
        [walletAddress]
      );

      const rugCount = parseInt(rugResult.rows[0]?.count || '0');
      return rugCount > 0;

    } catch (error: any) {
      logger.debug('Error checking rug connection', { error: error.message });
      return false;
    }
  }

  /**
   * Calculate time spread of buys (in seconds)
   */
  private calculateTimeSpread(buyers: BuyerProfile[]): number {
    if (buyers.length < 2) return 0;

    const timestamps = buyers.map(b => b.buyTimestamp.getTime()).sort();
    const earliest = timestamps[0];
    const latest = timestamps[timestamps.length - 1];

    return (latest - earliest) / 1000; // Convert to seconds
  }

  /**
   * Calculate buy size variation (coefficient of variation)
   */
  private calculateBuySizeVariation(buyers: BuyerProfile[]): number {
    if (buyers.length < 2) return 0;

    const amounts = buyers.map(b => b.buyAmount);
    const mean = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    const variance = amounts.reduce((sum, amount) => sum + Math.pow(amount - mean, 2), 0) / amounts.length;
    const stdDev = Math.sqrt(variance);

    // Coefficient of variation (normalized)
    return mean > 0 ? stdDev / mean : 0;
  }

  /**
   * Detect wallet clusters (wallets that buy together)
   */
  private detectWalletClusters(_buyers: BuyerProfile[]): number {
    // TODO: Implement graph analysis to find connected wallet groups
    return 0;
  }

  /**
   * Analyze wallet connections (how related are the buyers?)
   */
  private analyzeWalletConnections(_buyers: BuyerProfile[]): number {
    // TODO: Check if buyers funded from same source, part of same cluster, etc.
    // For now, return neutral
    return 5;
  }

  /**
   * Calculate summary signals
   */
  private calculateSignals(buyers: BuyerProfile[]): OnChainSocialScore['signals'] {
    return {
      uniqueBuyersLast15Min: buyers.length,
      averageBuySize: buyers.length > 0
        ? buyers.reduce((sum, b) => sum + b.buyAmount, 0) / buyers.length
        : 0,
      buyerQualityScore: buyers.length > 0
        ? buyers.reduce((sum, b) => sum + b.historicalWinRate, 0) / buyers.length
        : 0,
      coordinatedBuyingDetected: this.detectOrganicVsCoordinated(buyers) < 10,
      knownGoodWalletsPresent: buyers.filter(b => this.knownGoodWallets.has(b.walletAddress)).length,
      suspiciousPatternDetected: false, // TODO: Implement pattern detection
    };
  }

  /**
   * Add known good wallets (from smart wallet discovery)
   */
  public addKnownGoodWallets(wallets: string[]): void {
    wallets.forEach(w => this.knownGoodWallets.add(w));
    logger.info(`Added ${wallets.length} known good wallets to social intelligence`);
  }

  /**
   * Add known bad wallets (rugs, scammers)
   */
  public addKnownBadWallets(wallets: string[]): void {
    wallets.forEach(w => this.knownBadWallets.add(w));
    logger.info(`Added ${wallets.length} known bad wallets to social intelligence`);
  }

  /**
   * Return neutral score on error
   */
  private getNeutralScore(): OnChainSocialScore {
    return {
      overall: 50,
      breakdown: {
        walletClustering: 12,
        earlyBuyerQuality: 12,
        organicVsCoordinated: 13,
        holderNetworkQuality: 13,
      },
      signals: {
        uniqueBuyersLast15Min: 0,
        averageBuySize: 0,
        buyerQualityScore: 0,
        coordinatedBuyingDetected: false,
        knownGoodWalletsPresent: 0,
        suspiciousPatternDetected: false,
      },
      warnings: [],
      greenFlags: [],
    };
  }
}

/**
 * COMPARISON: Social Media vs On-Chain Intelligence
 *
 * SOCIAL MEDIA TRACKING ($100+/month):
 * ❌ "Token has 10,000 Twitter followers"
 *    → Could be bots, means nothing
 * ❌ "Influencer tweeted about it"
 *    → Might be paid, could be exit liquidity
 * ❌ "Telegram has 5,000 members"
 *    → Inflated with bots, fake engagement
 *
 * ON-CHAIN INTELLIGENCE (FREE):
 * ✅ "5 proven winning wallets all bought in last 10 minutes"
 *    → Real money, real conviction, can't fake
 * ✅ "Organic buying from 50+ unique wallets with diverse patterns"
 *    → Genuine interest, not coordinated shill
 * ✅ "Early buyers have 70% historical win rate"
 *    → Smart money is buying, strong signal
 *
 * RESULT: On-chain intelligence is MORE RELIABLE + COMPLETELY FREE
 */
