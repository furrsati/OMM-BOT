import { logger } from '../utils/logger';
import type { Trade, CategoryWeights } from '../types';

/**
 * LEARNING ENGINE - LEVEL 2: WEIGHT ADJUSTMENT
 *
 * "Learn what matters most and what matters least"
 *
 * Every conviction score is calculated from 5 weighted categories.
 * This module recalculates optimal weights every 50 trades based on
 * which categories best predict winning vs losing trades.
 *
 * Phase 1 Implementation: SKELETON/STUB
 * - Defines interfaces and structure
 * - Returns default weights
 * - Full implementation in Phase 7
 *
 * From CLAUDE.MD Category 15:
 * "Every 2 weeks (or after every 50 trades, whichever comes first), the Learning
 * Engine recalculates optimal weights using OUTCOME CORRELATION ANALYSIS"
 */

export class WeightOptimizer {
  // Default category weights from CLAUDE.MD
  private readonly DEFAULT_WEIGHTS: CategoryWeights = {
    smartWallet: 30,    // Smart Wallet Signal
    tokenSafety: 25,    // Token Safety
    marketConditions: 15, // Market Conditions
    socialSignals: 10,  // Social Signals
    entryQuality: 20    // Entry Quality
  };

  // Weight adjustment constraints (safety guardrails)
  private readonly MIN_WEIGHT = 5;
  private readonly MAX_WEIGHT = 40;
  private readonly MAX_ADJUSTMENT_PER_CYCLE = 5;

  /**
   * Recalculate category weights based on recent trade outcomes
   *
   * From CLAUDE.MD:
   * "For each category, measure:
   *  - What was the average score in this category for WINNING trades?
   *  - What was the average score in this category for LOSING trades?
   *  - What is the SPREAD between them?
   *
   *  Categories with a LARGE spread are highly predictive → INCREASE weight
   *  Categories with a SMALL spread are weakly predictive → DECREASE weight"
   *
   * Constraints:
   * - No single category above 40% or below 5%
   * - All weights must sum to 100%
   * - Maximum adjustment per cycle: ±5% per category
   */
  async recalculateWeights(recentTrades: Trade[]): Promise<CategoryWeights> {
    logger.info('📊 Recalculating category weights (STUB)', {
      tradeCount: recentTrades.length,
      minRequired: 50
    });

    // STUB: Return default weights
    // Phase 7: Implement actual correlation analysis

    if (recentTrades.length < 30) {
      logger.warn('⚠️ Insufficient trades for weight adjustment', {
        count: recentTrades.length,
        required: 30
      });
      return this.DEFAULT_WEIGHTS;
    }

    // TODO Phase 7: Implement correlation analysis
    // 1. Group trades by outcome (WIN vs LOSS)
    // 2. For each category, calculate avg score on wins vs losses
    // 3. Calculate spread (predictive power)
    // 4. Adjust weights within constraints
    // 5. Normalize to sum to 100%
    // 6. Log changes and alert operator

    const currentWeights = await this.getCurrentWeights();

    logger.info('Using current weights (STUB - no adjustment yet)', {
      weights: currentWeights
    });

    return currentWeights;
  }

  /**
   * Get current active weights
   */
  async getCurrentWeights(): Promise<CategoryWeights> {
    // STUB: Return defaults
    // Phase 7: Query from bot_parameters table

    logger.debug('Fetching current weights (STUB)', {
      weights: this.DEFAULT_WEIGHTS
    });

    return { ...this.DEFAULT_WEIGHTS };
  }

  /**
   * Save new weights to database
   */
  private async saveWeights(
    weights: CategoryWeights,
    reason: string
  ): Promise<void> {
    logger.info('💾 Saving new weights (STUB)', {
      weights,
      reason
    });

    // STUB: Log only
    // Phase 7: Insert into bot_parameters table
    // - Version increments
    // - Set is_active = true, previous versions = false
    // - Log full change history

  }

  /**
   * Analyze individual rule effectiveness
   *
   * From CLAUDE.MD:
   * "Every individual rule (e.g., 'liquidity locked = +15 points') gets tracked:
   *  - How many winning trades had this rule trigger positively?
   *  - How many losing trades had this rule trigger positively?
   *  - What is this rule's PREDICTIVE POWER?"
   */
  async analyzeRuleEffectiveness(trades: Trade[]): Promise<any[]> {
    logger.info('📋 Analyzing rule effectiveness (STUB)', {
      tradeCount: trades.length
    });

    // STUB: Return empty array
    // Phase 7: Implement rule tracking
    // - Track each rule's win/loss correlation
    // - Calculate predictive power for each rule
    // - Flag rules that are counterproductive
    // - Adjust point values within constraints (±3 points max)

    logger.debug('Rule effectiveness analysis would happen here (STUB)');
    return [];
  }

  /**
   * Adjust individual rule point values
   */
  private async adjustRulePoints(
    ruleId: string,
    currentPoints: number,
    newPoints: number,
    reason: string
  ): Promise<void> {
    logger.info('🔧 Adjusting rule points (STUB)', {
      ruleId,
      currentPoints,
      newPoints,
      reason
    });

    // STUB: Log only
    // Phase 7: Update rule configuration
    // - Max ±3 points per cycle
    // - Hard reject rules NEVER weakened
    // - Log all adjustments

  }

  /**
   * Check if weight adjustment cycle is due
   *
   * Runs every 50 trades or 2 weeks, whichever comes first
   */
  async isAdjustmentDue(): Promise<boolean> {
    // STUB: Return false
    // Phase 7: Check last adjustment timestamp and trade count

    logger.debug('Checking if weight adjustment is due (STUB)');
    return false;
  }

  /**
   * Execute full weight optimization cycle
   *
   * Called automatically every 50 trades
   */
  async executeOptimizationCycle(): Promise<void> {
    logger.info('🔄 Executing weight optimization cycle (STUB)');

    try {
      // Get last 50 trades
      const recentTrades = await this.getRecentTrades(50);

      if (recentTrades.length < 30) {
        logger.warn('Skipping optimization - insufficient data', {
          trades: recentTrades.length,
          required: 30
        });
        return;
      }

      // Recalculate weights
      const newWeights = await this.recalculateWeights(recentTrades);

      // Analyze rules
      await this.analyzeRuleEffectiveness(recentTrades);

      logger.info('✅ Optimization cycle completed (STUB)', {
        newWeights
      });

    } catch (error: any) {
      logger.error('Weight optimization cycle failed', {
        error: error.message
      });
    }
  }

  /**
   * Get recent trades from database
   */
  private async getRecentTrades(limit: number): Promise<Trade[]> {
    // STUB: Return empty array
    // Phase 7: Query from trades table

    logger.debug('Fetching recent trades (STUB)', { limit });
    return [];
  }

  /**
   * Calculate weight drift from baseline
   *
   * From CLAUDE.MD:
   * "Track how far current weights/parameters have drifted from the ORIGINAL
   * baseline. If total drift exceeds threshold (e.g., cumulative 50% change),
   * alert operator for manual review."
   */
  async calculateWeightDrift(
    currentWeights: CategoryWeights
  ): Promise<number> {
    const baseline = this.DEFAULT_WEIGHTS;

    const totalDrift = Object.keys(baseline).reduce((sum, key) => {
      const k = key as keyof CategoryWeights;
      const drift = Math.abs(currentWeights[k] - baseline[k]);
      return sum + drift;
    }, 0);

    if (totalDrift > 50) {
      logger.warn('⚠️ Significant weight drift detected', {
        totalDrift,
        threshold: 50,
        currentWeights,
        baseline
      });
    }

    return totalDrift;
  }
}
