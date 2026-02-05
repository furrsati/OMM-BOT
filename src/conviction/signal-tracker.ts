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

import { Connection } from '@solana/web3.js';
import { logger } from '../utils/logger';
import { WalletManager } from '../discovery';
import { PriceFeed } from '../market';
import { SignalAggregator, AggregatedSignal } from './signal-aggregator';
import { ConvictionScorer } from './conviction-scorer';
import { EntryDecisionEngine, EntryDecision } from './entry-decision';

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
      // STUB: In production, this would:
      // 1. Query recent transactions from all watchlist wallets
      // 2. Identify token purchases in the last 5-30 minutes
      // 3. Group by token address
      // 4. Check if we're already tracking this token
      // 5. If not tracked and meets minimum criteria, start tracking

      logger.debug('Scanning for new opportunities (STUB)');

      // For now, this is a placeholder
      // In Phase 5 (Execution), we'll implement real-time transaction monitoring

    } catch (error: any) {
      logger.error('Error scanning for opportunities', { error: error.message });
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

      if (decision.approvedForExecution) {
        logger.info(`✅ ENTRY APPROVED for ${opportunity.tokenAddress.slice(0, 8)}...`, {
          conviction: decision.convictionScore,
          positionSize: decision.positionSizePercent + '%'
        });

        opportunity.status = 'ENTERED';

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
