/**
 * Take-Profit Manager
 *
 * Manages staged exit strategy:
 * - +30%: Sell 20% of position
 * - +60%: Sell 25% of position
 * - +100% (2x): Sell 25% of position
 * - +200% (3x): Sell 15% of position
 * - Remaining 15%: Hold as moonbag with trailing stop
 *
 * Prevents double-execution and coordinates with sell executor.
 */

import { logger } from '../utils/logger';
import { PositionData } from './position-tracker';

export interface TakeProfitLevel {
  targetPercent: number;
  sellPercent: number;
  executed: boolean;
  label: string;
}

export interface TakeProfitCheck {
  shouldSell: boolean;
  level?: TakeProfitLevel;
  amountToSell?: number;
  reason?: string;
}

export class TakeProfitManager {
  // Staged take-profit levels (percent gain -> percent to sell)
  private readonly TAKE_PROFIT_LEVELS: TakeProfitLevel[] = [
    { targetPercent: 30, sellPercent: 20, executed: false, label: 'TP1 (+30%)' },
    { targetPercent: 60, sellPercent: 25, executed: false, label: 'TP2 (+60%)' },
    { targetPercent: 100, sellPercent: 25, executed: false, label: 'TP3 (+100%)' },
    { targetPercent: 200, sellPercent: 15, executed: false, label: 'TP4 (+200%)' }
  ];

  /**
   * Check if any take-profit level should trigger
   */
  checkTakeProfit(position: PositionData): TakeProfitCheck {
    // Check each level in order
    for (const level of this.TAKE_PROFIT_LEVELS) {
      // Skip if already executed
      const levelKey = `tp${level.targetPercent}` as keyof typeof position.takeProfitLevels;
      if (position.takeProfitLevels[levelKey]) {
        continue;
      }

      // Check if price reached this level
      if (position.pnlPercent >= level.targetPercent) {
        // Calculate amount to sell (percent of ORIGINAL position, not remaining)
        const amountToSell = position.entryAmount * (level.sellPercent / 100);

        // Ensure we don't sell more than remaining
        const actualAmountToSell = Math.min(amountToSell, position.remainingAmount);

        if (actualAmountToSell > 0) {
          logger.info('🎯 Take-profit level reached', {
            token: position.tokenAddress.slice(0, 8),
            symbol: position.tokenSymbol,
            level: level.label,
            currentPnL: position.pnlPercent.toFixed(2) + '%',
            sellPercent: level.sellPercent,
            amountToSell: actualAmountToSell.toFixed(6)
          });

          return {
            shouldSell: true,
            level,
            amountToSell: actualAmountToSell,
            reason: `${level.label}: Selling ${level.sellPercent}% (${position.pnlPercent.toFixed(1)}% gain)`
          };
        }
      }
    }

    return { shouldSell: false };
  }

  /**
   * Check multiple levels at once (in case price jumped)
   */
  checkAllTakeProfitLevels(position: PositionData): TakeProfitCheck[] {
    const triggeredLevels: TakeProfitCheck[] = [];

    for (const level of this.TAKE_PROFIT_LEVELS) {
      const levelKey = `tp${level.targetPercent}` as keyof typeof position.takeProfitLevels;

      // Skip if already executed
      if (position.takeProfitLevels[levelKey]) {
        continue;
      }

      // Check if reached
      if (position.pnlPercent >= level.targetPercent) {
        const amountToSell = position.entryAmount * (level.sellPercent / 100);
        const actualAmountToSell = Math.min(amountToSell, position.remainingAmount);

        if (actualAmountToSell > 0) {
          triggeredLevels.push({
            shouldSell: true,
            level,
            amountToSell: actualAmountToSell,
            reason: `${level.label}: Selling ${level.sellPercent}%`
          });
        }
      }
    }

    return triggeredLevels;
  }

  /**
   * Calculate cumulative sell percentage up to a profit level
   */
  getCumulativeSellPercent(targetPnL: number): number {
    let cumulative = 0;

    for (const level of this.TAKE_PROFIT_LEVELS) {
      if (targetPnL >= level.targetPercent) {
        cumulative += level.sellPercent;
      }
    }

    return cumulative;
  }

  /**
   * Get next take-profit level for a position
   */
  getNextTakeProfitLevel(position: PositionData): TakeProfitLevel | null {
    for (const level of this.TAKE_PROFIT_LEVELS) {
      const levelKey = `tp${level.targetPercent}` as keyof typeof position.takeProfitLevels;

      // Return first level not yet executed
      if (!position.takeProfitLevels[levelKey]) {
        return level;
      }
    }

    return null; // All levels executed
  }

  /**
   * Calculate remaining moonbag percentage
   */
  getRemainingMoonbagPercent(position: PositionData): number {
    let totalSold = 0;

    if (position.takeProfitLevels.tp30) totalSold += 20;
    if (position.takeProfitLevels.tp60) totalSold += 25;
    if (position.takeProfitLevels.tp100) totalSold += 25;
    if (position.takeProfitLevels.tp200) totalSold += 15;

    return 100 - totalSold;
  }

  /**
   * Check if all take-profit levels are executed (moonbag only)
   */
  isFullyTakenProfit(position: PositionData): boolean {
    return (
      position.takeProfitLevels.tp30 &&
      position.takeProfitLevels.tp60 &&
      position.takeProfitLevels.tp100 &&
      position.takeProfitLevels.tp200
    );
  }

  /**
   * Get take-profit stats for a position
   */
  getTakeProfitStats(position: PositionData) {
    const nextLevel = this.getNextTakeProfitLevel(position);
    const moonbagPercent = this.getRemainingMoonbagPercent(position);

    return {
      tp30Hit: position.takeProfitLevels.tp30,
      tp60Hit: position.takeProfitLevels.tp60,
      tp100Hit: position.takeProfitLevels.tp100,
      tp200Hit: position.takeProfitLevels.tp200,
      nextLevel: nextLevel ? nextLevel.label : 'All TPs hit',
      nextLevelTarget: nextLevel ? nextLevel.targetPercent : null,
      distanceToNextLevel: nextLevel ? nextLevel.targetPercent - position.pnlPercent : null,
      moonbagPercent,
      isFullyTakenProfit: this.isFullyTakenProfit(position)
    };
  }

  /**
   * Format take-profit info for logging
   */
  formatTakeProfitInfo(position: PositionData): string {
    const stats = this.getTakeProfitStats(position);

    if (stats.isFullyTakenProfit) {
      return `All TPs hit | Moonbag: ${stats.moonbagPercent}%`;
    }

    if (stats.nextLevel && stats.distanceToNextLevel !== null) {
      return `Next: ${stats.nextLevel} (${stats.distanceToNextLevel.toFixed(1)}% away)`;
    }

    return 'No TPs hit yet';
  }

  /**
   * Get visual progress bar for take-profit levels
   */
  getTakeProfitProgressBar(position: PositionData): string {
    const tp30 = position.takeProfitLevels.tp30 ? '✅' : '⬜';
    const tp60 = position.takeProfitLevels.tp60 ? '✅' : '⬜';
    const tp100 = position.takeProfitLevels.tp100 ? '✅' : '⬜';
    const tp200 = position.takeProfitLevels.tp200 ? '✅' : '⬜';

    return `${tp30} 30% | ${tp60} 60% | ${tp100} 100% | ${tp200} 200%`;
  }
}
