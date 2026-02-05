/**
 * Position Manager
 *
 * Central coordinator for all position management:
 * - Creates positions when trades execute
 * - Monitors all positions every 10 seconds
 * - Checks stop-losses, take-profits, danger signals
 * - Queues sell orders via Execution Manager
 * - Updates position status
 * - Calculates portfolio P&L
 * - Feeds completed trades to Learning Engine
 */

import { Connection } from '@solana/web3.js';
import { logger } from '../utils/logger';
import { PositionTracker, PositionData } from './position-tracker';
import { StopLossManager } from './stop-loss-manager';
import { TakeProfitManager } from './take-profit-manager';
import { DangerMonitor } from './danger-monitor';
import { PriceFeed } from '../market/price-feed';
import { WalletManager } from '../discovery/wallet-manager';
import { ExecutionManager } from '../execution/execution-manager';
import { LearningScheduler } from '../learning/learning-scheduler';
import { BuyExecutionResult } from '../execution/buy-executor';
import { Position } from '../types';

export class PositionManager {
  private connection: Connection;
  private positionTracker: PositionTracker;
  private stopLossManager: StopLossManager;
  private takeProfitManager: TakeProfitManager;
  private dangerMonitor: DangerMonitor;
  private priceFeed: PriceFeed;
  private walletManager: WalletManager;
  private executionManager: ExecutionManager;
  private learningScheduler: LearningScheduler;

  private isRunning: boolean = false;
  private monitoringInterval: NodeJS.Timeout | null = null;
  private readonly MONITORING_INTERVAL_MS = 10000; // 10 seconds

  // Portfolio metrics
  private totalPnL: number = 0;
  private totalTrades: number = 0;
  private winningTrades: number = 0;
  private losingTrades: number = 0;
  private totalWinAmount: number = 0;
  private totalLossAmount: number = 0;

  constructor(
    connection: Connection,
    executionManager: ExecutionManager,
    priceFeed: PriceFeed,
    walletManager: WalletManager,
    learningScheduler: LearningScheduler
  ) {
    this.connection = connection;
    this.executionManager = executionManager;
    this.priceFeed = priceFeed;
    this.walletManager = walletManager;
    this.learningScheduler = learningScheduler;

    // Initialize sub-managers
    this.positionTracker = new PositionTracker();
    this.stopLossManager = new StopLossManager();
    this.takeProfitManager = new TakeProfitManager();
    this.dangerMonitor = new DangerMonitor(connection, walletManager, priceFeed);

    logger.info('Position Manager initialized');
  }

  /**
   * Start position monitoring loop
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Position Manager already running');
      return;
    }

    this.isRunning = true;

    // Load existing open positions from database
    await this.positionTracker.loadOpenPositions();

    // Start monitoring all positions
    const positions = this.positionTracker.getAllPositions();
    for (const position of positions) {
      // Add token to price feed monitoring
      this.priceFeed.addToken(position.tokenAddress);

      // Start danger monitoring (with placeholder values)
      await this.dangerMonitor.startMonitoring(position, 50000, 100);
    }

    // Start monitoring loop
    this.monitoringInterval = setInterval(() => {
      this.monitorAllPositions().catch(error => {
        logger.error('Error in position monitoring loop', { error: error.message });
      });
    }, this.MONITORING_INTERVAL_MS);

    logger.info('✅ Position Manager started (monitoring every 10s)');
  }

  /**
   * Stop position monitoring
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;

    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }

    logger.info('Position Manager stopped');
  }

  /**
   * Handle trade execution result (called by Execution Manager)
   */
  async onTradeExecuted(result: BuyExecutionResult): Promise<void> {
    try {
      if (!result.success) {
        return;
      }

      // Create position
      const position = await this.positionTracker.createPosition({
        tokenAddress: result.tokenAddress,
        tokenName: undefined, // Not included in BuyExecutionResult
        tokenSymbol: undefined, // Not included in BuyExecutionResult
        entryPrice: result.entryPrice || 0,
        entryAmount: result.tokensReceived || 0,
        entryConviction: 85, // Placeholder - should come from decision
        smartWallets: [] // Placeholder - should come from signal
      });

      // Add token to price feed monitoring
      this.priceFeed.addToken(result.tokenAddress);

      // Start danger monitoring
      await this.dangerMonitor.startMonitoring(position, 50000, 100);

      logger.info('📊 Position created and monitoring started', {
        token: result.tokenAddress.slice(0, 8),
        entryPrice: result.entryPrice
      });

    } catch (error: any) {
      logger.error('Failed to process trade execution', {
        token: result.tokenAddress.slice(0, 8),
        error: error.message
      });
    }
  }

  /**
   * Monitor all open positions
   */
  private async monitorAllPositions(): Promise<void> {
    const positions = this.positionTracker.getAllPositions();

    if (positions.length === 0) {
      return;
    }

    logger.debug(`Monitoring ${positions.length} positions...`);

    // Monitor each position in parallel
    await Promise.allSettled(
      positions.map(position => this.monitorPosition(position))
    );
  }

  /**
   * Monitor a single position
   */
  private async monitorPosition(position: PositionData): Promise<void> {
    try {
      // Step 1: Update current price
      const priceData = await this.priceFeed.getPrice(position.tokenAddress);
      if (!priceData) {
        logger.warn('No price data available', { token: position.tokenAddress.slice(0, 8) });
        return;
      }

      await this.positionTracker.updatePrice(position.tokenAddress, priceData.priceUSD);

      // Get updated position
      const updatedPosition = this.positionTracker.getPosition(position.tokenAddress);
      if (!updatedPosition) {
        return;
      }

      // Step 2: Check danger signals (highest priority)
      const dangerSignal = await this.dangerMonitor.checkDangerSignals(updatedPosition);
      if (dangerSignal.isDangerous && dangerSignal.recommendation === 'exit_immediately') {
        await this.executeEmergencyExit(updatedPosition, dangerSignal.reason || 'Danger signal detected');
        return;
      }

      // Step 3: Check stop-losses
      const stopLossCheck = this.stopLossManager.checkStopLoss(updatedPosition);
      if (stopLossCheck.shouldExit) {
        await this.executeStopLoss(updatedPosition, stopLossCheck);
        return;
      }

      // Step 4: Check take-profits
      const takeProfitCheck = this.takeProfitManager.checkTakeProfit(updatedPosition);
      if (takeProfitCheck.shouldSell && takeProfitCheck.amountToSell) {
        await this.executeTakeProfit(updatedPosition, takeProfitCheck);
        return;
      }

      // Log position status periodically (every 5 cycles = 50 seconds)
      if (Date.now() % 50000 < this.MONITORING_INTERVAL_MS) {
        this.logPositionStatus(updatedPosition);
      }

    } catch (error: any) {
      logger.error('Error monitoring position', {
        token: position.tokenAddress.slice(0, 8),
        error: error.message
      });
    }
  }

  /**
   * Execute emergency exit
   */
  private async executeEmergencyExit(position: PositionData, reason: string): Promise<void> {
    try {
      logger.error('🚨 EMERGENCY EXIT triggered', {
        token: position.tokenAddress.slice(0, 8),
        symbol: position.tokenSymbol,
        reason,
        pnl: position.pnlPercent.toFixed(2) + '%'
      });

      // Queue emergency sell order (100% of position)
      await this.executionManager.queueSellOrder({
        position: this.convertToPosition(position),
        percentToSell: 100,
        reason: 'danger_signal',
        urgency: 'emergency'
      });

      // Close position
      await this.positionTracker.closePosition(
        position.tokenAddress,
        `Emergency exit: ${reason}`,
        position.currentPrice || 0
      );

      // Stop monitoring
      this.dangerMonitor.stopMonitoring(position.tokenAddress);
      this.priceFeed.removeToken(position.tokenAddress);

      // Update metrics
      this.updateMetricsAfterTrade(position, 'EMERGENCY');

    } catch (error: any) {
      logger.error('Failed to execute emergency exit', {
        token: position.tokenAddress.slice(0, 8),
        error: error.message
      });
    }
  }

  /**
   * Execute stop-loss
   */
  private async executeStopLoss(position: PositionData, stopCheck: any): Promise<void> {
    try {
      logger.warn('🛑 Stop-loss triggered', {
        token: position.tokenAddress.slice(0, 8),
        symbol: position.tokenSymbol,
        type: stopCheck.stopType,
        reason: stopCheck.reason,
        pnl: position.pnlPercent.toFixed(2) + '%'
      });

      // Queue sell order
      await this.executionManager.queueSellOrder({
        position: this.convertToPosition(position),
        percentToSell: 100,
        reason: stopCheck.reason,
        urgency: stopCheck.urgency
      });

      // Close position
      await this.positionTracker.closePosition(
        position.tokenAddress,
        stopCheck.reason,
        position.currentPrice || 0
      );

      // Stop monitoring
      this.dangerMonitor.stopMonitoring(position.tokenAddress);
      this.priceFeed.removeToken(position.tokenAddress);

      // Update metrics
      const outcome = position.pnlPercent > 0 ? 'WIN' : 'LOSS';
      this.updateMetricsAfterTrade(position, outcome);

    } catch (error: any) {
      logger.error('Failed to execute stop-loss', {
        token: position.tokenAddress.slice(0, 8),
        error: error.message
      });
    }
  }

  /**
   * Execute take-profit
   */
  private async executeTakeProfit(position: PositionData, tpCheck: any): Promise<void> {
    try {
      logger.info('🎯 Take-profit triggered', {
        token: position.tokenAddress.slice(0, 8),
        symbol: position.tokenSymbol,
        level: tpCheck.level?.label,
        reason: tpCheck.reason,
        pnl: position.pnlPercent.toFixed(2) + '%',
        sellPercent: tpCheck.level?.sellPercent
      });

      // Calculate percent to sell (based on remaining amount)
      const percentOfRemaining = (tpCheck.amountToSell / position.remainingAmount) * 100;

      // Queue sell order
      await this.executionManager.queueSellOrder({
        position: this.convertToPosition(position),
        percentToSell: Math.min(percentOfRemaining, 100),
        reason: tpCheck.reason,
        urgency: 'normal'
      });

      // Mark take-profit level as hit
      if (tpCheck.level) {
        await this.positionTracker.markTakeProfitHit(
          position.tokenAddress,
          tpCheck.level.targetPercent
        );
      }

      // Reduce position amount
      await this.positionTracker.reducePosition(position.tokenAddress, tpCheck.amountToSell);

      // Check if position is fully closed
      const updatedPosition = this.positionTracker.getPosition(position.tokenAddress);
      if (updatedPosition && updatedPosition.remainingAmount < 0.000001) {
        await this.positionTracker.closePosition(
          position.tokenAddress,
          'All take-profits executed',
          position.currentPrice || 0
        );

        this.dangerMonitor.stopMonitoring(position.tokenAddress);
        this.priceFeed.removeToken(position.tokenAddress);

        this.updateMetricsAfterTrade(position, 'WIN');
      }

    } catch (error: any) {
      logger.error('Failed to execute take-profit', {
        token: position.tokenAddress.slice(0, 8),
        error: error.message
      });
    }
  }

  /**
   * Convert PositionData to Position type (for Execution Manager)
   */
  private convertToPosition(data: PositionData): Position {
    return {
      tokenAddress: data.tokenAddress,
      entryPrice: data.entryPrice,
      currentPrice: data.currentPrice || data.entryPrice,
      amount: data.remainingAmount,
      entryTime: data.entryTime,
      profitLoss: data.pnlUsd,
      profitLossPercent: data.pnlPercent,
      stops: {
        hard: data.stopLossPrice,
        trailing: data.trailingStopActive ? data.stopLossPrice : undefined
      },
      takeProfitLevels: [
        { targetPercent: 30, sellPercent: 20, executed: data.takeProfitLevels.tp30 },
        { targetPercent: 60, sellPercent: 25, executed: data.takeProfitLevels.tp60 },
        { targetPercent: 100, sellPercent: 25, executed: data.takeProfitLevels.tp100 },
        { targetPercent: 200, sellPercent: 15, executed: data.takeProfitLevels.tp200 }
      ],
      smartWalletsInPosition: data.smartWalletsInPosition
    };
  }

  /**
   * Update metrics after trade completion
   */
  private updateMetricsAfterTrade(position: PositionData, outcome: string): void {
    this.totalTrades++;

    if (outcome === 'WIN') {
      this.winningTrades++;
      this.totalWinAmount += Math.abs(position.pnlPercent);
    } else if (outcome === 'LOSS') {
      this.losingTrades++;
      this.totalLossAmount += Math.abs(position.pnlPercent);
    }

    this.totalPnL += position.pnlPercent;

    // Feed to Learning Engine (STUB - will implement when Learning Engine is ready)
    // this.learningScheduler.recordTrade({ ... });
  }

  /**
   * Log position status
   */
  private logPositionStatus(position: PositionData): void {
    const stopInfo = this.stopLossManager.formatStopInfo(position);
    const tpInfo = this.takeProfitManager.formatTakeProfitInfo(position);

    logger.info('📊 Position Status', {
      token: position.tokenAddress.slice(0, 8),
      symbol: position.tokenSymbol,
      pnl: position.pnlPercent.toFixed(2) + '%',
      entryPrice: position.entryPrice.toFixed(8),
      currentPrice: position.currentPrice?.toFixed(8),
      stop: stopInfo,
      takeProfit: tpInfo
    });
  }

  /**
   * Get position manager stats
   */
  getStats() {
    const openPositions = this.positionTracker.getPositionCount();
    const winRate = this.totalTrades > 0 ? (this.winningTrades / this.totalTrades) * 100 : 0;
    const avgWinner = this.winningTrades > 0 ? this.totalWinAmount / this.winningTrades : 0;
    const avgLoser = this.losingTrades > 0 ? this.totalLossAmount / this.losingTrades : 0;

    return {
      openPositions,
      totalPnL: this.totalPnL,
      totalTrades: this.totalTrades,
      winRate,
      avgWinner,
      avgLoser,
      isRunning: this.isRunning
    };
  }

  /**
   * Get all open positions
   */
  getOpenPositions(): PositionData[] {
    return this.positionTracker.getAllPositions();
  }

  /**
   * Get position by token address
   */
  getPosition(tokenAddress: string): PositionData | undefined {
    return this.positionTracker.getPosition(tokenAddress);
  }
}
