/**
 * Position Tracker
 *
 * Manages individual position state and lifecycle:
 * - Creates position records when trades execute
 * - Updates position with current price and P&L
 * - Tracks highest price for trailing stops
 * - Manages take-profit level execution status
 * - Persists position state to database
 * - Provides position status and metrics
 */

import { logger } from '../utils/logger';
import { query } from '../db/postgres';
import { Position, TakeProfitLevel } from '../types';

export interface PositionData {
  id?: string;
  tokenAddress: string;
  tokenName?: string;
  tokenSymbol?: string;
  entryPrice: number;
  entryAmount: number;
  entryTime: Date;
  entryConviction: number;
  currentPrice: number;
  highestPrice: number;
  stopLossPrice: number;
  trailingStopActive: boolean;
  takeProfitLevels: {
    tp30: boolean;
    tp60: boolean;
    tp100: boolean;
    tp200: boolean;
  };
  remainingAmount: number;
  pnlPercent: number;
  pnlUsd: number;
  status: 'OPEN' | 'STOP_HIT' | 'TP_HIT' | 'DANGER_EXIT' | 'CLOSED';
  exitReason?: string;
  exitTime?: Date;
  smartWalletsInPosition: string[];
}

export class PositionTracker {
  private positions: Map<string, PositionData> = new Map();

  /**
   * Create a new position
   */
  async createPosition(data: {
    tokenAddress: string;
    tokenName?: string;
    tokenSymbol?: string;
    entryPrice: number;
    entryAmount: number;
    entryConviction: number;
    smartWallets: string[];
  }): Promise<PositionData> {
    try {
      // Calculate initial stop-loss (hard stop at -25%)
      const stopLossPrice = data.entryPrice * 0.75;

      const position: PositionData = {
        tokenAddress: data.tokenAddress,
        tokenName: data.tokenName,
        tokenSymbol: data.tokenSymbol,
        entryPrice: data.entryPrice,
        entryAmount: data.entryAmount,
        entryTime: new Date(),
        entryConviction: data.entryConviction,
        currentPrice: data.entryPrice,
        highestPrice: data.entryPrice,
        stopLossPrice,
        trailingStopActive: false,
        takeProfitLevels: {
          tp30: false,
          tp60: false,
          tp100: false,
          tp200: false
        },
        remainingAmount: data.entryAmount,
        pnlPercent: 0,
        pnlUsd: 0,
        status: 'OPEN',
        smartWalletsInPosition: data.smartWallets
      };

      // Persist to database
      const result = await query(
        `INSERT INTO positions (
          token_address, token_name, token_symbol,
          entry_price, entry_amount, entry_time, entry_conviction,
          current_price, highest_price, stop_loss_price,
          trailing_stop_active,
          take_profit_30_hit, take_profit_60_hit, take_profit_100_hit, take_profit_200_hit,
          remaining_amount, pnl_percent, pnl_usd,
          status, smart_wallets_in_position
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
        RETURNING id`,
        [
          position.tokenAddress,
          position.tokenName,
          position.tokenSymbol,
          position.entryPrice,
          position.entryAmount,
          position.entryTime,
          position.entryConviction,
          position.currentPrice,
          position.highestPrice,
          position.stopLossPrice,
          position.trailingStopActive,
          position.takeProfitLevels.tp30,
          position.takeProfitLevels.tp60,
          position.takeProfitLevels.tp100,
          position.takeProfitLevels.tp200,
          position.remainingAmount,
          position.pnlPercent,
          position.pnlUsd,
          position.status,
          position.smartWalletsInPosition
        ]
      );

      position.id = result.rows[0].id;

      // Add to in-memory cache
      this.positions.set(data.tokenAddress, position);

      logger.info('✅ Position created', {
        token: data.tokenAddress.slice(0, 8),
        symbol: data.tokenSymbol,
        entryPrice: data.entryPrice,
        amount: data.entryAmount,
        conviction: data.entryConviction
      });

      return position;

    } catch (error: any) {
      logger.error('Failed to create position', {
        token: data.tokenAddress.slice(0, 8),
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Update position with current price
   */
  async updatePrice(tokenAddress: string, currentPrice: number): Promise<void> {
    try {
      const position = this.positions.get(tokenAddress);
      if (!position) {
        return;
      }

      // Update current price
      position.currentPrice = currentPrice;

      // Update highest price if new high
      if (currentPrice > position.highestPrice) {
        position.highestPrice = currentPrice;
      }

      // Calculate P&L
      position.pnlPercent = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
      position.pnlUsd = (currentPrice - position.entryPrice) * position.remainingAmount;

      // Activate trailing stop if profit > 20%
      if (position.pnlPercent > 20 && !position.trailingStopActive) {
        position.trailingStopActive = true;
        logger.info('🎯 Trailing stop activated', {
          token: tokenAddress.slice(0, 8),
          pnl: position.pnlPercent.toFixed(2) + '%'
        });
      }

      // Update trailing stop price if active
      if (position.trailingStopActive) {
        // Trail 15% below highest price initially
        let trailPercent = 0.15;

        // Tighter trailing as profit increases
        if (position.pnlPercent > 100) {
          trailPercent = 0.10; // 10% trail at 2x+
        } else if (position.pnlPercent > 50) {
          trailPercent = 0.12; // 12% trail at 1.5x+
        }

        const trailingStopPrice = position.highestPrice * (1 - trailPercent);

        // Only update if it raises the stop (never lower it)
        if (trailingStopPrice > position.stopLossPrice) {
          position.stopLossPrice = trailingStopPrice;
        }
      }

      // Persist to database
      await query(
        `UPDATE positions SET
          current_price = $1,
          highest_price = $2,
          stop_loss_price = $3,
          trailing_stop_active = $4,
          pnl_percent = $5,
          pnl_usd = $6,
          updated_at = NOW()
        WHERE token_address = $7`,
        [
          position.currentPrice,
          position.highestPrice,
          position.stopLossPrice,
          position.trailingStopActive,
          position.pnlPercent,
          position.pnlUsd,
          tokenAddress
        ]
      );

    } catch (error: any) {
      logger.error('Failed to update position price', {
        token: tokenAddress.slice(0, 8),
        error: error.message
      });
    }
  }

  /**
   * Mark a take-profit level as hit
   */
  async markTakeProfitHit(tokenAddress: string, level: 30 | 60 | 100 | 200): Promise<void> {
    try {
      const position = this.positions.get(tokenAddress);
      if (!position) {
        return;
      }

      const levelKey = `tp${level}` as keyof typeof position.takeProfitLevels;
      position.takeProfitLevels[levelKey] = true;

      // Persist to database
      const columnName = `take_profit_${level}_hit`;
      await query(
        `UPDATE positions SET ${columnName} = TRUE, updated_at = NOW() WHERE token_address = $1`,
        [tokenAddress]
      );

      logger.info('📈 Take-profit level hit', {
        token: tokenAddress.slice(0, 8),
        level: `+${level}%`
      });

    } catch (error: any) {
      logger.error('Failed to mark take-profit hit', {
        token: tokenAddress.slice(0, 8),
        level,
        error: error.message
      });
    }
  }

  /**
   * Reduce position after partial sell
   */
  async reducePosition(tokenAddress: string, amountSold: number): Promise<void> {
    try {
      const position = this.positions.get(tokenAddress);
      if (!position) {
        return;
      }

      position.remainingAmount -= amountSold;

      // Persist to database
      await query(
        `UPDATE positions SET remaining_amount = $1, updated_at = NOW() WHERE token_address = $2`,
        [position.remainingAmount, tokenAddress]
      );

      logger.debug('Position reduced after partial sell', {
        token: tokenAddress.slice(0, 8),
        amountSold,
        remaining: position.remainingAmount
      });

    } catch (error: any) {
      logger.error('Failed to reduce position', {
        token: tokenAddress.slice(0, 8),
        error: error.message
      });
    }
  }

  /**
   * Close a position
   */
  async closePosition(
    tokenAddress: string,
    reason: string,
    finalPrice: number
  ): Promise<void> {
    try {
      const position = this.positions.get(tokenAddress);
      if (!position) {
        return;
      }

      position.status = 'CLOSED';
      position.exitReason = reason;
      position.exitTime = new Date();
      position.currentPrice = finalPrice;
      position.pnlPercent = ((finalPrice - position.entryPrice) / position.entryPrice) * 100;

      // Persist to database
      await query(
        `UPDATE positions SET
          status = 'CLOSED',
          exit_reason = $1,
          exit_time = NOW(),
          current_price = $2,
          pnl_percent = $3,
          updated_at = NOW()
        WHERE token_address = $4`,
        [reason, finalPrice, position.pnlPercent, tokenAddress]
      );

      logger.info('🔒 Position closed', {
        token: tokenAddress.slice(0, 8),
        reason,
        pnl: position.pnlPercent.toFixed(2) + '%'
      });

      // Remove from in-memory cache
      this.positions.delete(tokenAddress);

    } catch (error: any) {
      logger.error('Failed to close position', {
        token: tokenAddress.slice(0, 8),
        error: error.message
      });
    }
  }

  /**
   * Get a position by token address
   */
  getPosition(tokenAddress: string): PositionData | undefined {
    return this.positions.get(tokenAddress);
  }

  /**
   * Get all open positions
   */
  getAllPositions(): PositionData[] {
    return Array.from(this.positions.values());
  }

  /**
   * Load open positions from database on startup
   */
  async loadOpenPositions(): Promise<void> {
    try {
      const result = await query(
        `SELECT * FROM positions WHERE status = 'OPEN'`,
        []
      );

      for (const row of result.rows) {
        const position: PositionData = {
          id: row.id,
          tokenAddress: row.token_address,
          tokenName: row.token_name,
          tokenSymbol: row.token_symbol,
          entryPrice: parseFloat(row.entry_price),
          entryAmount: parseFloat(row.entry_amount),
          entryTime: row.entry_time,
          entryConviction: row.entry_conviction,
          currentPrice: parseFloat(row.current_price),
          highestPrice: parseFloat(row.highest_price),
          stopLossPrice: parseFloat(row.stop_loss_price),
          trailingStopActive: row.trailing_stop_active,
          takeProfitLevels: {
            tp30: row.take_profit_30_hit,
            tp60: row.take_profit_60_hit,
            tp100: row.take_profit_100_hit,
            tp200: row.take_profit_200_hit
          },
          remainingAmount: parseFloat(row.remaining_amount),
          pnlPercent: parseFloat(row.pnl_percent || 0),
          pnlUsd: parseFloat(row.pnl_usd || 0),
          status: row.status,
          smartWalletsInPosition: row.smart_wallets_in_position || []
        };

        this.positions.set(position.tokenAddress, position);
      }

      logger.info(`📦 Loaded ${result.rows.length} open positions from database`);

    } catch (error: any) {
      logger.error('Failed to load open positions', { error: error.message });
    }
  }

  /**
   * Get position count
   */
  getPositionCount(): number {
    return this.positions.size;
  }

  /**
   * Check if position exists
   */
  hasPosition(tokenAddress: string): boolean {
    return this.positions.has(tokenAddress);
  }
}
