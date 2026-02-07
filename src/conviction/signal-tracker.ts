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
import { SafetyScorer } from '../safety';
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
  private safetyScorer: SafetyScorer;

  private trackedOpportunities: Map<string, TrackedOpportunity> = new Map();
  private isRunning: boolean = false;
  private intervals: NodeJS.Timeout[] = []; // Track all intervals for cleanup

  // Memory management constants - VERY aggressive for 512MB Render instances
  private readonly MAX_TRACKED_OPPORTUNITIES = 15; // Reduced from 30 for memory
  private readonly CLEANUP_RETENTION_MS = 10 * 60 * 1000; // 10 minutes (was 30)

  // Callback for approved entries (Phase 5 integration)
  private onEntryApprovedCallback?: (decision: EntryDecision, signal: AggregatedSignal) => void;

  constructor(
    connection: Connection,
    walletManager: WalletManager,
    priceFeed: PriceFeed,
    signalAggregator: SignalAggregator,
    convictionScorer: ConvictionScorer,
    entryDecision: EntryDecisionEngine,
    safetyScorer: SafetyScorer
  ) {
    this.connection = connection;
    this.walletManager = walletManager;
    this.priceFeed = priceFeed;
    this.signalAggregator = signalAggregator;
    this.convictionScorer = convictionScorer;
    this.entryDecision = entryDecision;
    this.safetyScorer = safetyScorer;
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

    // Load existing active opportunities from database on startup
    this.loadActiveOpportunitiesFromDB().catch(error => {
      logger.error('Error loading opportunities from DB', { error: error.message });
    });

    // Clean up dead/expired tokens immediately
    this.cleanupDeadTokens().catch(error => {
      logger.error('Error cleaning up dead tokens', { error: error.message });
    });

    // Clear any existing intervals first
    this.clearAllIntervals();

    // Monitor for new opportunities every 30 seconds
    this.intervals.push(setInterval(() => {
      this.scanForOpportunities().catch(error => {
        logger.error('Error scanning for opportunities', { error: error.message });
      });
    }, 30000));

    // Also monitor tracked opportunities every 10 seconds
    this.intervals.push(setInterval(() => {
      this.updateTrackedOpportunities().catch(error => {
        logger.error('Error updating tracked opportunities', { error: error.message });
      });
    }, 10000));

    // Re-analyze tokens with 0 scores every 2 minutes
    this.intervals.push(setInterval(() => {
      this.reanalyzeZeroScoreTokens().catch(error => {
        logger.error('Error re-analyzing zero score tokens', { error: error.message });
      });
    }, 120000));

    // Clean up dead tokens every 2 minutes
    this.intervals.push(setInterval(() => {
      this.cleanupDeadTokens().catch(error => {
        logger.error('Error cleaning up dead tokens', { error: error.message });
      });
    }, 2 * 60 * 1000));

    // Also run initial re-analysis
    this.reanalyzeZeroScoreTokens().catch(error => {
      logger.debug('Initial re-analysis failed', { error: error.message });
    });

    logger.info('✅ Signal Tracker started');
  }

  /**
   * Stop tracking signals
   */
  stop(): void {
    logger.info('Stopping Signal Tracker...');
    this.isRunning = false;

    this.clearAllIntervals();
    this.trackedOpportunities.clear(); // Free memory on stop

    logger.info('✅ Signal Tracker stopped');
  }

  /**
   * Clear all intervals to prevent memory leaks
   */
  private clearAllIntervals(): void {
    for (const interval of this.intervals) {
      clearInterval(interval);
    }
    this.intervals = [];
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
        logger.warn('No smart wallets to monitor - watchlist is empty');
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
          // PRE-FILTER: Skip tokens with insufficient wallet interest
          // Require at least one Tier 1 or Tier 2 wallet, OR 2+ wallets total, OR 3+ Tier 3 wallets
          const tier1Count = data.walletTiers.filter(t => t === 1).length;
          const tier2Count = data.walletTiers.filter(t => t === 2).length;
          const hasQualityWallet = tier1Count > 0 || tier2Count > 0;
          const hasMultipleWallets = data.walletAddresses.length >= 2;
          const hasTier3Cluster = data.walletAddresses.length >= 3; // Allow 3+ Tier 3 wallets as valid signal

          if (!hasQualityWallet && !hasMultipleWallets && !hasTier3Cluster) {
            logger.debug(`Skipping ${tokenAddress.slice(0, 8)} - only ${data.walletAddresses.length} Tier 3 wallet(s)`);
            continue;
          }

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
   * Get recent token purchases from a wallet (last 60 minutes)
   */
  private async getRecentTokenPurchases(walletAddress: string): Promise<Array<{
    tokenAddress: string;
    timestamp: number;
    amount: number;
  }>> {
    const purchases: Array<{ tokenAddress: string; timestamp: number; amount: number }> = [];

    try {
      const pubkey = new PublicKey(walletAddress);
      const sixtyMinutesAgo = Math.floor(Date.now() / 1000) - 3600;

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
        sig.blockTime && sig.blockTime >= sixtyMinutesAgo
      );

      for (const sig of recentSigs.slice(0, 10)) {
        try {
          let tx: any = await rateLimitedRPC(
            () => this.connection.getParsedTransaction(
              sig.signature,
              { maxSupportedTransactionVersion: 0 }
            ),
            0 // Lower priority
          );

          if (!tx || !tx.meta || tx.meta.err) {
            tx = null; // Release memory
            continue;
          }

          // Check for token balance increases (purchases) - extract before releasing
          const preBalances = tx.meta.preTokenBalances || [];
          const postBalances = tx.meta.postTokenBalances || [];

          // Release tx early (500KB-2MB each)
          tx = null;

          for (const post of postBalances) {
            if (!post.mint || !post.owner) continue;
            if (post.owner !== walletAddress) continue;

            const pre = preBalances.find((p: any) =>
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

      // Run safety analysis and calculate conviction score
      let safetyScore = 0;
      let convictionScore = 0;
      let safetyChecks = {};
      let isHoneypot = false;
      let hasMintAuthority = false;
      let hasFreezeAuthority = false;

      try {
        // Try direct safety analysis first (faster, more reliable)
        const safetyResult = await this.safetyScorer.analyze(tokenAddress);
        if (safetyResult) {
          safetyScore = safetyResult.overallScore || 0;
          isHoneypot = safetyResult.honeypotAnalysis?.isHoneypot || false;
          hasMintAuthority = safetyResult.contractAnalysis?.hasMintAuthority || false;
          hasFreezeAuthority = safetyResult.contractAnalysis?.hasFreezeAuthority || false;
          safetyChecks = safetyResult;
        }

        // Try to get full signal aggregation for conviction score
        // Pass the known wallet data so it uses REAL wallet info
        try {
          const knownWalletData = {
            walletAddresses: data.walletAddresses,
            walletTiers: data.walletTiers,
            firstDetected: data.firstSeen
          };

          const aggregatedSignal = await this.signalAggregator.aggregateSignals(
            tokenAddress,
            tokenInfo.name,
            tokenInfo.symbol,
            knownWalletData,
            priceData?.priceUSD || undefined // Use current price as starting high
          );
          const conviction = await this.convictionScorer.calculateConviction(aggregatedSignal);
          convictionScore = conviction.totalScore || 0;

          logger.info(`Conviction score calculated: ${convictionScore.toFixed(1)} (${conviction.convictionLevel})`, {
            tier1: tier1Count,
            tier2: tier2Count,
            tier3: tier3Count,
            safetyScore,
            shouldEnter: conviction.shouldEnter
          });
        } catch (aggError: any) {
          // Use safety score as base conviction if aggregation fails
          convictionScore = safetyScore * 0.25; // Safety is 25% of conviction
          logger.debug(`Signal aggregation failed, using safety-based conviction: ${convictionScore}`);
        }

        logger.info(`Safety analysis for ${tokenAddress.slice(0, 8)}: score=${safetyScore}, conviction=${convictionScore}, honeypot=${isHoneypot}`);
      } catch (error: any) {
        logger.warn(`Safety analysis failed for ${tokenAddress.slice(0, 8)}: ${error.message}`);
      }

      // Determine status based on safety
      let status = 'ANALYZING';
      let rejectionReason = null;
      if (isHoneypot) {
        status = 'REJECTED';
        rejectionReason = 'HONEYPOT DETECTED';
      } else if (hasMintAuthority) {
        status = 'REJECTED';
        rejectionReason = 'Mint authority active';
      }

      await query(`
        INSERT INTO token_opportunities (
          token_address, token_name, token_symbol, discovered_via,
          smart_wallets_entered, smart_wallet_count,
          tier1_count, tier2_count, tier3_count,
          current_price, liquidity_usd, holder_count,
          safety_score, safety_checks, is_honeypot, has_mint_authority, has_freeze_authority,
          conviction_score, status, rejection_reason, expires_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, NOW() + INTERVAL '2 hours')
        ON CONFLICT (token_address) DO UPDATE SET
          smart_wallets_entered = EXCLUDED.smart_wallets_entered,
          smart_wallet_count = EXCLUDED.smart_wallet_count,
          tier1_count = EXCLUDED.tier1_count,
          tier2_count = EXCLUDED.tier2_count,
          tier3_count = EXCLUDED.tier3_count,
          current_price = COALESCE(EXCLUDED.current_price, token_opportunities.current_price),
          safety_score = EXCLUDED.safety_score,
          safety_checks = EXCLUDED.safety_checks,
          is_honeypot = EXCLUDED.is_honeypot,
          has_mint_authority = EXCLUDED.has_mint_authority,
          has_freeze_authority = EXCLUDED.has_freeze_authority,
          conviction_score = EXCLUDED.conviction_score,
          status = CASE WHEN token_opportunities.status = 'ANALYZING' THEN EXCLUDED.status ELSE token_opportunities.status END,
          rejection_reason = CASE WHEN token_opportunities.status = 'ANALYZING' THEN EXCLUDED.rejection_reason ELSE token_opportunities.rejection_reason END,
          expires_at = GREATEST(token_opportunities.expires_at, NOW() + INTERVAL '2 hours'),
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
        safetyScore,
        JSON.stringify(safetyChecks),
        isHoneypot,
        hasMintAuthority,
        hasFreezeAuthority,
        convictionScore,
        status,
        rejectionReason
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

        // Calculate token age in minutes
        const tokenAgeMinutes = (Date.now() - opportunity.firstDetected) / 60000;

        // ============================================================
        // REAL-TIME QUALITY CHECKS - Remove tokens that became unviable
        // ============================================================

        // Check 1: Liquidity dropped below minimum
        if (priceData.liquidityUSD !== undefined && priceData.liquidityUSD < 5000) {
          logger.info(`💀 ${tokenAddress.slice(0, 8)}... liquidity dropped to $${priceData.liquidityUSD.toFixed(0)} - removing`);
          opportunity.status = 'EXPIRED';
          await this.updateOpportunityStatus(tokenAddress, 'REJECTED', `Liquidity dropped to $${priceData.liquidityUSD.toFixed(0)}`);
          this.trackedOpportunities.delete(tokenAddress);
          continue;
        }

        // Check 2: Price collapsed > 80% (faster than cleanup interval)
        if (opportunity.highestPrice > 0 && priceData.priceUSD > 0) {
          const priceRatio = priceData.priceUSD / opportunity.highestPrice;
          if (priceRatio < 0.2) {
            logger.info(`💀 ${tokenAddress.slice(0, 8)}... price collapsed ${((1 - priceRatio) * 100).toFixed(0)}% - removing`);
            opportunity.status = 'EXPIRED';
            await this.updateOpportunityStatus(tokenAddress, 'REJECTED', `Price collapsed ${((1 - priceRatio) * 100).toFixed(0)}%`);
            this.trackedOpportunities.delete(tokenAddress);
            continue;
          }
        }

        // Check 3: No smart wallet interest after 30 minutes
        if (opportunity.smartWalletsEntered.length === 0 && tokenAgeMinutes > 30) {
          logger.info(`💀 ${tokenAddress.slice(0, 8)}... no smart wallet interest after 30 min - removing`);
          opportunity.status = 'EXPIRED';
          await this.updateOpportunityStatus(tokenAddress, 'REJECTED', 'No smart wallet interest after 30 min');
          this.trackedOpportunities.delete(tokenAddress);
          continue;
        }

        // Update database with current market data
        await this.updateOpportunityMarketData(tokenAddress, priceData, dipDepth, opportunity.highestPrice);

        // Count Tier 1 wallets
        const tier1Count = opportunity.smartWalletTiers.filter(t => t === 1).length;
        const tier2Count = opportunity.smartWalletTiers.filter(t => t === 2).length;

        // ENTRY TRIGGER 1: Early Discovery (per CLAUDE.md Category 5)
        // If 1+ Tier 1 wallets buy within first 10 minutes AND safety passes → Enter without dip
        // LOWERED: Was 2+ Tier 1, now 1+ to allow trading with limited wallet pool
        if (opportunity.status === 'WATCHING' && tokenAgeMinutes <= 10 && tier1Count >= 1) {
          logger.info(`🚀 EARLY DISCOVERY: ${tokenAddress.slice(0, 8)}... (${tier1Count} Tier 1 wallets, ${tokenAgeMinutes.toFixed(1)} min old)`);
          opportunity.status = 'READY';
          await this.evaluateEntry(opportunity, true); // true = isEarlyDiscovery
          continue;
        }

        // ENTRY TRIGGER 2: Primary Entry (2+ Tier 1/2 wallets + 20-35% dip)
        // LOWERED: Was 3+ wallets, now 2+ to allow trading with limited wallet pool
        if (opportunity.status === 'WATCHING' && dipDepth >= 20 && dipDepth <= 35) {
          if (tier1Count >= 2 || (tier1Count + tier2Count) >= 2) {
            logger.info(`🎯 PRIMARY ENTRY: ${tokenAddress.slice(0, 8)}... (${dipDepth.toFixed(1)}% dip, ${tier1Count}T1/${tier2Count}T2)`);
            opportunity.status = 'READY';
            await this.evaluateEntry(opportunity);
            continue;
          }
        }

        // ENTRY TRIGGER 3: Secondary Entry (1-2 Tier 1 + dip + high safety score)
        // This will be evaluated by the conviction scorer based on safety score threshold
        if (opportunity.status === 'WATCHING' && dipDepth >= 20 && dipDepth <= 35) {
          if (tier1Count >= 1 || tier2Count >= 2) {
            logger.info(`🎯 SECONDARY ENTRY: ${tokenAddress.slice(0, 8)}... (${dipDepth.toFixed(1)}% dip, ${tier1Count}T1/${tier2Count}T2)`);
            opportunity.status = 'READY';
            await this.evaluateEntry(opportunity);
            continue;
          }
        }

        // ENTRY TRIGGER 4: Tier 3 Cluster (3+ Tier 3 wallets + dip)
        // Allows signals from Tier 3 wallets when multiple enter the same token
        if (opportunity.status === 'WATCHING' && dipDepth >= 20 && dipDepth <= 35) {
          const tier3Count = opportunity.smartWalletTiers.filter(t => t === 3).length;
          if (tier3Count >= 3) {
            logger.info(`🎯 TIER 3 CLUSTER: ${tokenAddress.slice(0, 8)}... (${dipDepth.toFixed(1)}% dip, ${tier3Count} Tier 3 wallets)`);
            opportunity.status = 'READY';
            await this.evaluateEntry(opportunity);
            continue;
          }
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
  private async updateOpportunityStatus(tokenAddress: string, status: string, rejectionReason?: string): Promise<void> {
    try {
      await query(`
        UPDATE token_opportunities SET
          status = $2,
          rejection_reason = COALESCE($3, rejection_reason),
          last_updated = NOW()
        WHERE token_address = $1
      `, [tokenAddress, status, rejectionReason || null]);
    } catch (error: any) {
      logger.error('Database query error', { error: error.message, query: 'updateOpportunityStatus', params: JSON.stringify([tokenAddress, status, rejectionReason]) });
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
   *
   * @param opportunity - The tracked opportunity to evaluate
   * @param isEarlyDiscovery - If true, this is an early discovery entry (doesn't require dip)
   */
  private async evaluateEntry(opportunity: TrackedOpportunity, isEarlyDiscovery: boolean = false): Promise<void> {
    try {
      const entryType = isEarlyDiscovery ? '🚀 EARLY DISCOVERY' : '🎯 STANDARD';
      logger.info(`${entryType} - Evaluating entry for ${opportunity.tokenAddress.slice(0, 8)}...`);

      // Prepare known wallet data from the tracked opportunity
      // This ensures the signal aggregator uses REAL wallet data we've already collected
      const knownWalletData = {
        walletAddresses: opportunity.smartWalletsEntered,
        walletTiers: opportunity.smartWalletTiers,
        firstDetected: opportunity.firstDetected
      };

      const tier1Count = knownWalletData.walletTiers.filter(t => t === 1).length;
      const tier2Count = knownWalletData.walletTiers.filter(t => t === 2).length;
      const tier3Count = knownWalletData.walletTiers.filter(t => t === 3).length;

      logger.info(`📊 Passing ${knownWalletData.walletAddresses.length} tracked wallets to signal aggregator`, {
        tier1: tier1Count,
        tier2: tier2Count,
        tier3: tier3Count,
        highestPrice: opportunity.highestPrice,
        isEarlyDiscovery
      });

      // Step 1: Aggregate all signals (pass wallet data and known high price for accurate dip calc)
      const aggregatedSignal = await this.signalAggregator.aggregateSignals(
        opportunity.tokenAddress,
        opportunity.tokenName,
        opportunity.tokenSymbol,
        knownWalletData,
        opportunity.highestPrice
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
   * Clean up expired opportunities and enforce size cap
   */
  private cleanupExpiredOpportunities(): void {
    const now = Date.now();
    const expiredCutoff = now - this.CLEANUP_RETENTION_MS; // 1 hour retention

    // Remove expired entries
    for (const [tokenAddress, opportunity] of this.trackedOpportunities.entries()) {
      if (opportunity.status === 'EXPIRED' && opportunity.expiresAt < expiredCutoff) {
        this.trackedOpportunities.delete(tokenAddress);
        logger.debug(`Cleaned up expired opportunity: ${tokenAddress.slice(0, 8)}...`);
      }
    }

    // Enforce hard size cap - remove oldest EXPIRED/ENTERED first, then oldest WATCHING
    if (this.trackedOpportunities.size > this.MAX_TRACKED_OPPORTUNITIES) {
      const excess = this.trackedOpportunities.size - this.MAX_TRACKED_OPPORTUNITIES;
      const entries = Array.from(this.trackedOpportunities.entries())
        .sort((a, b) => {
          // Priority: WATCHING > READY > ENTERED > EXPIRED
          const statusOrder = { WATCHING: 0, READY: 1, ENTERED: 2, EXPIRED: 3 };
          const statusDiff = statusOrder[b[1].status] - statusOrder[a[1].status];
          if (statusDiff !== 0) return statusDiff;
          // Then by age (oldest first for removal)
          return a[1].firstDetected - b[1].firstDetected;
        });

      for (let i = 0; i < excess && i < entries.length; i++) {
        this.trackedOpportunities.delete(entries[i][0]);
        logger.debug(`Size cap: removed ${entries[i][0].slice(0, 8)}... (${entries[i][1].status})`);
      }

      logger.info(`🧹 Memory cap enforced: removed ${excess} oldest entries, now tracking ${this.trackedOpportunities.size}`);
    }
  }

  /**
   * Load active opportunities from database on startup
   * This ensures we don't lose track of opportunities between restarts
   */
  private async loadActiveOpportunitiesFromDB(): Promise<void> {
    try {
      logger.info('📂 Loading HIGH-QUALITY opportunities from database...');

      // STRICTER FILTERS - Only load tokens with real potential
      const result = await query<{
        token_address: string;
        token_name: string;
        token_symbol: string;
        smart_wallets_entered: string[];
        tier1_count: number;
        tier2_count: number;
        tier3_count: number;
        discovered_at: Date;
        current_price: number;
        ath_price: number;
        dip_from_high: number;
        status: string;
        conviction_score: number;
        safety_score: number;
      }>(`
        SELECT token_address, token_name, token_symbol,
               smart_wallets_entered, tier1_count, tier2_count, tier3_count,
               discovered_at, current_price, ath_price, dip_from_high, status,
               conviction_score, safety_score
        FROM token_opportunities
        WHERE status IN ('ANALYZING', 'WATCHING', 'QUALIFIED')
        AND (expires_at > NOW() OR expires_at IS NULL)
        AND (liquidity_usd >= 5000 OR liquidity_usd IS NULL)
        AND is_honeypot = false
        AND (has_mint_authority = false OR has_mint_authority IS NULL)
        AND (
          -- Must have good safety score OR be very new
          (safety_score >= 40) OR (discovered_at > NOW() - INTERVAL '30 minutes')
        )
        AND (
          -- Must have decent conviction OR be very new
          (conviction_score >= 30) OR (discovered_at > NOW() - INTERVAL '30 minutes')
        )
        AND (
          -- Must have smart wallet interest OR be very new
          (smart_wallet_count > 0) OR (discovered_at > NOW() - INTERVAL '30 minutes')
        )
        ORDER BY conviction_score DESC NULLS LAST
        LIMIT 30
      `);

      if (result.rows.length === 0) {
        logger.info('No active opportunities found in database');
        return;
      }

      let loaded = 0;
      for (const row of result.rows) {
        // Skip if already tracking
        if (this.trackedOpportunities.has(row.token_address)) {
          continue;
        }

        // Reconstruct wallet tiers
        const walletTiers = [
          ...Array(row.tier1_count || 0).fill(1),
          ...Array(row.tier2_count || 0).fill(2),
          ...Array(row.tier3_count || 0).fill(3)
        ];

        const opportunity: TrackedOpportunity = {
          tokenAddress: row.token_address,
          tokenName: row.token_name || 'Unknown',
          tokenSymbol: row.token_symbol || '???',
          firstDetected: row.discovered_at ? new Date(row.discovered_at).getTime() : Date.now(),
          smartWalletsEntered: row.smart_wallets_entered || [],
          smartWalletTiers: walletTiers,
          currentPrice: row.current_price || 0,
          highestPrice: row.ath_price || row.current_price || 0,
          dipDepthPercent: row.dip_from_high || 0,
          status: 'WATCHING',
          expiresAt: Date.now() + 2 * 60 * 60 * 1000 // 2 hours from now
        };

        this.trackedOpportunities.set(row.token_address, opportunity);
        loaded++;
      }

      logger.info(`✅ Loaded ${loaded} active opportunities from database`, {
        total: result.rows.length,
        newlyLoaded: loaded
      });

    } catch (error: any) {
      logger.error('Error loading opportunities from DB', { error: error.message });
    }
  }

  /**
   * AGGRESSIVE Token Cleanup - Focus on Quality
   *
   * Removes tokens that don't have real potential:
   * - Low liquidity (< $5K)
   * - Low safety score (< 40)
   * - Low conviction score (< 30 after 1 hour)
   * - No smart wallet interest (after 30 min)
   * - Stale data (> 2 hours without update)
   * - No trading volume (< $1K after 1 hour)
   * - Price collapsed (> 90% from ATH)
   * - Rejected tokens (after 4 hours)
   * - Old entries (> 7 days)
   */
  private async cleanupDeadTokens(): Promise<void> {
    try {
      logger.info('🧹 Running AGGRESSIVE token cleanup...');

      // 1. Mark tokens with LOW LIQUIDITY as DEAD (threshold raised to $5K)
      const deadLiquidity = await query(`
        UPDATE token_opportunities
        SET status = 'REJECTED', rejection_reason = 'Low liquidity (<$5K)'
        WHERE status IN ('ANALYZING', 'WATCHING', 'QUALIFIED')
        AND (liquidity_usd IS NULL OR liquidity_usd < 5000)
        AND discovered_at < NOW() - INTERVAL '10 minutes'
      `);

      // 2. Mark tokens with LOW SAFETY SCORE as DEAD
      const deadSafety = await query(`
        UPDATE token_opportunities
        SET status = 'REJECTED', rejection_reason = 'Low safety score (<40)'
        WHERE status IN ('ANALYZING', 'WATCHING')
        AND safety_score IS NOT NULL
        AND safety_score < 40
        AND discovered_at < NOW() - INTERVAL '10 minutes'
      `);

      // 3. Mark tokens with LOW CONVICTION SCORE as DEAD (after 20 min to analyze)
      const deadConviction = await query(`
        UPDATE token_opportunities
        SET status = 'REJECTED', rejection_reason = 'Low conviction score (<30)'
        WHERE status IN ('ANALYZING', 'WATCHING')
        AND conviction_score IS NOT NULL
        AND conviction_score < 30
        AND discovered_at < NOW() - INTERVAL '20 minutes'
      `);

      // 4. Mark tokens with NO SMART WALLET INTEREST as DEAD
      const deadNoWallets = await query(`
        UPDATE token_opportunities
        SET status = 'REJECTED', rejection_reason = 'No smart wallet interest'
        WHERE status IN ('ANALYZING', 'WATCHING')
        AND (smart_wallet_count IS NULL OR smart_wallet_count = 0)
        AND discovered_at < NOW() - INTERVAL '15 minutes'
      `);

      // 5. Mark tokens with STALE DATA as EXPIRED
      const staleData = await query(`
        UPDATE token_opportunities
        SET status = 'EXPIRED', rejection_reason = 'Stale data (>30min without update)'
        WHERE status IN ('ANALYZING', 'WATCHING')
        AND last_updated < NOW() - INTERVAL '30 minutes'
      `);

      // 6. Mark tokens with NO VOLUME as DEAD
      const deadNoVolume = await query(`
        UPDATE token_opportunities
        SET status = 'REJECTED', rejection_reason = 'No trading volume (<$1K)'
        WHERE status IN ('ANALYZING', 'WATCHING')
        AND (volume_24h IS NULL OR volume_24h < 1000)
        AND discovered_at < NOW() - INTERVAL '20 minutes'
      `);

      // 7. Mark old ANALYZING tokens as EXPIRED (30 min timeout)
      const expiredAnalyzing = await query(`
        UPDATE token_opportunities
        SET status = 'EXPIRED', rejection_reason = 'Analysis timeout'
        WHERE status = 'ANALYZING'
        AND discovered_at < NOW() - INTERVAL '30 minutes'
      `);

      // 8. Mark tokens where PRICE COLLAPSED (>90%) as DEAD
      const deadPrice = await query(`
        UPDATE token_opportunities
        SET status = 'REJECTED', rejection_reason = 'Price collapsed >90%'
        WHERE status IN ('ANALYZING', 'WATCHING', 'QUALIFIED')
        AND ath_price > 0
        AND current_price > 0
        AND (current_price / ath_price) < 0.1
      `);

      // 9. DELETE REJECTED tokens after 4 hours (not 7 days)
      const deletedRejected = await query(`
        DELETE FROM token_opportunities
        WHERE status = 'REJECTED'
        AND discovered_at < NOW() - INTERVAL '4 hours'
      `);

      // 10. Mark QUALIFIED but unexecuted tokens as EXPIRED after 30 min
      const expiredQualified = await query(`
        UPDATE token_opportunities
        SET status = 'EXPIRED', rejection_reason = 'Qualified but not executed in time'
        WHERE status = 'QUALIFIED'
        AND decision_time < NOW() - INTERVAL '30 minutes'
      `);

      // 11. DELETE very old entries (older than 7 days)
      const deletedOld = await query(`
        DELETE FROM token_opportunities
        WHERE discovered_at < NOW() - INTERVAL '7 days'
      `);

      // 12. DELETE EXPIRED/REJECTED tokens older than 24 hours (keep DB clean)
      const deletedDeadExpired = await query(`
        DELETE FROM token_opportunities
        WHERE status IN ('EXPIRED', 'REJECTED')
        AND discovered_at < NOW() - INTERVAL '24 hours'
      `);

      // 13. Remove from in-memory tracking
      const tokensToRemove: string[] = [];
      for (const [tokenAddress, opp] of this.trackedOpportunities.entries()) {
        // Remove if expired
        if (opp.expiresAt < Date.now()) {
          tokensToRemove.push(tokenAddress);
          continue;
        }
        // Remove if price collapsed
        if (opp.highestPrice > 0 && opp.currentPrice > 0) {
          const priceRatio = opp.currentPrice / opp.highestPrice;
          if (priceRatio < 0.1) {
            tokensToRemove.push(tokenAddress);
            continue;
          }
        }
        // Remove if no smart wallets
        if (opp.smartWalletsEntered.length === 0) {
          const ageMinutes = (Date.now() - opp.firstDetected) / 60000;
          if (ageMinutes > 30) {
            tokensToRemove.push(tokenAddress);
            continue;
          }
        }
      }

      for (const addr of tokensToRemove) {
        this.trackedOpportunities.delete(addr);
      }

      // Calculate totals
      const totalMarkedDead =
        (deadLiquidity.rowCount || 0) +
        (deadSafety.rowCount || 0) +
        (deadConviction.rowCount || 0) +
        (deadNoWallets.rowCount || 0) +
        (deadNoVolume.rowCount || 0) +
        (deadPrice.rowCount || 0);

      const totalMarkedExpired =
        (staleData.rowCount || 0) +
        (expiredAnalyzing.rowCount || 0) +
        (expiredQualified.rowCount || 0);

      const totalDeleted =
        (deletedRejected.rowCount || 0) +
        (deletedOld.rowCount || 0) +
        (deletedDeadExpired.rowCount || 0);

      const totalCleaned = totalMarkedDead + totalMarkedExpired + totalDeleted + tokensToRemove.length;

      if (totalCleaned > 0) {
        logger.info(`✅ AGGRESSIVE cleanup complete: ${totalCleaned} tokens cleaned`, {
          markedDead: totalMarkedDead,
          markedExpired: totalMarkedExpired,
          deleted: totalDeleted,
          inMemory: tokensToRemove.length,
          breakdown: {
            lowLiquidity: deadLiquidity.rowCount || 0,
            lowSafety: deadSafety.rowCount || 0,
            lowConviction: deadConviction.rowCount || 0,
            noWallets: deadNoWallets.rowCount || 0,
            noVolume: deadNoVolume.rowCount || 0,
            priceCollapsed: deadPrice.rowCount || 0,
            staleData: staleData.rowCount || 0,
            analysisTimeout: expiredAnalyzing.rowCount || 0,
            qualifiedExpired: expiredQualified.rowCount || 0
          }
        });
      }

      // Log remaining active count
      const activeCount = await query<{ count: string }>(`
        SELECT COUNT(*) as count FROM token_opportunities
        WHERE status IN ('ANALYZING', 'WATCHING', 'QUALIFIED')
      `);
      const currentCount = parseInt(activeCount.rows[0]?.count || '0');
      logger.info(`📊 Active opportunities remaining: ${currentCount}`);

      // HARD CAP ENFORCEMENT: Keep only top 30 tokens by conviction score
      const MAX_TOKENS = 30;
      if (currentCount > MAX_TOKENS) {
        const excessCount = currentCount - MAX_TOKENS;
        logger.warn(`🚨 Token cap exceeded (${currentCount}/${MAX_TOKENS}) - removing ${excessCount} lowest scoring tokens`);

        await query(`
          DELETE FROM token_opportunities
          WHERE id IN (
            SELECT id FROM token_opportunities
            WHERE status IN ('ANALYZING', 'WATCHING', 'QUALIFIED')
            ORDER BY conviction_score ASC NULLS FIRST, discovered_at ASC
            LIMIT $1
          )
        `, [excessCount]);

        logger.info(`✅ Hard cap enforced: removed ${excessCount} lowest scoring tokens`);
      }

      // SYNC IN-MEMORY WITH DATABASE: Remove any tokens from memory not in active DB set
      const activeTokensResult = await query<{ token_address: string }>(`
        SELECT token_address FROM token_opportunities
        WHERE status IN ('ANALYZING', 'WATCHING', 'QUALIFIED')
      `);
      const activeSet = new Set(activeTokensResult.rows.map(r => r.token_address));

      let memorySyncCount = 0;
      for (const [tokenAddress] of this.trackedOpportunities) {
        if (!activeSet.has(tokenAddress)) {
          this.trackedOpportunities.delete(tokenAddress);
          memorySyncCount++;
        }
      }

      if (memorySyncCount > 0) {
        logger.info(`🔄 Synced in-memory tracking: removed ${memorySyncCount} stale entries`);
      }

    } catch (error: any) {
      logger.error('Error cleaning up dead tokens', { error: error.message });
    }
  }

  /**
   * Re-analyze tokens with 0 safety scores
   * This catches tokens that were inserted before safety analysis was added
   */
  private async reanalyzeZeroScoreTokens(): Promise<void> {
    try {
      // Find tokens with 0 safety scores that are still analyzing
      const result = await query<{
        token_address: string;
        token_name: string;
        token_symbol: string;
        smart_wallets_entered: string[];
        tier1_count: number;
        tier2_count: number;
        tier3_count: number;
        discovered_at: Date;
        ath_price: number;
      }>(
        `SELECT token_address, token_name, token_symbol,
                smart_wallets_entered, tier1_count, tier2_count, tier3_count,
                discovered_at, ath_price
         FROM token_opportunities
         WHERE safety_score = 0
         AND status = 'ANALYZING'
         AND (expires_at > NOW() OR expires_at IS NULL)
         ORDER BY discovered_at DESC
         LIMIT 10`
      );

      if (result.rows.length === 0) {
        return;
      }

      logger.info(`🔄 Re-analyzing ${result.rows.length} tokens with 0 safety scores...`);

      for (const token of result.rows) {
        try {
          // Reconstruct wallet data from database
          const walletAddresses = token.smart_wallets_entered || [];
          const walletTiers = [
            ...Array(token.tier1_count || 0).fill(1),
            ...Array(token.tier2_count || 0).fill(2),
            ...Array(token.tier3_count || 0).fill(3)
          ];

          const knownWalletData = {
            walletAddresses,
            walletTiers,
            firstDetected: token.discovered_at ? new Date(token.discovered_at).getTime() : Date.now()
          };

          // Run safety analysis with wallet data
          const aggregatedSignal = await this.signalAggregator.aggregateSignals(
            token.token_address,
            token.token_name || 'Unknown',
            token.token_symbol || '???',
            knownWalletData,
            token.ath_price || undefined
          );

          let safetyScore = 0;
          let isHoneypot = false;
          let hasMintAuthority = false;
          let hasFreezeAuthority = false;
          let safetyChecks = {};

          if (aggregatedSignal.safety) {
            safetyScore = aggregatedSignal.safety.overallScore || 0;
            isHoneypot = aggregatedSignal.safety.honeypotAnalysis?.isHoneypot || false;
            hasMintAuthority = aggregatedSignal.safety.contractAnalysis?.hasMintAuthority || false;
            hasFreezeAuthority = aggregatedSignal.safety.contractAnalysis?.hasFreezeAuthority || false;
            safetyChecks = aggregatedSignal.safety;
          }

          // Calculate conviction score
          const conviction = await this.convictionScorer.calculateConviction(aggregatedSignal);
          const convictionScore = conviction.totalScore || 0;

          // Determine status based on safety
          let status = 'ANALYZING';
          let rejectionReason = null;
          if (isHoneypot) {
            status = 'REJECTED';
            rejectionReason = 'HONEYPOT DETECTED';
          } else if (hasMintAuthority) {
            status = 'REJECTED';
            rejectionReason = 'Mint authority active';
          }

          // Update the token
          await query(`
            UPDATE token_opportunities SET
              safety_score = $2,
              safety_checks = $3,
              is_honeypot = $4,
              has_mint_authority = $5,
              has_freeze_authority = $6,
              conviction_score = $7,
              status = CASE WHEN status = 'ANALYZING' THEN $8 ELSE status END,
              rejection_reason = CASE WHEN status = 'ANALYZING' THEN $9 ELSE rejection_reason END,
              last_updated = NOW()
            WHERE token_address = $1
          `, [
            token.token_address,
            safetyScore,
            JSON.stringify(safetyChecks),
            isHoneypot,
            hasMintAuthority,
            hasFreezeAuthority,
            convictionScore,
            status,
            rejectionReason
          ]);

          logger.debug(`Updated ${token.token_symbol}: safety=${safetyScore}, conviction=${convictionScore}`);

          // Small delay to avoid overwhelming APIs
          await new Promise(resolve => setTimeout(resolve, 1000));

        } catch (error: any) {
          logger.debug(`Failed to re-analyze ${token.token_address.slice(0, 8)}: ${error.message}`);
        }
      }

      logger.info(`✅ Completed re-analysis of tokens`);

    } catch (error: any) {
      logger.debug(`Error in reanalyzeZeroScoreTokens: ${error.message}`);
    }
  }
}
