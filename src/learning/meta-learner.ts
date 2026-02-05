import { logger, logLearningEngineAdjustment } from '../utils/logger';
import { db } from '../db/postgres';
import type { CategoryWeights } from '../types';

/**
 * LEARNING ENGINE - LEVEL 4: META-LEARNING
 *
 * "The Learning Engine learns about itself"
 *
 * This module evaluates whether the Learning Engine's own adjustments
 * are actually helping or hurting performance. If changes make things
 * worse, it reverts them and slows down the learning rate.
 *
 * Phase 1 Implementation: SKELETON/STUB
 * - Defines interfaces and structure
 * - Logs intent only
 * - Full implementation in Phase 7
 *
 * From CLAUDE.MD Category 15:
 * "Track the IMPACT of every Learning Engine adjustment. After each
 * weight/parameter change, measure performance for the next 50 trades.
 * Did the adjustment IMPROVE win rate and profit factor? → Keep it
 * Did it make things WORSE? → Revert to previous value
 * Did it make no difference? → Revert (unnecessary complexity)"
 */

export interface LearningSnapshot {
  id?: number;
  version: number;
  weights: CategoryWeights;
  parameters: Record<string, any>;
  timestamp: Date;
  performance?: PerformanceMetrics;
}

export interface PerformanceMetrics {
  winRate: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  totalTrades: number;
}

export interface LearningImpact {
  before: PerformanceMetrics;
  after: PerformanceMetrics;
  improved: boolean;
  degraded: boolean;
  neutral: boolean;
  reason: string;
}

export class MetaLearner {
  private readonly MIN_TRADES_FOR_EVALUATION = 50;
  private readonly PERFORMANCE_THRESHOLD = 0.05; // 5% change to be considered significant

  /**
   * Evaluate impact of recent learning adjustments
   *
   * From CLAUDE.MD:
   * "After each weight/parameter change, measure performance for the next
   * 50 trades. Did the adjustment IMPROVE win rate and profit factor?"
   */
  async evaluateLearningImpact(
    before: LearningSnapshot,
    after: LearningSnapshot
  ): Promise<LearningImpact> {
    logger.info('🧠 Evaluating learning impact (STUB)', {
      beforeVersion: before.version,
      afterVersion: after.version
    });

    // STUB: Return neutral impact
    // Phase 7: Implement actual performance comparison

    const beforeMetrics = before.performance || this.getEmptyMetrics();
    const afterMetrics = after.performance || this.getEmptyMetrics();

    // Calculate changes
    const winRateChange = afterMetrics.winRate - beforeMetrics.winRate;
    const profitFactorChange = afterMetrics.profitFactor - beforeMetrics.profitFactor;

    // Determine if change was beneficial
    const improved = winRateChange > this.PERFORMANCE_THRESHOLD ||
                     profitFactorChange > this.PERFORMANCE_THRESHOLD;

    const degraded = winRateChange < -this.PERFORMANCE_THRESHOLD ||
                     profitFactorChange < -this.PERFORMANCE_THRESHOLD;

    const neutral = !improved && !degraded;

    const reason = this.generateImpactReason(
      winRateChange,
      profitFactorChange,
      improved,
      degraded
    );

    const impact: LearningImpact = {
      before: beforeMetrics,
      after: afterMetrics,
      improved,
      degraded,
      neutral,
      reason
    };

    logger.info('Learning impact evaluation result (STUB)', {
      improved,
      degraded,
      neutral,
      reason
    });


    return impact;
  }

  /**
   * Adjust learning rate based on impact
   *
   * From CLAUDE.MD:
   * "If the Learning Engine's adjustments are consistently making things
   * worse, it automatically SLOWS DOWN its adjustment speed (reduces max
   * change per cycle from ±5% to ±3% to ±2%)"
   */
  async adjustLearningRate(impact: LearningImpact): Promise<void> {
    logger.info('⚙️ Adjusting learning rate (STUB)', {
      improved: impact.improved,
      degraded: impact.degraded
    });

    // STUB: Log only
    // Phase 7: Implement learning rate adjustment

    if (impact.degraded) {
      logger.warn('🔻 Learning adjustments degraded performance - slowing down', {
        reason: impact.reason
      });

      // TODO Phase 7:
      // - Reduce MAX_ADJUSTMENT_PER_CYCLE
      // - Consider reverting recent changes
      // - Alert operator

    } else if (impact.improved) {
      logger.info('📈 Learning adjustments improved performance - maintaining rate', {
        reason: impact.reason
      });

      // TODO Phase 7:
      // - Can slightly increase adjustment speed if consistently improving
      // - But never go above original limits (safety)

    } else {
      logger.debug('Neutral learning impact - no rate adjustment');
    }

  }

  /**
   * Create and store snapshot before making changes
   *
   * From CLAUDE.MD:
   * "Save full state every 50 trades. Keep last 10 snapshots.
   * One-command revert capability."
   */
  async createSnapshot(
    weights: CategoryWeights,
    parameters: Record<string, any>
  ): Promise<LearningSnapshot> {
    logger.info('📸 Creating learning snapshot (STUB)');

    const snapshot: LearningSnapshot = {
      version: await this.getNextVersion(),
      weights: { ...weights },
      parameters: { ...parameters },
      timestamp: new Date(),
      performance: await this.getCurrentPerformance()
    };

    // STUB: Log only
    // Phase 7: Store in learning_snapshots table

    logger.debug('Snapshot would be stored here (STUB)', {
      version: snapshot.version
    });

    return snapshot;
  }

  /**
   * Revert to previous snapshot
   *
   * From CLAUDE.MD:
   * "Operator can revert the bot to any previous state with a single command"
   */
  async revertToSnapshot(version: number): Promise<void> {
    logger.warn('⏪ Reverting to snapshot (STUB)', { version });

    // STUB: Log only
    // Phase 7:
    // - Load snapshot from database
    // - Restore weights and parameters
    // - Update bot_parameters table
    // - Log reversion
    // - Alert operator

    logger.debug('Reversion would happen here (STUB)');

  }

  /**
   * Get all available snapshots
   */
  async getAvailableSnapshots(): Promise<LearningSnapshot[]> {
    // STUB: Return empty array
    // Phase 7: Query from learning_snapshots table (last 10)

    logger.debug('Fetching available snapshots (STUB)');
    return [];
  }

  /**
   * Clean up old snapshots (keep last 10)
   */
  private async cleanupOldSnapshots(): Promise<void> {
    // STUB: Log only
    // Phase 7: Delete snapshots older than 10th most recent

    logger.debug('Cleaning up old snapshots (STUB)');
  }

  /**
   * Calculate current performance metrics
   */
  private async getCurrentPerformance(): Promise<PerformanceMetrics> {
    // STUB: Return default metrics
    // Phase 7: Query from trades table

    return this.getEmptyMetrics();
  }

  /**
   * Get next snapshot version number
   */
  private async getNextVersion(): Promise<number> {
    // STUB: Return 1
    // Phase 7: Query max version from learning_snapshots table

    return 1;
  }

  /**
   * Generate impact reason description
   */
  private generateImpactReason(
    winRateChange: number,
    profitFactorChange: number,
    improved: boolean,
    degraded: boolean
  ): string {
    if (improved) {
      return `Performance improved: Win rate ${winRateChange > 0 ? '+' : ''}${(winRateChange * 100).toFixed(1)}%, ` +
             `Profit factor ${profitFactorChange > 0 ? '+' : ''}${(profitFactorChange * 100).toFixed(1)}%`;
    } else if (degraded) {
      return `Performance degraded: Win rate ${(winRateChange * 100).toFixed(1)}%, ` +
             `Profit factor ${(profitFactorChange * 100).toFixed(1)}%`;
    } else {
      return `No significant change: Win rate ${(winRateChange * 100).toFixed(1)}%, ` +
             `Profit factor ${(profitFactorChange * 100).toFixed(1)}%`;
    }
  }

  /**
   * Get empty metrics structure
   */
  private getEmptyMetrics(): PerformanceMetrics {
    return {
      winRate: 0,
      profitFactor: 0,
      avgWin: 0,
      avgLoss: 0,
      totalTrades: 0
    };
  }

  /**
   * Check stability protection
   *
   * From CLAUDE.MD:
   * "The Learning Engine has a 'confidence threshold':
   *  - It needs at least 30 trades of data before making ANY adjustment
   *  - It needs at least 50 trades before making a SECOND adjustment to
   *    the same parameter
   *  - It never adjusts more than 3 parameters in the same cycle
   *  - This prevents overfitting to small sample sizes"
   */
  async checkStabilityProtection(): Promise<{
    canAdjust: boolean;
    reason: string;
  }> {
    logger.debug('Checking stability protection (STUB)');

    // STUB: Return allowed
    // Phase 7: Implement actual checks

    const tradeCount = await this.getRecentTradeCount();

    if (tradeCount < 30) {
      return {
        canAdjust: false,
        reason: `Insufficient data: ${tradeCount} trades (need 30 minimum)`
      };
    }

    return {
      canAdjust: true,
      reason: 'Sufficient data for adjustment'
    };
  }

  /**
   * Get recent trade count
   */
  private async getRecentTradeCount(): Promise<number> {
    // STUB: Return 0
    // Phase 7: Query from trades table

    return 0;
  }
}
