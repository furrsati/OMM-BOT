/**
 * Execution Manager
 *
 * Coordinates all trade execution activities:
 * - Manages buy and sell order queues
 * - Prioritizes sells over buys (capital protection)
 * - Prevents duplicate executions on same token
 * - Tracks execution metrics (latency, success rate)
 * - Coordinates with Entry Decision Engine and Position Manager
 */

import { logger } from '../utils/logger';
import { BuyExecutor, BuyExecutionResult } from './buy-executor';
import { SellExecutor, SellExecutionResult, SellOrder } from './sell-executor';
import { EntryDecision, EntryDecisionEngine } from '../conviction/entry-decision';
import { AggregatedSignal } from '../conviction/signal-aggregator';
import { query } from '../db/postgres';
import { PatternMatcher } from '../learning/pattern-matcher';

interface PendingBuyOrder {
  decision: EntryDecision;
  signal: AggregatedSignal;
  queuedAt: number;
}

interface PendingSellOrder {
  order: SellOrder;
  queuedAt: number;
}

interface ExecutionMetrics {
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  totalRetries: number;
  averageLatencyMs: number;
  totalLatencyMs: number;
  lastExecutionTime: number;
  consecutiveHighLatency: number;
  latencyHistory: number[];
}

export class ExecutionManager {
  private buyExecutor: BuyExecutor;
  private sellExecutor: SellExecutor;
  private entryDecision: EntryDecisionEngine;

  // Queues
  private pendingBuys: Map<string, PendingBuyOrder> = new Map();
  private pendingSells: Map<string, PendingSellOrder> = new Map();

  // Execution tracking
  private executingBuys: Set<string> = new Set();
  private executingSells: Set<string> = new Set();

  // Metrics
  private metrics: ExecutionMetrics = {
    totalExecutions: 0,
    successfulExecutions: 0,
    failedExecutions: 0,
    totalRetries: 0,
    averageLatencyMs: 0,
    totalLatencyMs: 0,
    lastExecutionTime: 0,
    consecutiveHighLatency: 0,
    latencyHistory: []
  };

  // Latency thresholds
  private readonly LATENCY_WARNING_MS = 500;
  private readonly LATENCY_CRITICAL_MS = 1000;
  private readonly HIGH_LATENCY_THRESHOLD = 3;

  // Pattern matcher for fingerprinting
  private patternMatcher: PatternMatcher | null = null;

  private isRunning: boolean = false;
  private processInterval: NodeJS.Timeout | null = null;

  constructor(
    buyExecutor: BuyExecutor,
    sellExecutor: SellExecutor,
    entryDecision: EntryDecisionEngine
  ) {
    this.buyExecutor = buyExecutor;
    this.sellExecutor = sellExecutor;
    this.entryDecision = entryDecision;

    logger.info('Execution Manager initialized');

    // Start processing queues
    this.start();
  }

  /**
   * Queue a buy order for execution
   */
  async queueBuyOrder(decision: EntryDecision, signal: AggregatedSignal): Promise<void> {
    try {
      const tokenAddress = signal.tokenAddress;

      // Check for duplicate
      if (this.pendingBuys.has(tokenAddress) || this.executingBuys.has(tokenAddress)) {
        logger.warn('Buy order already queued or executing', {
          token: tokenAddress.slice(0, 8)
        });
        return;
      }

      // Add to queue
      this.pendingBuys.set(tokenAddress, {
        decision,
        signal,
        queuedAt: Date.now()
      });

      logger.info('📥 Buy order queued', {
        token: tokenAddress.slice(0, 8),
        conviction: decision.convictionScore.toFixed(1),
        positionSize: decision.positionSizePercent.toFixed(2) + '%',
        queueSize: this.pendingBuys.size
      });

    } catch (error: any) {
      logger.error('Failed to queue buy order', {
        token: signal.tokenAddress.slice(0, 8),
        error: error.message
      });
    }
  }

  /**
   * Queue a sell order for execution
   */
  async queueSellOrder(order: SellOrder): Promise<void> {
    try {
      const tokenAddress = order.position.tokenAddress;

      // Check for duplicate
      if (this.pendingSells.has(tokenAddress) || this.executingSells.has(tokenAddress)) {
        logger.warn('Sell order already queued or executing', {
          token: tokenAddress.slice(0, 8)
        });
        return;
      }

      // Add to queue
      this.pendingSells.set(tokenAddress, {
        order,
        queuedAt: Date.now()
      });

      logger.info('📥 Sell order queued', {
        token: tokenAddress.slice(0, 8),
        reason: order.reason,
        urgency: order.urgency,
        percent: order.percentToSell.toFixed(1) + '%',
        queueSize: this.pendingSells.size
      });

    } catch (error: any) {
      logger.error('Failed to queue sell order', {
        token: order.position.tokenAddress.slice(0, 8),
        error: error.message
      });
    }
  }

  /**
   * Start processing queues
   */
  private start(): void {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;

    // Process queues every 2 seconds
    this.processInterval = setInterval(() => {
      this.processQueues().catch(error => {
        logger.error('Error processing execution queues', { error: error.message });
      });
    }, 2000);

    logger.info('✅ Execution Manager started (processing every 2s)');
  }

  /**
   * Stop processing queues
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;

    if (this.processInterval) {
      clearInterval(this.processInterval);
      this.processInterval = null;
    }

    logger.info('Execution Manager stopped');
  }

  /**
   * Process queues (sells have priority over buys)
   */
  private async processQueues(): Promise<void> {
    try {
      // Process sells first (capital protection priority)
      await this.processSellQueue();

      // Then process buys
      await this.processBuyQueue();

    } catch (error: any) {
      logger.error('Error in queue processing', { error: error.message });
    }
  }

  /**
   * Process pending buy orders
   */
  private async processBuyQueue(): Promise<void> {
    if (this.pendingBuys.size === 0) {
      return;
    }

    // Process one buy at a time
    for (const [tokenAddress, pendingBuy] of this.pendingBuys.entries()) {
      // Skip if already executing
      if (this.executingBuys.has(tokenAddress)) {
        continue;
      }

      // Check if buy has been queued too long (expire after 5 minutes)
      const queueAge = Date.now() - pendingBuy.queuedAt;
      if (queueAge > 5 * 60 * 1000) {
        logger.warn('Buy order expired (queued > 5 minutes)', {
          token: tokenAddress.slice(0, 8)
        });
        this.pendingBuys.delete(tokenAddress);
        continue;
      }

      // Execute buy
      this.executingBuys.add(tokenAddress);
      this.pendingBuys.delete(tokenAddress);

      // Execute asynchronously (don't await to allow other orders to process)
      this.executeBuyOrder(tokenAddress, pendingBuy).catch(error => {
        logger.error('Buy execution error', {
          token: tokenAddress.slice(0, 8),
          error: error.message
        });
        this.executingBuys.delete(tokenAddress);
      });

      // Process only one buy per cycle
      break;
    }
  }

  /**
   * Process pending sell orders
   */
  private async processSellQueue(): Promise<void> {
    if (this.pendingSells.size === 0) {
      return;
    }

    // Process one sell at a time (prioritize emergency sells)
    const sortedSells = Array.from(this.pendingSells.entries()).sort((a, b) => {
      // Emergency sells first
      const urgencyOrder = { emergency: 0, urgent: 1, normal: 2 };
      return urgencyOrder[a[1].order.urgency] - urgencyOrder[b[1].order.urgency];
    });

    for (const [tokenAddress, pendingSell] of sortedSells) {
      // Skip if already executing
      if (this.executingSells.has(tokenAddress)) {
        continue;
      }

      // Execute sell
      this.executingSells.add(tokenAddress);
      this.pendingSells.delete(tokenAddress);

      // Execute asynchronously
      this.executeSellOrder(tokenAddress, pendingSell).catch(error => {
        logger.error('Sell execution error', {
          token: tokenAddress.slice(0, 8),
          error: error.message
        });
        this.executingSells.delete(tokenAddress);
      });

      // Process only one sell per cycle
      break;
    }
  }

  /**
   * Execute a buy order
   */
  private async executeBuyOrder(tokenAddress: string, pendingBuy: PendingBuyOrder): Promise<void> {
    try {
      logger.info('⚡ Executing buy order', { token: tokenAddress.slice(0, 8) });

      const result = await this.buyExecutor.executeBuy(
        pendingBuy.decision,
        pendingBuy.signal
      );

      // Update metrics
      this.updateMetrics(result.success, result.attempts, result.executionLatencyMs || 0);

      // Log execution to database
      await this.logExecution('buy', result);

      // Update entry decision engine
      if (result.success) {
        this.entryDecision.setOpenPositions(this.entryDecision.getState().openPositions + 1);
      }

    } catch (error: any) {
      logger.error('Buy order execution failed', {
        token: tokenAddress.slice(0, 8),
        error: error.message
      });
    } finally {
      this.executingBuys.delete(tokenAddress);
    }
  }

  /**
   * Execute a sell order
   */
  private async executeSellOrder(tokenAddress: string, pendingSell: PendingSellOrder): Promise<void> {
    try {
      logger.info('⚡ Executing sell order', {
        token: tokenAddress.slice(0, 8),
        reason: pendingSell.order.reason,
        urgency: pendingSell.order.urgency
      });

      const result = await this.sellExecutor.executeSell(pendingSell.order);

      // Update metrics
      this.updateMetrics(result.success, result.attempts, result.executionLatencyMs || 0);

      // Log execution to database
      await this.logExecution('sell', result);

      // Update entry decision engine
      if (result.success) {
        // Determine if position was fully closed
        const wasFullSell = pendingSell.order.percentToSell >= 99;
        if (wasFullSell) {
          const currentOpen = this.entryDecision.getState().openPositions;
          this.entryDecision.setOpenPositions(Math.max(0, currentOpen - 1));
        }

        // Update after trade (for P&L tracking)
        if (result.exitPrice && pendingSell.order.position.entryPrice) {
          const pnlPercent = ((result.exitPrice - pendingSell.order.position.entryPrice) / pendingSell.order.position.entryPrice) * 100;
          const won = pnlPercent > 0;
          this.entryDecision.updateAfterTrade(won, pnlPercent);
        }
      }

    } catch (error: any) {
      logger.error('Sell order execution failed', {
        token: tokenAddress.slice(0, 8),
        error: error.message
      });
    } finally {
      this.executingSells.delete(tokenAddress);
    }
  }

  /**
   * Set pattern matcher for trade fingerprinting
   */
  setPatternMatcher(matcher: PatternMatcher): void {
    this.patternMatcher = matcher;
  }

  /**
   * Update execution metrics
   */
  private updateMetrics(success: boolean, attempts: number, latencyMs: number): void {
    this.metrics.totalExecutions++;
    this.metrics.totalRetries += Math.max(0, attempts - 1);
    this.metrics.totalLatencyMs += latencyMs;
    this.metrics.lastExecutionTime = Date.now();

    if (success) {
      this.metrics.successfulExecutions++;
    } else {
      this.metrics.failedExecutions++;
    }

    // Calculate average latency
    this.metrics.averageLatencyMs = Math.floor(
      this.metrics.totalLatencyMs / this.metrics.totalExecutions
    );

    // Track latency history (keep last 20)
    this.metrics.latencyHistory.push(latencyMs);
    if (this.metrics.latencyHistory.length > 20) {
      this.metrics.latencyHistory.shift();
    }

    // Latency monitoring
    this.monitorLatency(latencyMs);
  }

  /**
   * Monitor latency and alert/failover if needed
   */
  private monitorLatency(latencyMs: number): void {
    if (latencyMs > this.LATENCY_CRITICAL_MS) {
      this.metrics.consecutiveHighLatency++;

      logger.error('🚨 CRITICAL: Execution latency exceeded 1000ms', {
        latencyMs,
        consecutive: this.metrics.consecutiveHighLatency,
        avgLatency: this.metrics.averageLatencyMs
      });

      // Trigger RPC failover if consistently slow
      if (this.metrics.consecutiveHighLatency >= this.HIGH_LATENCY_THRESHOLD) {
        logger.error('🔄 Recommending RPC failover due to persistent high latency', {
          consecutiveHighLatency: this.metrics.consecutiveHighLatency,
          recentLatencies: this.metrics.latencyHistory.slice(-5)
        });
        // Note: Actual failover is handled by the RPC configuration module
      }

    } else if (latencyMs > this.LATENCY_WARNING_MS) {
      logger.warn('⚠️ Execution latency exceeded 500ms', {
        latencyMs,
        target: '< 500ms'
      });
      // Don't reset consecutive counter for warnings

    } else {
      // Reset consecutive high latency counter on good latency
      if (this.metrics.consecutiveHighLatency > 0) {
        logger.info('✅ Latency normalized', {
          latencyMs,
          previousConsecutiveHigh: this.metrics.consecutiveHighLatency
        });
      }
      this.metrics.consecutiveHighLatency = 0;
    }
  }

  /**
   * Log execution to database
   */
  private async logExecution(type: 'buy' | 'sell', result: BuyExecutionResult | SellExecutionResult): Promise<void> {
    try {
      if (type === 'buy') {
        const buyResult = result as BuyExecutionResult;

        // Create trade entry for buy
        await query(
          `INSERT INTO trades (
            id, token_address, entry_price, entry_amount, entry_time,
            conviction_score, fingerprint, created_at
          ) VALUES (
            gen_random_uuid(), $1, $2, $3, NOW(),
            $4, $5, NOW()
          )
          ON CONFLICT DO NOTHING`,
          [
            buyResult.tokenAddress,
            buyResult.entryPrice || 0,
            buyResult.amountSOL || 0,
            0, // Conviction score will be filled from decision
            JSON.stringify({
              txSignature: buyResult.txSignature,
              tokensReceived: buyResult.tokensReceived,
              slippage: buyResult.slippage,
              priorityFee: buyResult.priorityFee,
              executionLatencyMs: buyResult.executionLatencyMs,
              attempts: buyResult.attempts
            })
          ]
        );

        logger.debug('Buy execution logged to database', {
          token: buyResult.tokenAddress.slice(0, 8),
          success: buyResult.success,
          latencyMs: buyResult.executionLatencyMs
        });

      } else {
        const sellResult = result as SellExecutionResult;

        // Calculate P&L from exit price (solReceived is what we got back)
        const solReceived = sellResult.solReceived || 0;
        const exitPrice = sellResult.exitPrice || 0;

        // Update existing trade with exit data
        await query(
          `UPDATE trades SET
            exit_price = $1,
            exit_amount = $2,
            exit_time = NOW(),
            profit_loss = COALESCE($2, 0) - COALESCE(entry_amount, 0),
            profit_loss_percent = CASE
              WHEN COALESCE(entry_amount, 0) > 0
              THEN ((COALESCE($2, 0) - COALESCE(entry_amount, 0)) / entry_amount) * 100
              ELSE 0
            END,
            outcome = CASE
              WHEN COALESCE($2, 0) > COALESCE(entry_amount, 0) THEN 'WIN'
              ELSE 'LOSS'
            END,
            exit_reason = $3,
            fingerprint = fingerprint || $4,
            updated_at = NOW()
          WHERE token_address = $5
          AND exit_time IS NULL`,
          [
            exitPrice,
            solReceived,
            sellResult.reason || 'unknown',
            JSON.stringify({
              sellTxSignature: sellResult.txSignature,
              tokensSold: sellResult.tokensSold,
              executionLatencyMs: sellResult.executionLatencyMs,
              attempts: sellResult.attempts
            }),
            sellResult.tokenAddress
          ]
        );

        logger.debug('Sell execution logged to database', {
          token: sellResult.tokenAddress.slice(0, 8),
          success: sellResult.success,
          solReceived,
          latencyMs: sellResult.executionLatencyMs
        });

        // Trigger learning engine update if pattern matcher is available
        if (this.patternMatcher && sellResult.success && solReceived > 0) {
          try {
            // Get the trade for fingerprinting
            const tradeResult = await query<any>(
              `SELECT * FROM trades WHERE token_address = $1 ORDER BY created_at DESC LIMIT 1`,
              [sellResult.tokenAddress]
            );

            if (tradeResult.rows.length > 0) {
              const trade = tradeResult.rows[0];
              const fingerprint = await this.patternMatcher.createFingerprint(trade);
              await this.patternMatcher.storeTradePattern(trade, fingerprint);

              logger.debug('Trade fingerprint stored for learning', {
                token: sellResult.tokenAddress.slice(0, 8)
              });
            }
          } catch (learnError: any) {
            logger.debug('Error storing trade pattern', { error: learnError.message });
          }
        }
      }

    } catch (error: any) {
      logger.error('Failed to log execution to database', {
        type,
        token: result.tokenAddress.slice(0, 8),
        error: error.message
      });
    }
  }

  /**
   * Get latency statistics
   */
  getLatencyStats() {
    const history = this.metrics.latencyHistory;
    if (history.length === 0) {
      return { min: 0, max: 0, avg: 0, p50: 0, p95: 0 };
    }

    const sorted = [...history].sort((a, b) => a - b);
    const p50Index = Math.floor(sorted.length * 0.5);
    const p95Index = Math.floor(sorted.length * 0.95);

    return {
      min: sorted[0],
      max: sorted[sorted.length - 1],
      avg: this.metrics.averageLatencyMs,
      p50: sorted[p50Index],
      p95: sorted[Math.min(p95Index, sorted.length - 1)],
      recentHistory: history.slice(-10),
      consecutiveHighLatency: this.metrics.consecutiveHighLatency
    };
  }

  /**
   * Get execution manager stats
   */
  getStats() {
    const successRate = this.metrics.totalExecutions > 0
      ? (this.metrics.successfulExecutions / this.metrics.totalExecutions) * 100
      : 0;

    return {
      pendingBuys: this.pendingBuys.size,
      pendingSells: this.pendingSells.size,
      executingBuys: this.executingBuys.size,
      executingSells: this.executingSells.size,
      totalExecutions: this.metrics.totalExecutions,
      successfulExecutions: this.metrics.successfulExecutions,
      failedExecutions: this.metrics.failedExecutions,
      successRate,
      averageLatencyMs: this.metrics.averageLatencyMs,
      totalRetries: this.metrics.totalRetries,
      lastExecutionTime: this.metrics.lastExecutionTime,
      isRunning: this.isRunning
    };
  }

  /**
   * Clear all queues (emergency use only)
   */
  clearAllQueues(): void {
    logger.warn('🚨 Clearing all execution queues');
    this.pendingBuys.clear();
    this.pendingSells.clear();
  }

  /**
   * Get queue status
   */
  getQueueStatus() {
    return {
      pendingBuys: Array.from(this.pendingBuys.keys()).map(addr => ({
        token: addr.slice(0, 8),
        queuedAt: this.pendingBuys.get(addr)?.queuedAt
      })),
      pendingSells: Array.from(this.pendingSells.keys()).map(addr => ({
        token: addr.slice(0, 8),
        reason: this.pendingSells.get(addr)?.order.reason,
        urgency: this.pendingSells.get(addr)?.order.urgency,
        queuedAt: this.pendingSells.get(addr)?.queuedAt
      }))
    };
  }
}
