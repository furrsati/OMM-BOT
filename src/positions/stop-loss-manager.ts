/**
 * Stop-Loss Manager
 *
 * Manages three types of stop-losses:
 * 1. HARD STOP: Fixed -25% from entry (non-negotiable)
 * 2. TRAILING STOP: Activates at +20% profit, trails 10-15% below peak
 * 3. TIME-BASED STOP: Exit if position flat (-5% to +10%) after 4 hours
 *
 * Automatically triggers sell orders when stops are hit.
 */

import { logger } from '../utils/logger';
import { PositionData } from './position-tracker';

export interface StopLossCheck {
  shouldExit: boolean;
  reason?: string;
  stopType?: 'hard' | 'trailing' | 'time_based';
  urgency: 'normal' | 'urgent' | 'emergency';
}

export class StopLossManager {
  private readonly HARD_STOP_PERCENT = -25; // -25% from entry
  private readonly TIME_STOP_HOURS = 4; // 4 hours
  private readonly TIME_STOP_MIN_PNL = -5; // -5%
  private readonly TIME_STOP_MAX_PNL = 10; // +10%

  /**
   * Check if any stop-loss should trigger
   */
  checkStopLoss(position: PositionData): StopLossCheck {
    // Check hard stop first (highest priority)
    const hardStopCheck = this.checkHardStop(position);
    if (hardStopCheck.shouldExit) {
      return hardStopCheck;
    }

    // Check trailing stop
    const trailingStopCheck = this.checkTrailingStop(position);
    if (trailingStopCheck.shouldExit) {
      return trailingStopCheck;
    }

    // Check time-based stop
    const timeStopCheck = this.checkTimeBasedStop(position);
    if (timeStopCheck.shouldExit) {
      return timeStopCheck;
    }

    return { shouldExit: false, urgency: 'normal' };
  }

  /**
   * Check hard stop-loss (-25% from entry)
   */
  private checkHardStop(position: PositionData): StopLossCheck {
    if (position.pnlPercent <= this.HARD_STOP_PERCENT) {
      logger.warn('🛑 Hard stop-loss triggered', {
        token: position.tokenAddress.slice(0, 8),
        symbol: position.tokenSymbol,
        pnl: position.pnlPercent.toFixed(2) + '%',
        entryPrice: position.entryPrice,
        currentPrice: position.currentPrice
      });

      return {
        shouldExit: true,
        reason: `Hard stop-loss hit (${position.pnlPercent.toFixed(1)}%)`,
        stopType: 'hard',
        urgency: 'urgent'
      };
    }

    return { shouldExit: false, urgency: 'normal' };
  }

  /**
   * Check trailing stop-loss
   */
  private checkTrailingStop(position: PositionData): StopLossCheck {
    // Only active if trailing stop is enabled (happens at +20% profit)
    if (!position.trailingStopActive) {
      return { shouldExit: false, urgency: 'normal' };
    }

    // Check if current price is below the trailing stop
    if (position.currentPrice <= position.stopLossPrice) {
      logger.info('📉 Trailing stop triggered', {
        token: position.tokenAddress.slice(0, 8),
        symbol: position.tokenSymbol,
        pnl: position.pnlPercent.toFixed(2) + '%',
        highestPrice: position.highestPrice,
        stopPrice: position.stopLossPrice,
        currentPrice: position.currentPrice
      });

      return {
        shouldExit: true,
        reason: `Trailing stop hit (locked ${position.pnlPercent.toFixed(1)}% profit)`,
        stopType: 'trailing',
        urgency: 'urgent'
      };
    }

    return { shouldExit: false, urgency: 'normal' };
  }

  /**
   * Check time-based stop (exit if flat after 4 hours)
   */
  private checkTimeBasedStop(position: PositionData): StopLossCheck {
    const hoursHeld = (Date.now() - position.entryTime.getTime()) / (1000 * 60 * 60);

    // Only check if position has been held for TIME_STOP_HOURS
    if (hoursHeld < this.TIME_STOP_HOURS) {
      return { shouldExit: false, urgency: 'normal' };
    }

    // Check if P&L is in the "flat" range (-5% to +10%)
    const inFlatRange =
      position.pnlPercent >= this.TIME_STOP_MIN_PNL &&
      position.pnlPercent <= this.TIME_STOP_MAX_PNL;

    if (inFlatRange) {
      logger.info('⏰ Time-based stop triggered', {
        token: position.tokenAddress.slice(0, 8),
        symbol: position.tokenSymbol,
        hoursHeld: hoursHeld.toFixed(1),
        pnl: position.pnlPercent.toFixed(2) + '%'
      });

      return {
        shouldExit: true,
        reason: `Time stop (flat for ${hoursHeld.toFixed(1)}h)`,
        stopType: 'time_based',
        urgency: 'normal'
      };
    }

    return { shouldExit: false, urgency: 'normal' };
  }

  /**
   * Calculate optimal stop-loss price for a new position
   */
  calculateInitialStopLoss(entryPrice: number): number {
    return entryPrice * (1 + this.HARD_STOP_PERCENT / 100);
  }

  /**
   * Calculate trailing stop price based on highest price
   */
  calculateTrailingStopPrice(highestPrice: number, pnlPercent: number): number {
    // Determine trail percentage based on profit level
    let trailPercent = 0.15; // Default 15%

    if (pnlPercent > 100) {
      trailPercent = 0.10; // 10% trail at 2x+ profit
    } else if (pnlPercent > 50) {
      trailPercent = 0.12; // 12% trail at 1.5x+ profit
    }

    return highestPrice * (1 - trailPercent);
  }

  /**
   * Check if trailing stop should be activated
   */
  shouldActivateTrailingStop(pnlPercent: number): boolean {
    return pnlPercent > 20; // Activate at +20% profit
  }

  /**
   * Get stop-loss stats for a position
   */
  getStopLossStats(position: PositionData) {
    const hoursHeld = (Date.now() - position.entryTime.getTime()) / (1000 * 60 * 60);

    return {
      hardStopPrice: position.entryPrice * 0.75,
      hardStopDistance: ((position.currentPrice - (position.entryPrice * 0.75)) / position.currentPrice) * 100,
      trailingStopActive: position.trailingStopActive,
      trailingStopPrice: position.stopLossPrice,
      trailingStopDistance: position.trailingStopActive
        ? ((position.currentPrice - position.stopLossPrice) / position.currentPrice) * 100
        : null,
      timeStopEligible: hoursHeld >= this.TIME_STOP_HOURS,
      hoursHeld: hoursHeld.toFixed(1)
    };
  }

  /**
   * Format stop-loss info for logging
   */
  formatStopInfo(position: PositionData): string {
    const stats = this.getStopLossStats(position);

    if (stats.trailingStopActive) {
      return `Trailing: $${stats.trailingStopPrice.toFixed(6)} (${stats.trailingStopDistance?.toFixed(1)}% away)`;
    } else {
      return `Hard: $${stats.hardStopPrice.toFixed(6)} (${stats.hardStopDistance.toFixed(1)}% away)`;
    }
  }
}
