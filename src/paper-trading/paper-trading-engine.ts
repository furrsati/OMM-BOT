/**
 * Paper Trading Engine
 *
 * Simulates trading without real execution:
 * - Creates paper positions when signals are approved
 * - Monitors positions and simulates exits
 * - Tracks P&L and performance metrics
 * - Stores everything in paper_trades and paper_positions tables
 */

import { Connection } from '@solana/web3.js';
import { logger } from '../utils/logger';
import { query } from '../db/postgres';
import { PriceFeed } from '../market/price-feed';
import { AggregatedSignal } from '../conviction/signal-aggregator';
import { EntryDecision } from '../conviction/entry-decision';
import { LearningScheduler } from '../learning/learning-scheduler';
import { Trade, TradeFingerprint } from '../types';

export interface PaperPosition {
  id: number;
  paperTradeId: number;
  tokenAddress: string;
  tokenName: string;
  tokenSymbol: string;
  entryPrice: number;
  entryAmountSol: number;
  entryAmountTokens: number;
  remainingAmountTokens: number;
  entryTime: Date;
  currentPrice: number;
  highestPrice: number;
  lowestPrice: number;
  unrealizedPnlSol: number;
  unrealizedPnlPercent: number;
  unrealizedPnlUsd: number;
  stopLossPrice: number;
  stopLossPercent: number;
  trailingStopActive: boolean;
  trailingStopPrice: number | null;
  trailingStopPercent: number | null;
  takeProfitHits: {
    tp1: boolean;
    tp2: boolean;
    tp3: boolean;
    tp4: boolean;
  };
  realizedPnlSol: number;
  realizedPnlUsd: number;
  status: 'ACTIVE' | 'CLOSED';
  smartWalletsHolding: string[];
  smartWalletsExited: string[];
  dangerSignals: any[];
}

export interface PaperWallet {
  id: number;
  initialBalanceSol: number;
  currentBalanceSol: number;
  reservedBalanceSol: number;
  availableBalanceSol: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  breakevenTrades: number;
  totalPnlSol: number;
  totalPnlPercent: number;
  winRate: number;
  profitFactor: number;
  currentStreak: number;
  longestWinStreak: number;
  longestLossStreak: number;
  dailyPnlSol: number;
  dailyPnlPercent: number;
  dailyTrades: number;
  isActive: boolean;
  isPaused: boolean;
  pauseReason: string | null;
}

export interface PaperTradeEvent {
  id: number;
  paperTradeId: number;
  paperPositionId: number | null;
  eventType: string;
  eventData: any;
  priceAtEvent: number;
  pnlAtEvent: number;
  message: string;
  severity: 'INFO' | 'WARNING' | 'SUCCESS' | 'DANGER';
  createdAt: Date;
}

export class PaperTradingEngine {
  private connection: Connection;
  private priceFeed: PriceFeed;
  private learningScheduler: LearningScheduler | null = null;
  private isRunning: boolean = false;
  private monitoringInterval: NodeJS.Timeout | null = null;
  private readonly MONITORING_INTERVAL_MS = 10000; // 10 seconds

  // Take profit levels (from CLAUDE.md)
  private readonly TP_LEVELS = {
    TP1: { percent: 30, sellPercent: 20 },
    TP2: { percent: 60, sellPercent: 25 },
    TP3: { percent: 100, sellPercent: 25 },
    TP4: { percent: 200, sellPercent: 15 }
  };

  // Stop loss default
  private readonly DEFAULT_STOP_LOSS_PERCENT = 25;
  private readonly EARLY_DISCOVERY_STOP_LOSS_PERCENT = 15;

  // Trailing stop activation and distances
  private readonly TRAILING_STOP_ACTIVATION = 20; // Activate at +20%
  private readonly TRAILING_DISTANCES = {
    tier1: { minGain: 20, maxGain: 50, trailPercent: 15 },
    tier2: { minGain: 50, maxGain: 100, trailPercent: 12 },
    tier3: { minGain: 100, maxGain: Infinity, trailPercent: 10 }
  };

  constructor(connection: Connection, priceFeed: PriceFeed) {
    this.connection = connection;
    this.priceFeed = priceFeed;
    logger.info('Paper Trading Engine initialized');
  }

  /**
   * Set learning scheduler for feeding completed trades
   */
  setLearningScheduler(scheduler: LearningScheduler): void {
    this.learningScheduler = scheduler;
    logger.info('Learning scheduler connected to Paper Trading Engine');
  }

  /**
   * Start paper trading monitoring
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Paper Trading Engine already running');
      return;
    }

    this.isRunning = true;

    // Ensure paper wallet exists
    await this.ensurePaperWallet();

    // Start monitoring loop
    this.monitoringInterval = setInterval(() => {
      this.monitorAllPositions().catch(error => {
        logger.error('Error in paper trading monitoring', { error: error.message });
      });
    }, this.MONITORING_INTERVAL_MS);

    logger.info('✅ Paper Trading Engine started');
  }

  /**
   * Stop paper trading monitoring
   */
  stop(): void {
    if (!this.isRunning) return;

    this.isRunning = false;
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }

    logger.info('Paper Trading Engine stopped');
  }

  /**
   * Execute a paper trade (called when signal is approved)
   */
  async executePaperTrade(
    decision: EntryDecision,
    signal: AggregatedSignal
  ): Promise<{ success: boolean; tradeId?: number; message: string }> {
    try {
      // Get paper wallet
      const wallet = await this.getPaperWallet();
      if (!wallet) {
        return { success: false, message: 'Paper wallet not initialized' };
      }

      // Check if paused
      if (wallet.isPaused) {
        return { success: false, message: `Paper trading paused: ${wallet.pauseReason}` };
      }

      // Check daily limits
      if (wallet.dailyPnlPercent <= -8) {
        await this.pauseTrading('Daily loss limit reached (-8%)');
        return { success: false, message: 'Daily loss limit reached' };
      }

      // Check max open positions
      const openPositions = await this.getOpenPositions();
      if (openPositions.length >= 5) {
        return { success: false, message: 'Max open positions (5) reached' };
      }

      // Check if already in this token
      const existingPosition = openPositions.find(p => p.tokenAddress === signal.tokenAddress);
      if (existingPosition) {
        return { success: false, message: 'Already have position in this token' };
      }

      // Calculate position size in SOL
      const positionSizePercent = decision.positionSizePercent;
      const positionSizeSol = wallet.availableBalanceSol * (positionSizePercent / 100);

      if (positionSizeSol < 0.01) {
        return { success: false, message: 'Insufficient balance for trade' };
      }

      // Get current price
      const priceData = await this.priceFeed.getPrice(signal.tokenAddress);
      if (!priceData || !priceData.priceUSD) {
        return { success: false, message: 'Could not get token price' };
      }

      // Get SOL price for USD conversion
      const solPrice = await this.getSolPrice();

      // Calculate tokens received (simulated)
      const entryPriceUsd = priceData.priceUSD;
      const positionValueUsd = positionSizeSol * solPrice;
      const tokensReceived = positionValueUsd / entryPriceUsd;

      // Determine stop loss based on entry type
      const isEarlyDiscovery = decision.reason?.includes('EARLY') || false;
      const stopLossPercent = isEarlyDiscovery
        ? this.EARLY_DISCOVERY_STOP_LOSS_PERCENT
        : this.DEFAULT_STOP_LOSS_PERCENT;
      const stopLossPrice = entryPriceUsd * (1 - stopLossPercent / 100);

      // Create paper trade record
      const tradeResult = await query<{ id: number }>(`
        INSERT INTO paper_trades (
          token_address, token_name, token_symbol,
          entry_price, entry_amount_sol, entry_amount_tokens, entry_time,
          entry_conviction_score, entry_signal,
          position_size_percent, conviction_level, entry_type,
          smart_wallets_triggered, tier1_count, tier2_count, tier3_count,
          fingerprint, status
        ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, 'OPEN')
        RETURNING id
      `, [
        signal.tokenAddress,
        signal.tokenName,
        signal.tokenSymbol,
        entryPriceUsd,
        positionSizeSol,
        tokensReceived,
        decision.convictionScore,
        JSON.stringify(signal),
        positionSizePercent,
        decision.convictionScore >= 85 ? 'HIGH' : decision.convictionScore >= 70 ? 'MEDIUM' : 'LOW',
        isEarlyDiscovery ? 'EARLY_DISCOVERY' : 'STANDARD',
        [],
        signal.smartWallet?.tier1Count || 0,
        signal.smartWallet?.tier2Count || 0,
        signal.smartWallet?.tier3Count || 0,
        JSON.stringify(this.createFingerprint(signal, decision))
      ]);

      const tradeId = tradeResult.rows[0].id;

      // Create paper position
      await query(`
        INSERT INTO paper_positions (
          paper_trade_id, token_address, token_name, token_symbol,
          entry_price, entry_amount_sol, entry_amount_tokens, remaining_amount_tokens,
          current_price, highest_price, lowest_price,
          stop_loss_price, stop_loss_percent,
          smart_wallets_holding, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'ACTIVE')
      `, [
        tradeId,
        signal.tokenAddress,
        signal.tokenName,
        signal.tokenSymbol,
        entryPriceUsd,
        positionSizeSol,
        tokensReceived,
        tokensReceived,
        entryPriceUsd,
        entryPriceUsd,
        entryPriceUsd,
        stopLossPrice,
        stopLossPercent,
        []
      ]);

      // Update paper wallet balance
      await query(`
        UPDATE paper_wallet SET
          reserved_balance_sol = reserved_balance_sol + $1,
          available_balance_sol = available_balance_sol - $1,
          total_trades = total_trades + 1,
          daily_trades = daily_trades + 1,
          last_trade_at = NOW(),
          updated_at = NOW()
        WHERE id = 1
      `, [positionSizeSol]);

      // Log event
      await this.logEvent(tradeId, null, 'ENTRY', {
        price: entryPriceUsd,
        amountSol: positionSizeSol,
        tokens: tokensReceived,
        conviction: decision.convictionScore,
        stopLoss: stopLossPercent
      }, entryPriceUsd, 0,
        `📈 PAPER BUY: ${signal.tokenSymbol} @ $${entryPriceUsd.toFixed(8)} | ${positionSizeSol.toFixed(4)} SOL | Conviction: ${decision.convictionScore.toFixed(1)}`,
        'SUCCESS'
      );

      // Add to price feed monitoring
      this.priceFeed.addToken(signal.tokenAddress);

      logger.info(`📝 Paper trade executed: ${signal.tokenSymbol}`, {
        tradeId,
        price: entryPriceUsd,
        amountSol: positionSizeSol,
        conviction: decision.convictionScore
      });

      return { success: true, tradeId, message: 'Paper trade executed successfully' };

    } catch (error: any) {
      logger.error('Failed to execute paper trade', { error: error.message });
      return { success: false, message: error.message };
    }
  }

  /**
   * Monitor all open paper positions
   */
  private async monitorAllPositions(): Promise<void> {
    try {
      const positions = await this.getOpenPositions();

      if (positions.length === 0) {
        return;
      }

      logger.debug(`Monitoring ${positions.length} paper positions...`);

      for (const position of positions) {
        await this.monitorPosition(position);
      }

    } catch (error: any) {
      logger.error('Error monitoring paper positions', { error: error.message });
    }
  }

  /**
   * Monitor a single paper position
   */
  private async monitorPosition(position: PaperPosition): Promise<void> {
    try {
      // Get current price
      const priceData = await this.priceFeed.getPrice(position.tokenAddress);
      if (!priceData || !priceData.priceUSD) {
        return;
      }

      const currentPrice = priceData.priceUSD;
      const pnlPercent = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;

      // Update highest/lowest price
      const newHighest = Math.max(position.highestPrice, currentPrice);
      const newLowest = Math.min(position.lowestPrice, currentPrice);

      // Calculate unrealized P&L
      const solPrice = await this.getSolPrice();
      const currentValueUsd = position.remainingAmountTokens * currentPrice;
      const entryValueUsd = position.remainingAmountTokens * position.entryPrice;
      const unrealizedPnlUsd = currentValueUsd - entryValueUsd;
      const unrealizedPnlSol = unrealizedPnlUsd / solPrice;

      // Update position in database
      await query(`
        UPDATE paper_positions SET
          current_price = $2,
          highest_price = $3,
          lowest_price = $4,
          unrealized_pnl_sol = $5,
          unrealized_pnl_percent = $6,
          unrealized_pnl_usd = $7,
          last_price_update = NOW(),
          updated_at = NOW()
        WHERE id = $1
      `, [
        position.id,
        currentPrice,
        newHighest,
        newLowest,
        unrealizedPnlSol,
        pnlPercent,
        unrealizedPnlUsd
      ]);

      // Check trailing stop activation
      if (!position.trailingStopActive && pnlPercent >= this.TRAILING_STOP_ACTIVATION) {
        await this.activateTrailingStop(position, currentPrice, pnlPercent);
      }

      // Update trailing stop price if active
      if (position.trailingStopActive && currentPrice > position.highestPrice) {
        await this.updateTrailingStop(position, currentPrice, pnlPercent);
      }

      // Check stop loss (hard or trailing)
      const effectiveStopPrice = position.trailingStopActive && position.trailingStopPrice
        ? position.trailingStopPrice
        : position.stopLossPrice;

      if (currentPrice <= effectiveStopPrice) {
        const exitReason = position.trailingStopActive ? 'TRAILING_STOP' : 'STOP_LOSS';
        await this.closePosition(position, currentPrice, exitReason);
        return;
      }

      // Check take profit levels
      await this.checkTakeProfitLevels(position, currentPrice, pnlPercent);

    } catch (error: any) {
      logger.error('Error monitoring paper position', {
        token: position.tokenAddress.slice(0, 8),
        error: error.message
      });
    }
  }

  /**
   * Activate trailing stop for a position
   */
  private async activateTrailingStop(
    position: PaperPosition,
    currentPrice: number,
    pnlPercent: number
  ): Promise<void> {
    // Determine trailing distance based on gain
    let trailPercent = 15;
    if (pnlPercent >= 100) {
      trailPercent = 10;
    } else if (pnlPercent >= 50) {
      trailPercent = 12;
    }

    const trailingStopPrice = currentPrice * (1 - trailPercent / 100);

    await query(`
      UPDATE paper_positions SET
        trailing_stop_active = TRUE,
        trailing_stop_price = $2,
        trailing_stop_percent = $3,
        updated_at = NOW()
      WHERE id = $1
    `, [position.id, trailingStopPrice, trailPercent]);

    await this.logEvent(
      position.paperTradeId,
      position.id,
      'TRAILING_ACTIVATED',
      { pnlPercent, trailPercent, trailingStopPrice },
      currentPrice,
      pnlPercent,
      `🔔 Trailing stop activated for ${position.tokenSymbol} at ${trailPercent}% (${pnlPercent.toFixed(1)}% gain)`,
      'INFO'
    );

    logger.info(`Trailing stop activated for ${position.tokenSymbol}`, {
      pnlPercent: pnlPercent.toFixed(1),
      trailPercent,
      trailingStopPrice
    });
  }

  /**
   * Update trailing stop price
   */
  private async updateTrailingStop(
    position: PaperPosition,
    currentPrice: number,
    pnlPercent: number
  ): Promise<void> {
    // Adjust trail percent based on current gain
    let trailPercent = position.trailingStopPercent || 15;
    if (pnlPercent >= 100 && trailPercent > 10) {
      trailPercent = 10;
    } else if (pnlPercent >= 50 && trailPercent > 12) {
      trailPercent = 12;
    }

    const newTrailingStopPrice = currentPrice * (1 - trailPercent / 100);

    await query(`
      UPDATE paper_positions SET
        trailing_stop_price = $2,
        trailing_stop_percent = $3,
        updated_at = NOW()
      WHERE id = $1
    `, [position.id, newTrailingStopPrice, trailPercent]);
  }

  /**
   * Check and execute take profit levels
   */
  private async checkTakeProfitLevels(
    position: PaperPosition,
    currentPrice: number,
    pnlPercent: number
  ): Promise<void> {
    // TP1: +30% - Sell 20%
    if (!position.takeProfitHits.tp1 && pnlPercent >= this.TP_LEVELS.TP1.percent) {
      await this.executeTakeProfit(position, currentPrice, 1, this.TP_LEVELS.TP1.sellPercent);
    }

    // TP2: +60% - Sell 25%
    if (!position.takeProfitHits.tp2 && pnlPercent >= this.TP_LEVELS.TP2.percent) {
      await this.executeTakeProfit(position, currentPrice, 2, this.TP_LEVELS.TP2.sellPercent);
    }

    // TP3: +100% - Sell 25%
    if (!position.takeProfitHits.tp3 && pnlPercent >= this.TP_LEVELS.TP3.percent) {
      await this.executeTakeProfit(position, currentPrice, 3, this.TP_LEVELS.TP3.sellPercent);
    }

    // TP4: +200% - Sell 15%
    if (!position.takeProfitHits.tp4 && pnlPercent >= this.TP_LEVELS.TP4.percent) {
      await this.executeTakeProfit(position, currentPrice, 4, this.TP_LEVELS.TP4.sellPercent);
    }
  }

  /**
   * Execute a take profit partial exit
   */
  private async executeTakeProfit(
    position: PaperPosition,
    currentPrice: number,
    tpLevel: number,
    sellPercent: number
  ): Promise<void> {
    try {
      const tokensToSell = position.remainingAmountTokens * (sellPercent / 100);
      const saleValueUsd = tokensToSell * currentPrice;
      const solPrice = await this.getSolPrice();
      const saleValueSol = saleValueUsd / solPrice;

      // Calculate realized P&L for this sale
      const costBasisUsd = tokensToSell * position.entryPrice;
      const realizedPnlUsd = saleValueUsd - costBasisUsd;
      const realizedPnlSol = realizedPnlUsd / solPrice;

      const tpColumn = `take_profit_${tpLevel}_hit`;
      const amountColumn = `tp${tpLevel}_amount_sold`;

      // Update position
      await query(`
        UPDATE paper_positions SET
          remaining_amount_tokens = remaining_amount_tokens - $2,
          ${tpColumn} = TRUE,
          ${amountColumn} = $2,
          realized_pnl_sol = realized_pnl_sol + $3,
          realized_pnl_usd = realized_pnl_usd + $4,
          updated_at = NOW()
        WHERE id = $1
      `, [position.id, tokensToSell, realizedPnlSol, realizedPnlUsd]);

      // Update wallet balance
      await query(`
        UPDATE paper_wallet SET
          current_balance_sol = current_balance_sol + $1,
          available_balance_sol = available_balance_sol + $1,
          reserved_balance_sol = reserved_balance_sol - $2,
          total_pnl_sol = total_pnl_sol + $3,
          daily_pnl_sol = daily_pnl_sol + $3,
          updated_at = NOW()
        WHERE id = 1
      `, [saleValueSol, saleValueSol, realizedPnlSol]);

      // Log event
      const pnlPercent = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
      await this.logEvent(
        position.paperTradeId,
        position.id,
        `TP${tpLevel}_HIT`,
        { tpLevel, sellPercent, tokensToSell, saleValueSol, realizedPnlSol },
        currentPrice,
        pnlPercent,
        `🎯 TP${tpLevel} HIT: ${position.tokenSymbol} +${pnlPercent.toFixed(1)}% | Sold ${sellPercent}% for ${saleValueSol.toFixed(4)} SOL (+${realizedPnlSol.toFixed(4)} SOL)`,
        'SUCCESS'
      );

      logger.info(`TP${tpLevel} hit for ${position.tokenSymbol}`, {
        pnlPercent: pnlPercent.toFixed(1),
        soldPercent: sellPercent,
        realizedPnlSol
      });

    } catch (error: any) {
      logger.error('Failed to execute take profit', { error: error.message });
    }
  }

  /**
   * Close a paper position completely
   */
  async closePosition(
    position: PaperPosition,
    exitPrice: number,
    exitReason: string
  ): Promise<void> {
    try {
      const solPrice = await this.getSolPrice();

      // Calculate final P&L
      const exitValueUsd = position.remainingAmountTokens * exitPrice;
      const costBasisUsd = position.remainingAmountTokens * position.entryPrice;
      const finalPnlUsd = exitValueUsd - costBasisUsd;
      const finalPnlSol = finalPnlUsd / solPrice;
      const exitValueSol = exitValueUsd / solPrice;

      // Total P&L including partial exits
      const totalPnlSol = position.realizedPnlSol + finalPnlSol;
      const totalPnlUsd = position.realizedPnlUsd + finalPnlUsd;
      const totalPnlPercent = ((exitPrice - position.entryPrice) / position.entryPrice) * 100;

      // Determine outcome
      let outcome: 'WIN' | 'LOSS' | 'BREAKEVEN';
      if (totalPnlPercent > 1) {
        outcome = 'WIN';
      } else if (totalPnlPercent < -1) {
        outcome = 'LOSS';
      } else {
        outcome = 'BREAKEVEN';
      }

      // Update paper trade
      await query(`
        UPDATE paper_trades SET
          exit_price = $2,
          exit_amount_sol = $3,
          exit_time = NOW(),
          exit_reason = $4,
          pnl_sol = $5,
          pnl_percent = $6,
          pnl_usd = $7,
          status = 'CLOSED',
          outcome = $8,
          updated_at = NOW()
        WHERE id = $1
      `, [
        position.paperTradeId,
        exitPrice,
        exitValueSol,
        exitReason,
        totalPnlSol,
        totalPnlPercent,
        totalPnlUsd,
        outcome
      ]);

      // Close position
      await query(`
        UPDATE paper_positions SET
          status = 'CLOSED',
          remaining_amount_tokens = 0,
          updated_at = NOW()
        WHERE id = $1
      `, [position.id]);

      // Update wallet
      const winIncrement = outcome === 'WIN' ? 1 : 0;
      const lossIncrement = outcome === 'LOSS' ? 1 : 0;
      const breakevenIncrement = outcome === 'BREAKEVEN' ? 1 : 0;

      await query(`
        UPDATE paper_wallet SET
          current_balance_sol = current_balance_sol + $1 + $2,
          available_balance_sol = available_balance_sol + $1 + $2,
          reserved_balance_sol = reserved_balance_sol - $3,
          total_pnl_sol = total_pnl_sol + $2,
          daily_pnl_sol = daily_pnl_sol + $2,
          winning_trades = winning_trades + $4,
          losing_trades = losing_trades + $5,
          breakeven_trades = breakeven_trades + $6,
          current_streak = CASE
            WHEN $4 = 1 THEN GREATEST(current_streak, 0) + 1
            WHEN $5 = 1 THEN LEAST(current_streak, 0) - 1
            ELSE current_streak
          END,
          longest_win_streak = CASE
            WHEN $4 = 1 THEN GREATEST(longest_win_streak, GREATEST(current_streak, 0) + 1)
            ELSE longest_win_streak
          END,
          longest_loss_streak = CASE
            WHEN $5 = 1 THEN GREATEST(longest_loss_streak, ABS(LEAST(current_streak, 0) - 1))
            ELSE longest_loss_streak
          END,
          best_trade_pnl_percent = GREATEST(best_trade_pnl_percent, $7),
          worst_trade_pnl_percent = LEAST(worst_trade_pnl_percent, $7),
          updated_at = NOW()
        WHERE id = 1
      `, [
        exitValueSol,
        finalPnlSol,
        position.entryAmountSol,
        winIncrement,
        lossIncrement,
        breakevenIncrement,
        totalPnlPercent
      ]);

      // Log event
      const severity = outcome === 'WIN' ? 'SUCCESS' : outcome === 'LOSS' ? 'DANGER' : 'INFO';
      const emoji = outcome === 'WIN' ? '✅' : outcome === 'LOSS' ? '❌' : '➖';
      await this.logEvent(
        position.paperTradeId,
        position.id,
        'FULL_EXIT',
        { exitPrice, exitReason, totalPnlSol, totalPnlPercent, outcome },
        exitPrice,
        totalPnlPercent,
        `${emoji} PAPER CLOSE: ${position.tokenSymbol} | ${exitReason} | ${totalPnlPercent >= 0 ? '+' : ''}${totalPnlPercent.toFixed(1)}% (${totalPnlSol >= 0 ? '+' : ''}${totalPnlSol.toFixed(4)} SOL)`,
        severity
      );

      // Remove from price feed
      this.priceFeed.removeToken(position.tokenAddress);

      logger.info(`Paper position closed: ${position.tokenSymbol}`, {
        exitReason,
        pnlPercent: totalPnlPercent.toFixed(1),
        pnlSol: totalPnlSol.toFixed(4),
        outcome
      });

      // CRITICAL: Feed completed trade to Learning Engine
      await this.feedTradeToLearningEngine(position, exitPrice, exitReason, outcome, totalPnlPercent);

    } catch (error: any) {
      logger.error('Failed to close paper position', { error: error.message });
    }
  }

  /**
   * Feed completed paper trade to the Learning Engine
   * This is CRITICAL for the bot to learn and improve over time
   */
  private async feedTradeToLearningEngine(
    position: PaperPosition,
    exitPrice: number,
    exitReason: string,
    outcome: 'WIN' | 'LOSS' | 'BREAKEVEN',
    pnlPercent: number
  ): Promise<void> {
    try {
      // Get the original trade fingerprint from paper_trades
      const tradeResult = await query<{ fingerprint: any; entry_conviction_score: number }>(`
        SELECT fingerprint, entry_conviction_score FROM paper_trades WHERE id = $1
      `, [position.paperTradeId]);

      const storedFingerprint = tradeResult.rows[0]?.fingerprint || {};
      const convictionScore = tradeResult.rows[0]?.entry_conviction_score || 0;

      // Build complete fingerprint for learning
      const fingerprint: TradeFingerprint = {
        smartWallets: {
          count: storedFingerprint.smartWalletCount || 0,
          tiers: [
            ...Array(storedFingerprint.tier1Count || 0).fill(1),
            ...Array(storedFingerprint.tier2Count || 0).fill(2)
          ],
          addresses: []
        },
        tokenSafety: {
          overallScore: storedFingerprint.safetyScore || 0,
          liquidityLocked: false,
          liquidityDepth: 0,
          honeypotRisk: false,
          mintAuthority: false,
          freezeAuthority: false
        },
        marketConditions: {
          solPrice: 0,
          solTrend: 'stable',
          btcTrend: 'stable',
          regime: storedFingerprint.marketRegime || 'FULL',
          timeOfDay: new Date().getHours(),
          dayOfWeek: new Date().getDay()
        },
        socialSignals: {
          twitterFollowers: 0,
          telegramMembers: 0,
          mentionVelocity: 0
        },
        entryQuality: {
          dipDepth: storedFingerprint.entryScore || 0,
          distanceFromATH: 0,
          tokenAge: 0,
          buySellRatio: 0,
          hypePhase: 'DISCOVERY'
        }
      };

      // Map exit reason to Trade format
      const tradeExitReason = exitReason === 'STOP_LOSS' ? 'stop_loss'
        : exitReason === 'TRAILING_STOP' ? 'trailing_stop'
        : exitReason === 'MANUAL_CLOSE' ? 'manual'
        : 'take_profit';

      // Map outcome to learning engine format
      const learningOutcome = outcome === 'WIN' ? 'WIN'
        : outcome === 'LOSS' ? 'LOSS'
        : 'BREAKEVEN';

      // Build Trade object for learning engine
      const trade: Trade = {
        id: `paper_${position.paperTradeId}`,
        tokenAddress: position.tokenAddress,
        entryPrice: position.entryPrice,
        entryAmount: position.entryAmountTokens,
        entryTime: position.entryTime,
        exitPrice: exitPrice,
        exitAmount: position.remainingAmountTokens,
        exitTime: new Date(),
        exitReason: tradeExitReason as Trade['exitReason'],
        profitLoss: pnlPercent,
        profitLossPercent: pnlPercent,
        convictionScore: convictionScore,
        fingerprint: fingerprint,
        outcome: learningOutcome
      };

      // Insert into trades table so learning engine can access it
      await query(`
        INSERT INTO trades (
          id, token_address, entry_price, entry_amount, entry_time,
          exit_price, exit_amount, exit_time, exit_reason,
          profit_loss, profit_loss_percent, conviction_score,
          fingerprint, outcome, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW())
        ON CONFLICT (id) DO UPDATE SET
          exit_price = $6, exit_time = $8, exit_reason = $9,
          profit_loss = $10, profit_loss_percent = $11, outcome = $14
      `, [
        trade.id,
        trade.tokenAddress,
        trade.entryPrice,
        trade.entryAmount,
        trade.entryTime,
        trade.exitPrice,
        trade.exitAmount,
        trade.exitTime,
        trade.exitReason,
        trade.profitLoss,
        trade.profitLossPercent,
        trade.convictionScore,
        JSON.stringify(trade.fingerprint),
        trade.outcome
      ]);

      // Feed to learning scheduler if available
      if (this.learningScheduler) {
        await this.learningScheduler.onTradeCompleted(trade);
        logger.info('📚 Paper trade fed to Learning Engine', {
          token: position.tokenSymbol,
          outcome: learningOutcome,
          pnl: pnlPercent.toFixed(1) + '%'
        });
      } else {
        logger.debug('Learning scheduler not connected - trade stored but not processed');
      }

    } catch (error: any) {
      logger.error('Failed to feed trade to learning engine', {
        token: position.tokenAddress.slice(0, 8),
        error: error.message
      });
    }
  }

  /**
   * Manually close a position (from UI)
   */
  async manualClose(tokenAddress: string): Promise<{ success: boolean; message: string }> {
    try {
      const positions = await this.getOpenPositions();
      const position = positions.find(p => p.tokenAddress === tokenAddress);

      if (!position) {
        return { success: false, message: 'Position not found' };
      }

      const priceData = await this.priceFeed.getPrice(tokenAddress);
      if (!priceData) {
        return { success: false, message: 'Could not get current price' };
      }

      await this.closePosition(position, priceData.priceUSD, 'MANUAL_CLOSE');
      return { success: true, message: 'Position closed' };

    } catch (error: any) {
      return { success: false, message: error.message };
    }
  }

  /**
   * Get all open paper positions
   */
  async getOpenPositions(): Promise<PaperPosition[]> {
    const result = await query<any>(`
      SELECT
        pp.id, pp.paper_trade_id, pp.token_address, pp.token_name, pp.token_symbol,
        pp.entry_price, pp.entry_amount_sol, pp.entry_amount_tokens, pp.remaining_amount_tokens,
        pp.entry_time, pp.current_price, pp.highest_price, pp.lowest_price,
        pp.unrealized_pnl_sol, pp.unrealized_pnl_percent, pp.unrealized_pnl_usd,
        pp.stop_loss_price, pp.stop_loss_percent,
        pp.trailing_stop_active, pp.trailing_stop_price, pp.trailing_stop_percent,
        pp.take_profit_1_hit, pp.take_profit_2_hit, pp.take_profit_3_hit, pp.take_profit_4_hit,
        pp.realized_pnl_sol, pp.realized_pnl_usd,
        pp.status, pp.smart_wallets_holding, pp.smart_wallets_exited, pp.danger_signals
      FROM paper_positions pp
      WHERE pp.status = 'ACTIVE'
      ORDER BY pp.entry_time DESC
    `);

    return result.rows.map(row => ({
      id: row.id,
      paperTradeId: row.paper_trade_id,
      tokenAddress: row.token_address,
      tokenName: row.token_name || 'Unknown',
      tokenSymbol: row.token_symbol || '???',
      entryPrice: parseFloat(row.entry_price) || 0,
      entryAmountSol: parseFloat(row.entry_amount_sol) || 0,
      entryAmountTokens: parseFloat(row.entry_amount_tokens) || 0,
      remainingAmountTokens: parseFloat(row.remaining_amount_tokens) || 0,
      entryTime: row.entry_time,
      currentPrice: parseFloat(row.current_price) || 0,
      highestPrice: parseFloat(row.highest_price) || 0,
      lowestPrice: parseFloat(row.lowest_price) || 0,
      unrealizedPnlSol: parseFloat(row.unrealized_pnl_sol) || 0,
      unrealizedPnlPercent: parseFloat(row.unrealized_pnl_percent) || 0,
      unrealizedPnlUsd: parseFloat(row.unrealized_pnl_usd) || 0,
      stopLossPrice: parseFloat(row.stop_loss_price) || 0,
      stopLossPercent: parseFloat(row.stop_loss_percent) || 25,
      trailingStopActive: row.trailing_stop_active || false,
      trailingStopPrice: row.trailing_stop_price ? parseFloat(row.trailing_stop_price) : null,
      trailingStopPercent: row.trailing_stop_percent ? parseFloat(row.trailing_stop_percent) : null,
      takeProfitHits: {
        tp1: row.take_profit_1_hit || false,
        tp2: row.take_profit_2_hit || false,
        tp3: row.take_profit_3_hit || false,
        tp4: row.take_profit_4_hit || false
      },
      realizedPnlSol: parseFloat(row.realized_pnl_sol) || 0,
      realizedPnlUsd: parseFloat(row.realized_pnl_usd) || 0,
      status: row.status,
      smartWalletsHolding: row.smart_wallets_holding || [],
      smartWalletsExited: row.smart_wallets_exited || [],
      dangerSignals: row.danger_signals || []
    }));
  }

  /**
   * Get paper wallet info
   */
  async getPaperWallet(): Promise<PaperWallet | null> {
    const result = await query<any>(`
      SELECT * FROM paper_wallet WHERE id = 1
    `);

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    const totalTrades = row.winning_trades + row.losing_trades + row.breakeven_trades;
    const winRate = totalTrades > 0 ? (row.winning_trades / totalTrades) * 100 : 0;

    return {
      id: row.id,
      initialBalanceSol: parseFloat(row.initial_balance_sol) || 10,
      currentBalanceSol: parseFloat(row.current_balance_sol) || 10,
      reservedBalanceSol: parseFloat(row.reserved_balance_sol) || 0,
      availableBalanceSol: parseFloat(row.available_balance_sol) || 10,
      totalTrades: row.total_trades || 0,
      winningTrades: row.winning_trades || 0,
      losingTrades: row.losing_trades || 0,
      breakevenTrades: row.breakeven_trades || 0,
      totalPnlSol: parseFloat(row.total_pnl_sol) || 0,
      totalPnlPercent: parseFloat(row.total_pnl_percent) || 0,
      winRate,
      profitFactor: row.losing_trades > 0
        ? Math.abs(row.winning_trades / row.losing_trades)
        : row.winning_trades,
      currentStreak: row.current_streak || 0,
      longestWinStreak: row.longest_win_streak || 0,
      longestLossStreak: row.longest_loss_streak || 0,
      dailyPnlSol: parseFloat(row.daily_pnl_sol) || 0,
      dailyPnlPercent: parseFloat(row.daily_pnl_percent) || 0,
      dailyTrades: row.daily_trades || 0,
      isActive: row.is_active,
      isPaused: row.is_paused,
      pauseReason: row.pause_reason
    };
  }

  /**
   * Get paper trade history
   */
  async getTradeHistory(limit: number = 50): Promise<any[]> {
    const result = await query(`
      SELECT * FROM paper_trades
      ORDER BY created_at DESC
      LIMIT $1
    `, [limit]);

    return result.rows;
  }

  /**
   * Get paper trade events (for console display)
   */
  async getEvents(limit: number = 100): Promise<PaperTradeEvent[]> {
    const result = await query<any>(`
      SELECT * FROM paper_trade_events
      ORDER BY created_at DESC
      LIMIT $1
    `, [limit]);

    return result.rows.map(row => ({
      id: row.id,
      paperTradeId: row.paper_trade_id,
      paperPositionId: row.paper_position_id,
      eventType: row.event_type,
      eventData: row.event_data,
      priceAtEvent: parseFloat(row.price_at_event) || 0,
      pnlAtEvent: parseFloat(row.pnl_at_event) || 0,
      message: row.message,
      severity: row.severity,
      createdAt: row.created_at
    }));
  }

  /**
   * Get daily stats
   */
  async getDailyStats(days: number = 30): Promise<any[]> {
    const result = await query(`
      SELECT * FROM paper_daily_stats
      ORDER BY date DESC
      LIMIT $1
    `, [days]);

    return result.rows;
  }

  /**
   * Reset paper wallet to initial state
   */
  async resetWallet(initialBalance: number = 10): Promise<void> {
    // Close all open positions first
    const positions = await this.getOpenPositions();
    for (const position of positions) {
      const priceData = await this.priceFeed.getPrice(position.tokenAddress);
      if (priceData) {
        await this.closePosition(position, priceData.priceUSD, 'WALLET_RESET');
      }
    }

    // Reset wallet
    await query(`
      UPDATE paper_wallet SET
        initial_balance_sol = $1,
        current_balance_sol = $1,
        reserved_balance_sol = 0,
        available_balance_sol = $1,
        total_trades = 0,
        winning_trades = 0,
        losing_trades = 0,
        breakeven_trades = 0,
        total_pnl_sol = 0,
        total_pnl_usd = 0,
        total_pnl_percent = 0,
        best_trade_pnl_percent = 0,
        worst_trade_pnl_percent = 0,
        current_streak = 0,
        longest_win_streak = 0,
        longest_loss_streak = 0,
        daily_pnl_sol = 0,
        daily_pnl_percent = 0,
        daily_trades = 0,
        daily_reset_at = NOW(),
        is_paused = FALSE,
        pause_reason = NULL,
        updated_at = NOW()
      WHERE id = 1
    `, [initialBalance]);

    // Clear trade history
    await query(`DELETE FROM paper_trade_events`);
    await query(`DELETE FROM paper_trades`);
    await query(`DELETE FROM paper_daily_stats`);

    await this.logEvent(
      0, null, 'WALLET_RESET',
      { initialBalance },
      0, 0,
      `🔄 Paper wallet reset to ${initialBalance} SOL`,
      'INFO'
    );

    logger.info(`Paper wallet reset to ${initialBalance} SOL`);
  }

  /**
   * Pause paper trading
   */
  async pauseTrading(reason: string): Promise<void> {
    await query(`
      UPDATE paper_wallet SET
        is_paused = TRUE,
        pause_reason = $1,
        updated_at = NOW()
      WHERE id = 1
    `, [reason]);

    await this.logEvent(
      0, null, 'TRADING_PAUSED',
      { reason },
      0, 0,
      `⏸️ Paper trading paused: ${reason}`,
      'WARNING'
    );
  }

  /**
   * Resume paper trading
   */
  async resumeTrading(): Promise<void> {
    await query(`
      UPDATE paper_wallet SET
        is_paused = FALSE,
        pause_reason = NULL,
        updated_at = NOW()
      WHERE id = 1
    `);

    await this.logEvent(
      0, null, 'TRADING_RESUMED',
      {},
      0, 0,
      `▶️ Paper trading resumed`,
      'SUCCESS'
    );
  }

  /**
   * Ensure paper wallet exists
   */
  private async ensurePaperWallet(): Promise<void> {
    const result = await query(`SELECT id FROM paper_wallet WHERE id = 1`);
    if (result.rows.length === 0) {
      await query(`
        INSERT INTO paper_wallet (
          id, initial_balance_sol, current_balance_sol, available_balance_sol
        ) VALUES (1, 10.0, 10.0, 10.0)
      `);
    }

    // Reset daily stats if new day
    await query(`
      UPDATE paper_wallet SET
        daily_pnl_sol = 0,
        daily_pnl_percent = 0,
        daily_trades = 0,
        daily_reset_at = NOW()
      WHERE id = 1
      AND daily_reset_at < CURRENT_DATE
    `);
  }

  /**
   * Log a paper trade event
   */
  private async logEvent(
    tradeId: number,
    positionId: number | null,
    eventType: string,
    eventData: any,
    priceAtEvent: number,
    pnlAtEvent: number,
    message: string,
    severity: 'INFO' | 'WARNING' | 'SUCCESS' | 'DANGER'
  ): Promise<void> {
    await query(`
      INSERT INTO paper_trade_events (
        paper_trade_id, paper_position_id, event_type, event_data,
        price_at_event, pnl_at_event, message, severity
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [
      tradeId || null,
      positionId,
      eventType,
      JSON.stringify(eventData),
      priceAtEvent,
      pnlAtEvent,
      message,
      severity
    ]);
  }

  /**
   * Get SOL price in USD
   */
  private async getSolPrice(): Promise<number> {
    try {
      const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
      const data = await response.json() as { solana?: { usd?: number } };
      return data.solana?.usd || 100;
    } catch {
      return 100; // Fallback
    }
  }

  /**
   * Create trade fingerprint for learning engine
   * This captures all relevant conditions at the moment of entry
   */
  private createFingerprint(signal: AggregatedSignal, _decision: EntryDecision): TradeFingerprint {
    const tier1Count = signal.smartWallet?.tier1Count || 0;
    const tier2Count = signal.smartWallet?.tier2Count || 0;
    const tier3Count = signal.smartWallet?.tier3Count || 0;

    return {
      smartWallets: {
        count: signal.smartWallet?.walletCount || 0,
        tiers: [
          ...Array(tier1Count).fill(1),
          ...Array(tier2Count).fill(2),
          ...Array(tier3Count).fill(3)
        ],
        addresses: []
      },
      tokenSafety: {
        overallScore: signal.safety?.overallScore || 0,
        liquidityLocked: false, // Not directly available in SafetyAnalysis
        liquidityDepth: signal.safety?.liquidityScore || 0, // Use liquidity score as proxy
        honeypotRisk: signal.safety?.honeypotAnalysis?.isHoneypot || false,
        mintAuthority: signal.safety?.contractAnalysis?.hasMintAuthority || false,
        freezeAuthority: signal.safety?.contractAnalysis?.hasFreezeAuthority || false
      },
      marketConditions: {
        solPrice: 0, // Not directly available
        solTrend: (signal.marketContext?.solChange24h || 0) > 0 ? 'up' : (signal.marketContext?.solChange24h || 0) < 0 ? 'down' : 'stable',
        btcTrend: (signal.marketContext?.btcChange24h || 0) > 0 ? 'up' : (signal.marketContext?.btcChange24h || 0) < 0 ? 'down' : 'stable',
        regime: signal.marketContext?.regime || 'FULL',
        timeOfDay: new Date().getHours(),
        dayOfWeek: new Date().getDay()
      },
      socialSignals: {
        twitterFollowers: signal.social?.twitterFollowers || 0,
        telegramMembers: signal.social?.telegramMembers || 0,
        mentionVelocity: signal.social?.mentionVelocity || 0
      },
      entryQuality: {
        dipDepth: signal.entryQuality?.dipDepthPercent || 0,
        distanceFromATH: signal.entryQuality?.distanceFromATHPercent || 0,
        tokenAge: signal.entryQuality?.tokenAgeMinutes || 0,
        buySellRatio: signal.entryQuality?.buyToSellRatio || 0,
        hypePhase: (signal.entryQuality?.hypePhase as any) || 'DISCOVERY'
      }
    };
  }

  /**
   * Get engine stats
   */
  getStats() {
    return {
      isRunning: this.isRunning
    };
  }
}
