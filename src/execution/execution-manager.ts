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
    lastExecutionTime: 0
  };

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
  }

  /**
   * Log execution to database
   */
  private async logExecution(type: 'buy' | 'sell', result: BuyExecutionResult | SellExecutionResult): Promise<void> {
    try {
      // STUB: In production, log to trades table
      logger.debug('Execution logged (STUB)', {
        type,
        success: result.success,
        token: result.tokenAddress.slice(0, 8)
      });

    } catch (error: any) {
      logger.error('Failed to log execution', { error: error.message });
    }
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
