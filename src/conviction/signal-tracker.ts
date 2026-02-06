/**
 * Signal Tracker
 *
 * Monitors smart wallet activity in real-time and tracks entry opportunities:
 * - Watches for smart wallet token purchases
 * - Monitors price action for dip entry timing
 * - Tracks pending opportunities waiting for optimal entry
 * - Triggers signal aggregation when conditions align
 *
 * This is the "eyes" of the bot that constantly watches for opportunities.
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { logger } from '../utils/logger';
import { WalletManager } from '../discovery';
import { PriceFeed } from '../market';
import { SignalAggregator, AggregatedSignal } from './signal-aggregator';
import { ConvictionScorer } from './conviction-scorer';
import { EntryDecisionEngine, EntryDecision } from './entry-decision';
import { query } from '../db/postgres';
import { rateLimitedRPC } from '../utils/rate-limiter';

export interface TrackedOpportunity {
  tokenAddress: string;
  tokenName: string;
  tokenSymbol: string;
  firstDetected: number;
  smartWalletsEntered: string[]; // Wallet addresses
  smartWalletTiers: number[]; // Corresponding tiers
  currentPrice: number;
  highestPrice: number;
  dipDepthPercent: number;
  status: 'WATCHING' | 'READY' | 'ENTERED' | 'EXPIRED';
  expiresAt: number; // Opportunity expires after 2 hours
}

export class SignalTracker {
  private connection: Connection;
  private walletManager: WalletManager;
  private priceFeed: PriceFeed;
  private signalAggregator: SignalAggregator;
  private convictionScorer: ConvictionScorer;
  private entryDecision: EntryDecisionEngine;

  private trackedOpportunities: Map<string, TrackedOpportunity> = new Map();
  private isRunning: boolean = false;
  private monitorInterval: NodeJS.Timeout | null = null;

  // Callback for approved entries (Phase 5 integration)
  private onEntryApprovedCallback?: (decision: EntryDecision, signal: AggregatedSignal) => void;

  constructor(
    connection: Connection,
    walletManager: WalletManager,
    priceFeed: PriceFeed,
    signalAggregator: SignalAggregator,
    convictionScorer: ConvictionScorer,
    entryDecision: EntryDecisionEngine
  ) {
    this.connection = connection;
    this.walletManager = walletManager;
    this.priceFeed = priceFeed;
    this.signalAggregator = signalAggregator;
    this.convictionScorer = convictionScorer;
    this.entryDecision = entryDecision;
  }

  /**
   * Register callback for when entries are approved
   */
  onEntryApproved(callback: (decision: EntryDecision, signal: AggregatedSignal) => void): void {
    this.onEntryApprovedCallback = callback;
    logger.info('Entry approved callback registered');
  }

  /**
   * Start tracking signals
   */
  start(): void {
    if (this.isRunning) {
      logger.warn('Signal Tracker already running');
      return;
    }

    logger.info('📡 Starting Signal Tracker...');
    this.isRunning = true;

    // Monitor for new opportunities every 30 seconds
    this.monitorInterval = setInterval(() => {
      this.scanForOpportunities().catch(error => {
        logger.error('Error scanning for opportunities', { error: error.message });
      });
    }, 30000);

    // Also monitor tracked opportunities every 10 seconds
    setInterval(() => {
      this.updateTrackedOpportunities().catch(error => {
        logger.error('Error updating tracked opportunities', { error: error.message });
      });
    }, 10000);

    logger.info('✅ Signal Tracker started');
  }

  /**
   * Stop tracking signals
   */
  stop(): void {
    logger.info('Stopping Signal Tracker...');
    this.isRunning = false;

    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }

    logger.info('✅ Signal Tracker stopped');
  }

  /**
   * Scan for new opportunities (smart wallet activity)
   */
  private async scanForOpportunities(): Promise<void> {
    try {
      logger.debug('Scanning for new opportunities from smart wallets...');

      // Get all tracked smart wallets
      const smartWallets = this.walletManager.getWatchlist();
      if (smartWallets.length === 0) {
        logger.debug('No smart wallets to monitor');
        return;
      }

      // Track token purchases detected in this scan
      const tokenPurchases: Map<string, {
        walletAddresses: string[];
        walletTiers: number[];
        firstSeen: number;
      }> = new Map();

      // Scan the most active wallets (Tier 1 and Tier 2 first)
      const walletsToScan = smartWallets
        .sort((a, b) => a.tier - b.tier) // Tier 1 first
        .slice(0, 30); // Limit to avoid too many RPC calls

      for (const wallet of walletsToScan) {
        try {
          const purchases = await this.getRecentTokenPurchases(wallet.address);

          for (const purchase of purchases) {
            // Skip if already tracking this token
            if (this.trackedOpportunities.has(purchase.tokenAddress)) {
              // Update existing opportunity with new wallet
              const opp = this.trackedOpportunities.get(purchase.tokenAddress)!;
              if (!opp.smartWalletsEntered.includes(wallet.address)) {
                opp.smartWalletsEntered.push(wallet.address);
                opp.smartWalletTiers.push(wallet.tier);
                logger.info(`📊 Additional smart wallet entered ${purchase.tokenAddress.slice(0, 8)}...`, {
                  tier: wallet.tier,
                  totalWallets: opp.smartWalletsEntered.length
                });
              }
              continue;
            }

            // Aggregate purchases by token
            if (!tokenPurchases.has(purchase.tokenAddress)) {
              tokenPurchases.set(purchase.tokenAddress, {
                walletAddresses: [],
                walletTiers: [],
                firstSeen: purchase.timestamp
              });
            }

            const tokenData = tokenPurchases.get(purchase.tokenAddress)!;
            if (!tokenData.walletAddresses.includes(wallet.address)) {
              tokenData.walletAddresses.push(wallet.address);
              tokenData.walletTiers.push(wallet.tier);
            }
          }
        } catch (error: any) {
          logger.debug(`Error scanning wallet ${wallet.address.slice(0, 8)}: ${error.message}`);
        }
      }

      // Process new token discoveries
      for (const [tokenAddress, data] of tokenPurchases) {
        try {
          // Get token metadata
          const tokenInfo = await this.getTokenInfo(tokenAddress);

          // Add to tracked opportunities
          await this.addOpportunity(
            tokenAddress,
            tokenInfo.name,
            tokenInfo.symbol,
            data.walletAddresses,
            data.walletTiers
          );

          // Insert into database for scanner UI
          await this.insertTokenOpportunity(tokenAddress, tokenInfo, data);

          logger.info(`🆕 New opportunity detected: ${tokenInfo.symbol || tokenAddress.slice(0, 8)}`, {
            wallets: data.walletAddresses.length,
            tier1Count: data.walletTiers.filter(t => t === 1).length,
            tier2Count: data.walletTiers.filter(t => t === 2).length
          });

        } catch (error: any) {
          logger.debug(`Error processing token ${tokenAddress.slice(0, 8)}: ${error.message}`);
        }
      }

      if (tokenPurchases.size > 0) {
        logger.info(`✅ Scan complete: ${tokenPurchases.size} new opportunities detected`);
      }

    } catch (error: any) {
      logger.error('Error scanning for opportunities', { error: error.message });
    }
  }

  /**
   * Get recent token purchases from a wallet (last 30 minutes)
   */
  private async getRecentTokenPurchases(walletAddress: string): Promise<Array<{
    tokenAddress: string;
    timestamp: number;
    amount: number;
  }>> {
    const purchases: Array<{ tokenAddress: string; timestamp: number; amount: number }> = [];

    try {
      const pubkey = new PublicKey(walletAddress);
      const thirtyMinutesAgo = Math.floor(Date.now() / 1000) - 1800;

      // Get recent transaction signatures
      const signatures = await rateLimitedRPC(
        () => this.connection.getSignaturesForAddress(
          pubkey,
          { limit: 20 },
          'confirmed'
        ),
        1 // Medium priority
      );

      // Filter to recent transactions only
      const recentSigs = signatures.filter(sig =>
        sig.blockTime && sig.blockTime >= thirtyMinutesAgo
      );

      for (const sig of recentSigs.slice(0, 10)) {
        try {
          const tx = await rateLimitedRPC(
            () => this.connection.getParsedTransaction(
              sig.signature,
              { maxSupportedTransactionVersion: 0 }
            ),
            0 // Lower priority
          );

          if (!tx || !tx.meta || tx.meta.err) continue;

          // Check for token balance increases (purchases)
          const preBalances = tx.meta.preTokenBalances || [];
          const postBalances = tx.meta.postTokenBalances || [];

          for (const post of postBalances) {
            if (!post.mint || !post.owner) continue;
            if (post.owner !== walletAddress) continue;

            const pre = preBalances.find(p =>
              p.accountIndex === post.accountIndex
            );

            const preAmount = pre?.uiTokenAmount?.uiAmount || 0;
            const postAmount = post.uiTokenAmount?.uiAmount || 0;

            // Token balance increased = purchase
            if (postAmount > preAmount && postAmount > 0) {
              purchases.push({
                tokenAddress: post.mint,
                timestamp: sig.blockTime!,
                amount: postAmount - preAmount
              });
            }
          }
        } catch (error: any) {
          logger.debug(`Error parsing tx: ${error.message}`);
        }
      }
    } catch (error: any) {
      logger.debug(`Error getting purchases for ${walletAddress.slice(0, 8)}: ${error.message}`);
    }

    return purchases;
  }

  /**
   * Get token metadata from DexScreener or on-chain
   */
  private async getTokenInfo(tokenAddress: string): Promise<{
    name: string;
    symbol: string;
    decimals: number;
  }> {
    try {
      // Try DexScreener first
      const response = await fetch(
        `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`,
        {
          signal: AbortSignal.timeout(5000),
          headers: { 'Accept': 'application/json' }
        }
      );

      if (response.ok) {
        const data = await response.json() as { pairs?: any[] };
        const pair = data.pairs?.[0];
        if (pair?.baseToken) {
          return {
            name: pair.baseToken.name || 'Unknown',
            symbol: pair.baseToken.symbol || '???',
            decimals: 9 // Default for Solana tokens
          };
        }
      }
    } catch (error: any) {
      logger.debug(`DexScreener lookup failed for ${tokenAddress.slice(0, 8)}: ${error.message}`);
    }

    // Fallback to minimal info
    return {
      name: 'Unknown Token',
      symbol: '???',
      decimals: 9
    };
  }

  /**
   * Insert token opportunity into database for scanner UI
   */
  private async insertTokenOpportunity(
    tokenAddress: string,
    tokenInfo: { name: string; symbol: string },
    data: { walletAddresses: string[]; walletTiers: number[]; firstSeen: number }
  ): Promise<void> {
    try {
      const tier1Count = data.walletTiers.filter(t => t === 1).length;
      const tier2Count = data.walletTiers.filter(t => t === 2).length;
      const tier3Count = data.walletTiers.filter(t => t === 3).length;

      // Get current price data
      const priceData = await this.priceFeed.getPrice(tokenAddress);

      await query(`
        INSERT INTO token_opportunities (
          token_address, token_name, token_symbol, discovered_via,
          smart_wallets_entered, smart_wallet_count,
          tier1_count, tier2_count, tier3_count,
          current_price, liquidity_usd, holder_count,
          status, conviction_score
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        ON CONFLICT (token_address) DO UPDATE SET
          smart_wallets_entered = EXCLUDED.smart_wallets_entered,
          smart_wallet_count = EXCLUDED.smart_wallet_count,
          tier1_count = EXCLUDED.tier1_count,
          tier2_count = EXCLUDED.tier2_count,
          tier3_count = EXCLUDED.tier3_count,
          current_price = COALESCE(EXCLUDED.current_price, token_opportunities.current_price),
          last_updated = NOW()
      `, [
        tokenAddress,
        tokenInfo.name,
        tokenInfo.symbol,
        'smart_wallet_scan',
        data.walletAddresses,
        data.walletAddresses.length,
        tier1Count,
        tier2Count,
        tier3Count,
        priceData?.priceUSD || null,
        priceData?.liquidityUSD || null,
        null,
        'ANALYZING',
        0 // Will be calculated when conviction scoring runs
      ]);

    } catch (error: any) {
      logger.debug(`Error inserting opportunity: ${error.message}`);
    }
  }

  /**
   * Update tracked opportunities (check for dip entry timing)
   */
  private async updateTrackedOpportunities(): Promise<void> {
    try {
      const now = Date.now();

      for (const [tokenAddress, opportunity] of this.trackedOpportunities.entries()) {
        // Skip if already entered or expired
        if (opportunity.status === 'ENTERED' || opportunity.status === 'EXPIRED') {
          continue;
        }

        // Check if expired (2 hours)
        if (now >= opportunity.expiresAt) {
          opportunity.status = 'EXPIRED';
          // Update database status
          await this.updateOpportunityStatus(tokenAddress, 'EXPIRED');
          logger.info(`⏱️ Opportunity expired: ${tokenAddress.slice(0, 8)}...`);
          continue;
        }

        // Get current price
        const priceData = await this.priceFeed.getPrice(tokenAddress);
        if (!priceData) {
          continue;
        }

        opportunity.currentPrice = priceData.priceUSD;

        // Update highest price
        if (priceData.priceUSD > opportunity.highestPrice) {
          opportunity.highestPrice = priceData.priceUSD;
        }

        // Calculate dip depth
        const dipDepth = ((opportunity.highestPrice - priceData.priceUSD) / opportunity.highestPrice) * 100;
        opportunity.dipDepthPercent = dipDepth;

        // Update database with current market data
        await this.updateOpportunityMarketData(tokenAddress, priceData, dipDepth, opportunity.highestPrice);

        // Check if dip entry conditions are met
        if (dipDepth >= 20 && dipDepth <= 35 && opportunity.status === 'WATCHING') {
          logger.info(`🎯 Entry opportunity detected: ${tokenAddress.slice(0, 8)}... (${dipDepth.toFixed(1)}% dip)`);
          opportunity.status = 'READY';

          // Trigger entry evaluation
          await this.evaluateEntry(opportunity);
        }
      }

      // Clean up old expired opportunities
      this.cleanupExpiredOpportunities();

    } catch (error: any) {
      logger.error('Error updating tracked opportunities', { error: error.message });
    }
  }

  /**
   * Update opportunity status in database
   */
  private async updateOpportunityStatus(tokenAddress: string, status: string): Promise<void> {
    try {
      await query(`
        UPDATE token_opportunities SET
          status = $2,
          last_updated = NOW()
        WHERE token_address = $1
      `, [tokenAddress, status]);
    } catch (error: any) {
      logger.debug(`Error updating opportunity status: ${error.message}`);
    }
  }

  /**
   * Update opportunity market data in database
   */
  private async updateOpportunityMarketData(
    tokenAddress: string,
    priceData: { priceUSD: number; liquidityUSD?: number; volume24h?: number; priceChange1h?: number; priceChange24h?: number },
    dipFromHigh: number,
    athPrice: number
  ): Promise<void> {
    try {
      await query(`
        UPDATE token_opportunities SET
          current_price = $2,
          liquidity_usd = COALESCE($3, liquidity_usd),
          volume_24h = COALESCE($4, volume_24h),
          price_change_1h = COALESCE($5, price_change_1h),
          price_change_24h = COALESCE($6, price_change_24h),
          dip_from_high = $7,
          ath_price = $8,
          last_updated = NOW()
        WHERE token_address = $1
      `, [
        tokenAddress,
        priceData.priceUSD,
        priceData.liquidityUSD || null,
        priceData.volume24h || null,
        priceData.priceChange1h || null,
        priceData.priceChange24h || null,
        dipFromHigh,
        athPrice
      ]);
    } catch (error: any) {
      logger.debug(`Error updating opportunity market data: ${error.message}`);
    }
  }

  /**
   * Evaluate if we should enter a ready opportunity
   */
  private async evaluateEntry(opportunity: TrackedOpportunity): Promise<void> {
    try {
      logger.info(`🔍 Evaluating entry for ${opportunity.tokenAddress.slice(0, 8)}...`);

      // Step 1: Aggregate all signals
      const aggregatedSignal = await this.signalAggregator.aggregateSignals(
        opportunity.tokenAddress,
        opportunity.tokenName,
        opportunity.tokenSymbol
      );

      // Step 2: Calculate conviction score
      const convictionScore = await this.convictionScorer.calculateConviction(aggregatedSignal);

      // Step 3: Make entry decision
      const decision = await this.entryDecision.decide(aggregatedSignal, convictionScore);

      // Update database with conviction score and decision
      await this.updateOpportunityDecision(
        opportunity.tokenAddress,
        convictionScore.totalScore,
        decision.approvedForExecution ? 'QUALIFIED' : 'REJECTED',
        decision.reason
      );

      if (decision.approvedForExecution) {
        logger.info(`✅ ENTRY APPROVED for ${opportunity.tokenAddress.slice(0, 8)}...`, {
          conviction: decision.convictionScore,
          positionSize: decision.positionSizePercent + '%'
        });

        opportunity.status = 'ENTERED';

        // Update database status
        await this.updateOpportunityDecision(
          opportunity.tokenAddress,
          convictionScore.totalScore,
          'ENTERED',
          null
        );

        // Phase 5: Execute trade via Execution Engine
        if (this.onEntryApprovedCallback) {
          this.onEntryApprovedCallback(decision, aggregatedSignal);
        } else {
          logger.warn('No execution callback registered - trade not executed', {
            token: opportunity.tokenAddress.slice(0, 8)
          });
        }

      } else {
        logger.warn(`❌ Entry rejected for ${opportunity.tokenAddress.slice(0, 8)}...`, {
          reason: decision.reason
        });

        // Mark as expired so we don't re-evaluate
        opportunity.status = 'EXPIRED';
      }

    } catch (error: any) {
      logger.error('Error evaluating entry', {
        token: opportunity.tokenAddress,
        error: error.message
      });
    }
  }

  /**
   * Update opportunity in database with decision
   */
  private async updateOpportunityDecision(
    tokenAddress: string,
    convictionScore: number,
    status: string,
    rejectionReason: string | null
  ): Promise<void> {
    try {
      await query(`
        UPDATE token_opportunities SET
          conviction_score = $2,
          status = $3,
          rejection_reason = $4,
          decision_time = NOW(),
          last_updated = NOW()
        WHERE token_address = $1
      `, [tokenAddress, convictionScore, status, rejectionReason]);
    } catch (error: any) {
      logger.debug(`Error updating opportunity decision: ${error.message}`);
    }
  }

  /**
   * Manually add a token to track
   */
  async addOpportunity(
    tokenAddress: string,
    tokenName: string,
    tokenSymbol: string,
    walletAddresses: string[],
    walletTiers: number[]
  ): Promise<void> {
    if (this.trackedOpportunities.has(tokenAddress)) {
      logger.warn(`Already tracking ${tokenAddress.slice(0, 8)}...`);
      return;
    }

    const priceData = await this.priceFeed.getPrice(tokenAddress);
    const currentPrice = priceData?.priceUSD || 0;

    const opportunity: TrackedOpportunity = {
      tokenAddress,
      tokenName,
      tokenSymbol,
      firstDetected: Date.now(),
      smartWalletsEntered: walletAddresses,
      smartWalletTiers: walletTiers,
      currentPrice,
      highestPrice: currentPrice,
      dipDepthPercent: 0,
      status: 'WATCHING',
      expiresAt: Date.now() + 2 * 60 * 60 * 1000 // 2 hours
    };

    this.trackedOpportunities.set(tokenAddress, opportunity);

    logger.info(`👀 Now tracking: ${tokenAddress.slice(0, 8)}...`, {
      walletCount: walletAddresses.length,
      currentPrice
    });
  }

  /**
   * Get all tracked opportunities
   */
  getTrackedOpportunities(): TrackedOpportunity[] {
    return Array.from(this.trackedOpportunities.values());
  }

  /**
   * Get opportunity count by status
   */
  getStats() {
    const opportunities = this.getTrackedOpportunities();

    return {
      total: opportunities.length,
      watching: opportunities.filter(o => o.status === 'WATCHING').length,
      ready: opportunities.filter(o => o.status === 'READY').length,
      entered: opportunities.filter(o => o.status === 'ENTERED').length,
      expired: opportunities.filter(o => o.status === 'EXPIRED').length
    };
  }

  /**
   * Clean up expired opportunities
   */
  private cleanupExpiredOpportunities(): void {
    const now = Date.now();
    const expiredCutoff = now - 24 * 60 * 60 * 1000; // Keep for 24 hours for logging

    for (const [tokenAddress, opportunity] of this.trackedOpportunities.entries()) {
      if (opportunity.status === 'EXPIRED' && opportunity.expiresAt < expiredCutoff) {
        this.trackedOpportunities.delete(tokenAddress);
        logger.debug(`Cleaned up expired opportunity: ${tokenAddress.slice(0, 8)}...`);
      }
    }
  }
}
