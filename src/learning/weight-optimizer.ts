import { logger } from '../utils/logger';
import { query, transaction } from '../db/postgres';
import type { Trade, CategoryWeights, TradeFingerprint } from '../types';

/**
 * LEARNING ENGINE - LEVEL 2: WEIGHT ADJUSTMENT
 *
 * "Learn what matters most and what matters least"
 *
 * Every conviction score is calculated from 5 weighted categories.
 * This module recalculates optimal weights every 50 trades based on
 * which categories best predict winning vs losing trades.
 *
 * From CLAUDE.MD Category 15:
 * "Every 2 weeks (or after every 50 trades, whichever comes first), the Learning
 * Engine recalculates optimal weights using OUTCOME CORRELATION ANALYSIS"
 */

interface CategoryStats {
  avgOnWins: number;
  avgOnLosses: number;
  spread: number;
  predictivePower: number;
  sampleSizeWins: number;
  sampleSizeLosses: number;
}

interface WeightAdjustment {
  category: keyof CategoryWeights;
  oldWeight: number;
  newWeight: number;
  reason: string;
  predictivePower: number;
}

interface RuleEffectiveness {
  ruleId: string;
  ruleName: string;
  winCorrelation: number;
  lossCorrelation: number;
  predictivePower: number;
  recommendedAction: 'keep' | 'increase' | 'decrease' | 'review';
  currentPoints: number;
  suggestedPoints: number;
}

export class WeightOptimizer {
  // Default category weights from CLAUDE.MD
  private readonly DEFAULT_WEIGHTS: CategoryWeights = {
    smartWallet: 30,
    tokenSafety: 25,
    marketConditions: 15,
    socialSignals: 10,
    entryQuality: 20
  };

  // Weight adjustment constraints (safety guardrails)
  private readonly MIN_WEIGHT = 5;
  private readonly MAX_WEIGHT = 40;
  private readonly MAX_ADJUSTMENT_PER_CYCLE = 5;
  private readonly MIN_TRADES_FOR_ADJUSTMENT = 10; // Reduced from 30 for faster learning
  private readonly STATISTICAL_SIGNIFICANCE_THRESHOLD = 0.1; // p-value

  /**
   * Recalculate category weights based on recent trade outcomes
   */
  async recalculateWeights(recentTrades: Trade[]): Promise<CategoryWeights> {
    logger.info('📊 Recalculating category weights', {
      tradeCount: recentTrades.length
    });

    if (recentTrades.length < this.MIN_TRADES_FOR_ADJUSTMENT) {
      logger.warn('⚠️ Insufficient trades for weight adjustment', {
        count: recentTrades.length,
        required: this.MIN_TRADES_FOR_ADJUSTMENT
      });
      return this.getCurrentWeights();
    }

    // Check for frozen weights
    const frozenWeights = await this.getFrozenWeights();

    // Get current weights
    const currentWeights = await this.getCurrentWeights();

    // 1. Group trades by outcome (WIN vs LOSS)
    const wins = recentTrades.filter(t => t.outcome === 'WIN');
    const losses = recentTrades.filter(t => t.outcome === 'LOSS' || t.outcome === 'RUG');

    if (wins.length < 5 || losses.length < 5) {
      logger.warn('⚠️ Insufficient wins or losses for analysis', {
        wins: wins.length,
        losses: losses.length
      });
      return currentWeights;
    }

    // 2. For each category, calculate avg score on wins vs losses
    const categoryStats = this.calculateCategoryStats(wins, losses);

    // 3. Calculate spread (predictive power) for each category
    const adjustments: WeightAdjustment[] = [];

    for (const [category, stats] of Object.entries(categoryStats)) {
      const cat = category as keyof CategoryWeights;

      // Skip frozen weights
      if (frozenWeights.includes(cat)) {
        logger.debug(`Skipping frozen weight: ${cat}`);
        continue;
      }

      // Check statistical significance
      if (!this.isStatisticallySignificant(stats)) {
        logger.debug(`Category ${cat} not statistically significant`, { stats });
        continue;
      }

      // Calculate weight adjustment based on predictive power
      const adjustment = this.calculateWeightAdjustment(
        cat,
        currentWeights[cat],
        stats,
        categoryStats
      );

      if (adjustment) {
        adjustments.push(adjustment);
      }
    }

    // 4. Apply adjustments within constraints
    const newWeights = this.applyAdjustments(currentWeights, adjustments, frozenWeights);

    // 5. Normalize to sum to 100%
    const normalizedWeights = this.normalizeWeights(newWeights);

    // 6. Log changes and save
    if (this.hasSignificantChanges(currentWeights, normalizedWeights)) {
      await this.saveWeights(normalizedWeights, adjustments, recentTrades.length);
      logger.info('✅ Weights adjusted', {
        old: currentWeights,
        new: normalizedWeights,
        adjustments: adjustments.map(a => ({
          category: a.category,
          change: a.newWeight - a.oldWeight,
          reason: a.reason
        }))
      });
    } else {
      logger.info('No significant weight changes needed', { currentWeights });
    }

    return normalizedWeights;
  }

  /**
   * Calculate statistics for each category based on wins vs losses
   */
  private calculateCategoryStats(
    wins: Trade[],
    losses: Trade[]
  ): Record<keyof CategoryWeights, CategoryStats> {
    const categories: (keyof CategoryWeights)[] = [
      'smartWallet',
      'tokenSafety',
      'marketConditions',
      'socialSignals',
      'entryQuality'
    ];

    const stats: Record<string, CategoryStats> = {};

    for (const category of categories) {
      const winScores = wins.map(t => this.getCategoryScore(t.fingerprint, category));
      const lossScores = losses.map(t => this.getCategoryScore(t.fingerprint, category));

      const avgOnWins = this.average(winScores);
      const avgOnLosses = this.average(lossScores);
      const spread = avgOnWins - avgOnLosses;

      // Calculate predictive power (normalized spread)
      // Higher spread = more predictive
      const maxPossibleSpread = 100; // Scores are 0-100
      const predictivePower = Math.abs(spread) / maxPossibleSpread;

      stats[category] = {
        avgOnWins,
        avgOnLosses,
        spread,
        predictivePower,
        sampleSizeWins: wins.length,
        sampleSizeLosses: losses.length
      };
    }

    return stats as Record<keyof CategoryWeights, CategoryStats>;
  }

  /**
   * Extract category score from trade fingerprint
   */
  private getCategoryScore(fingerprint: TradeFingerprint, category: keyof CategoryWeights): number {
    switch (category) {
      case 'smartWallet': {
        // Score based on wallet count and tiers
        const walletCount = fingerprint.smartWallets?.count || 0;
        const tierBonus = (fingerprint.smartWallets?.tiers || []).reduce((sum, t) => {
          return sum + (t === 1 ? 40 : t === 2 ? 25 : 10);
        }, 0);
        return Math.min(100, walletCount * 15 + tierBonus / Math.max(1, walletCount));
      }

      case 'tokenSafety':
        return fingerprint.tokenSafety?.overallScore || 0;

      case 'marketConditions': {
        // Score based on regime and trends
        const regimeScore = {
          'FULL': 80,
          'CAUTIOUS': 50,
          'DEFENSIVE': 25,
          'PAUSE': 0
        }[fingerprint.marketConditions?.regime || 'CAUTIOUS'] || 50;
        const trendBonus = fingerprint.marketConditions?.solTrend === 'up' ? 20 : 0;
        return Math.min(100, regimeScore + trendBonus);
      }

      case 'socialSignals': {
        // Normalize social metrics to 0-100
        const followers = Math.min(fingerprint.socialSignals?.twitterFollowers || 0, 100000);
        const members = Math.min(fingerprint.socialSignals?.telegramMembers || 0, 10000);
        const velocity = Math.min(fingerprint.socialSignals?.mentionVelocity || 0, 1000);
        return Math.min(100, (followers / 1000) + (members / 100) + (velocity / 10));
      }

      case 'entryQuality': {
        // Score based on dip depth, ATH distance, age, and phase
        const dipScore = this.dipDepthScore(fingerprint.entryQuality?.dipDepth || 0);
        const athScore = Math.min(100, (fingerprint.entryQuality?.distanceFromATH || 0) * 2);
        const phaseScore = {
          'DISCOVERY': 100,
          'EARLY_FOMO': 70,
          'PEAK_FOMO': 20,
          'DISTRIBUTION': 10,
          'DUMP': 0
        }[fingerprint.entryQuality?.hypePhase || 'EARLY_FOMO'] || 50;
        return (dipScore + athScore + phaseScore) / 3;
      }

      default:
        return 50;
    }
  }

  /**
   * Score dip depth (optimal is 20-30%)
   */
  private dipDepthScore(dipDepth: number): number {
    if (dipDepth >= 20 && dipDepth <= 30) return 100;
    if (dipDepth >= 15 && dipDepth <= 35) return 75;
    if (dipDepth >= 10 && dipDepth <= 40) return 50;
    return 25;
  }

  /**
   * Check if category stats are statistically significant
   */
  private isStatisticallySignificant(stats: CategoryStats): boolean {
    // Simple significance check: need enough samples and meaningful spread
    const minSamples = 5;
    const minSpread = 5; // 5% difference

    return (
      stats.sampleSizeWins >= minSamples &&
      stats.sampleSizeLosses >= minSamples &&
      Math.abs(stats.spread) >= minSpread
    );
  }

  /**
   * Calculate weight adjustment for a category
   */
  private calculateWeightAdjustment(
    category: keyof CategoryWeights,
    currentWeight: number,
    stats: CategoryStats,
    allStats: Record<keyof CategoryWeights, CategoryStats>
  ): WeightAdjustment | null {
    // Calculate relative predictive power
    const totalPredictivePower = Object.values(allStats).reduce(
      (sum, s) => sum + s.predictivePower,
      0
    );
    const relativePower = stats.predictivePower / Math.max(0.01, totalPredictivePower);

    // Ideal weight based on predictive power
    const idealWeight = relativePower * 100;

    // Calculate adjustment (limited to MAX_ADJUSTMENT_PER_CYCLE)
    const rawAdjustment = idealWeight - currentWeight;
    const limitedAdjustment = Math.sign(rawAdjustment) *
      Math.min(Math.abs(rawAdjustment), this.MAX_ADJUSTMENT_PER_CYCLE);

    // Skip tiny adjustments
    if (Math.abs(limitedAdjustment) < 1) {
      return null;
    }

    const newWeight = Math.max(
      this.MIN_WEIGHT,
      Math.min(this.MAX_WEIGHT, currentWeight + limitedAdjustment)
    );

    // Determine reason
    let reason: string;
    if (stats.spread > 10) {
      reason = `High predictive power: avg score ${stats.avgOnWins.toFixed(1)} on wins vs ${stats.avgOnLosses.toFixed(1)} on losses`;
    } else if (stats.spread < -10) {
      reason = `Inverse correlation detected: higher scores correlate with losses`;
    } else {
      reason = `Adjusted based on predictive power analysis (spread: ${stats.spread.toFixed(1)})`;
    }

    return {
      category,
      oldWeight: currentWeight,
      newWeight,
      reason,
      predictivePower: stats.predictivePower
    };
  }

  /**
   * Apply adjustments within constraints
   */
  private applyAdjustments(
    currentWeights: CategoryWeights,
    adjustments: WeightAdjustment[],
    frozenWeights: string[]
  ): CategoryWeights {
    const newWeights = { ...currentWeights };

    for (const adj of adjustments) {
      if (!frozenWeights.includes(adj.category)) {
        newWeights[adj.category] = adj.newWeight;
      }
    }

    return newWeights;
  }

  /**
   * Normalize weights to sum to 100%
   */
  private normalizeWeights(weights: CategoryWeights): CategoryWeights {
    const total = Object.values(weights).reduce((sum, w) => sum + w, 0);

    if (Math.abs(total - 100) < 0.01) {
      return weights;
    }

    const factor = 100 / total;
    return {
      smartWallet: Math.round(weights.smartWallet * factor * 10) / 10,
      tokenSafety: Math.round(weights.tokenSafety * factor * 10) / 10,
      marketConditions: Math.round(weights.marketConditions * factor * 10) / 10,
      socialSignals: Math.round(weights.socialSignals * factor * 10) / 10,
      entryQuality: Math.round(weights.entryQuality * factor * 10) / 10
    };
  }

  /**
   * Check if changes are significant enough to save
   */
  private hasSignificantChanges(
    oldWeights: CategoryWeights,
    newWeights: CategoryWeights
  ): boolean {
    const totalChange = Object.keys(oldWeights).reduce((sum, key) => {
      const k = key as keyof CategoryWeights;
      return sum + Math.abs(newWeights[k] - oldWeights[k]);
    }, 0);

    return totalChange >= 2; // At least 2% total change
  }

  /**
   * Get current active weights from database
   * Returns weights as decimals (0.30 for 30%) for proper multiplication
   */
  async getCurrentWeights(): Promise<CategoryWeights> {
    let weights: CategoryWeights;

    try {
      const result = await query<{ weights: CategoryWeights }>(
        `SELECT weights FROM learning_snapshots
         ORDER BY version DESC
         LIMIT 1`
      );

      if (result.rows.length > 0 && result.rows[0].weights) {
        weights = result.rows[0].weights;
      } else {
        weights = { ...this.DEFAULT_WEIGHTS };
      }
    } catch (error: any) {
      logger.debug('Error fetching current weights', { error: error.message });
      weights = { ...this.DEFAULT_WEIGHTS };
    }

    // CRITICAL FIX: Convert weights from percentages (30) to decimals (0.30)
    // This ensures proper conviction score calculation
    // Weights are stored as percentages (30, 25, 15, 10, 20) but need to be
    // decimals for multiplication (0.30, 0.25, 0.15, 0.10, 0.20)
    return {
      smartWallet: weights.smartWallet > 1 ? weights.smartWallet / 100 : weights.smartWallet,
      tokenSafety: weights.tokenSafety > 1 ? weights.tokenSafety / 100 : weights.tokenSafety,
      marketConditions: weights.marketConditions > 1 ? weights.marketConditions / 100 : weights.marketConditions,
      socialSignals: weights.socialSignals > 1 ? weights.socialSignals / 100 : weights.socialSignals,
      entryQuality: weights.entryQuality > 1 ? weights.entryQuality / 100 : weights.entryQuality
    };
  }

  /**
   * Get list of frozen (locked) weight categories
   */
  private async getFrozenWeights(): Promise<string[]> {
    try {
      const result = await query<{ parameter_name: string }>(
        `SELECT parameter_name FROM frozen_parameters
         WHERE parameter_name LIKE 'weight_%'`
      );

      return result.rows.map(r => r.parameter_name.replace('weight_', ''));
    } catch (error: any) {
      logger.debug('Error fetching frozen weights', { error: error.message });
      return [];
    }
  }

  /**
   * Save new weights to database
   */
  private async saveWeights(
    weights: CategoryWeights,
    adjustments: WeightAdjustment[],
    tradeCount: number
  ): Promise<void> {
    try {
      await transaction(async (client) => {
        // Get current version
        const versionResult = await client.query(
          `SELECT COALESCE(MAX(version), 0) + 1 as next_version FROM learning_snapshots`
        );
        const nextVersion = versionResult.rows[0].next_version;

        // Get current performance metrics
        const metricsResult = await client.query(`
          SELECT
            COUNT(*) as trade_count,
            COUNT(CASE WHEN outcome = 'WIN' THEN 1 END)::float / NULLIF(COUNT(*), 0) as win_rate,
            COALESCE(SUM(CASE WHEN outcome = 'WIN' THEN profit_loss ELSE 0 END), 0) /
            NULLIF(ABS(SUM(CASE WHEN outcome IN ('LOSS', 'RUG') THEN profit_loss ELSE 0 END)), 1) as profit_factor
          FROM trades
          WHERE exit_time IS NOT NULL
          AND entry_time > NOW() - INTERVAL '30 days'
        `);

        const metrics = metricsResult.rows[0];

        // Insert new snapshot
        await client.query(
          `INSERT INTO learning_snapshots (version, weights, parameters, trade_count, win_rate, profit_factor)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            nextVersion,
            JSON.stringify(weights),
            JSON.stringify({ adjustments }),
            tradeCount,
            metrics.win_rate || 0,
            metrics.profit_factor || 0
          ]
        );

        // Record weight adjustments
        await client.query(
          `INSERT INTO learning_weights (version, weights, reason, trade_count)
           VALUES ($1, $2, $3, $4)`,
          [
            nextVersion,
            JSON.stringify(weights),
            adjustments.map(a => a.reason).join('; '),
            tradeCount
          ]
        );

        logger.info('💾 Saved new weights', {
          version: nextVersion,
          weights,
          adjustmentCount: adjustments.length
        });
      });
    } catch (error: any) {
      logger.error('Failed to save weights', { error: error.message });
      throw error;
    }
  }

  /**
   * Analyze individual rule effectiveness
   */
  async analyzeRuleEffectiveness(trades: Trade[]): Promise<RuleEffectiveness[]> {
    logger.info('📋 Analyzing rule effectiveness', {
      tradeCount: trades.length
    });

    if (trades.length < this.MIN_TRADES_FOR_ADJUSTMENT) {
      logger.warn('Insufficient trades for rule analysis');
      return [];
    }

    const wins = trades.filter(t => t.outcome === 'WIN');
    const losses = trades.filter(t => t.outcome === 'LOSS' || t.outcome === 'RUG');

    const rules = this.defineRules();
    const effectiveness: RuleEffectiveness[] = [];

    for (const rule of rules) {
      const winsTrigger = wins.filter(t => rule.check(t.fingerprint)).length;
      const lossesTrigger = losses.filter(t => rule.check(t.fingerprint)).length;

      const winCorrelation = winsTrigger / Math.max(1, wins.length);
      const lossCorrelation = lossesTrigger / Math.max(1, losses.length);
      const predictivePower = winCorrelation - lossCorrelation;

      let recommendedAction: 'keep' | 'increase' | 'decrease' | 'review';
      let suggestedPoints = rule.currentPoints;

      if (predictivePower > 0.2) {
        recommendedAction = 'increase';
        suggestedPoints = Math.min(rule.currentPoints + 3, rule.maxPoints);
      } else if (predictivePower < -0.1) {
        recommendedAction = 'review';
        suggestedPoints = Math.max(rule.currentPoints - 3, rule.minPoints);
      } else if (Math.abs(predictivePower) < 0.05) {
        recommendedAction = 'decrease';
        suggestedPoints = Math.max(rule.currentPoints - 2, rule.minPoints);
      } else {
        recommendedAction = 'keep';
      }

      effectiveness.push({
        ruleId: rule.id,
        ruleName: rule.name,
        winCorrelation,
        lossCorrelation,
        predictivePower,
        recommendedAction,
        currentPoints: rule.currentPoints,
        suggestedPoints
      });
    }

    // Log rules that need attention
    const needsReview = effectiveness.filter(e => e.recommendedAction === 'review');
    if (needsReview.length > 0) {
      logger.warn('⚠️ Rules flagged for review (may be counterproductive)', {
        rules: needsReview.map(r => ({
          name: r.ruleName,
          predictivePower: r.predictivePower.toFixed(3)
        }))
      });
    }

    return effectiveness;
  }

  /**
   * Define safety rules for tracking
   */
  private defineRules(): Array<{
    id: string;
    name: string;
    check: (fp: TradeFingerprint) => boolean;
    currentPoints: number;
    maxPoints: number;
    minPoints: number;
  }> {
    return [
      {
        id: 'liquidity_locked',
        name: 'Liquidity is locked',
        check: (fp) => fp.tokenSafety?.liquidityLocked === true,
        currentPoints: 15,
        maxPoints: 20,
        minPoints: 5
      },
      {
        id: 'liquidity_depth',
        name: 'Liquidity depth >= $50K',
        check: (fp) => (fp.tokenSafety?.liquidityDepth || 0) >= 50000,
        currentPoints: 10,
        maxPoints: 15,
        minPoints: 5
      },
      {
        id: 'no_mint_authority',
        name: 'No mint authority',
        check: (fp) => fp.tokenSafety?.mintAuthority === false,
        currentPoints: 10,
        maxPoints: 15,
        minPoints: 5
      },
      {
        id: 'no_freeze_authority',
        name: 'No freeze authority',
        check: (fp) => fp.tokenSafety?.freezeAuthority === false,
        currentPoints: 10,
        maxPoints: 15,
        minPoints: 5
      },
      {
        id: 'discovery_phase',
        name: 'In discovery phase',
        check: (fp) => fp.entryQuality?.hypePhase === 'DISCOVERY',
        currentPoints: 15,
        maxPoints: 20,
        minPoints: 5
      },
      {
        id: 'optimal_dip',
        name: 'Optimal dip depth (20-30%)',
        check: (fp) => {
          const dip = fp.entryQuality?.dipDepth || 0;
          return dip >= 20 && dip <= 30;
        },
        currentPoints: 10,
        maxPoints: 15,
        minPoints: 5
      },
      {
        id: 'full_market_regime',
        name: 'Full market regime',
        check: (fp) => fp.marketConditions?.regime === 'FULL',
        currentPoints: 10,
        maxPoints: 15,
        minPoints: 5
      },
      {
        id: 'tier1_wallets',
        name: '3+ Tier 1 wallets',
        check: (fp) => {
          const tier1Count = (fp.smartWallets?.tiers || []).filter(t => t === 1).length;
          return tier1Count >= 3;
        },
        currentPoints: 20,
        maxPoints: 25,
        minPoints: 10
      }
    ];
  }

  /**
   * Check if weight adjustment cycle is due
   */
  async isAdjustmentDue(): Promise<boolean> {
    try {
      // Check last cycle timestamp
      const lastCycleResult = await query<{ created_at: Date; trade_count_at_cycle: number }>(
        `SELECT created_at, trade_count_at_cycle FROM learning_cycles
         WHERE cycle_type = 'weight_optimization'
         AND status = 'completed'
         ORDER BY created_at DESC
         LIMIT 1`
      );

      // Check current trade count
      const tradeCountResult = await query<{ count: string }>(
        `SELECT COUNT(*) as count FROM trades WHERE exit_time IS NOT NULL`
      );

      const currentTradeCount = parseInt(tradeCountResult.rows[0].count);

      if (lastCycleResult.rows.length === 0) {
        // No previous cycle - check if we have enough trades
        return currentTradeCount >= 50;
      }

      const lastCycle = lastCycleResult.rows[0];
      const daysSinceLastCycle = (Date.now() - new Date(lastCycle.created_at).getTime()) / (1000 * 60 * 60 * 24);
      const tradesSinceLastCycle = currentTradeCount - lastCycle.trade_count_at_cycle;

      // Due if 14 days passed OR 50 trades since last cycle
      return daysSinceLastCycle >= 14 || tradesSinceLastCycle >= 50;
    } catch (error: any) {
      logger.debug('Error checking if adjustment is due', { error: error.message });
      return false;
    }
  }

  /**
   * Execute full weight optimization cycle
   */
  async executeOptimizationCycle(): Promise<void> {
    logger.info('🔄 Executing weight optimization cycle');

    const startTime = Date.now();
    let cycleId: string | null = null;

    try {
      // Record cycle start
      const cycleResult = await query<{ id: string; cycle_number: number }>(
        `INSERT INTO learning_cycles (cycle_number, cycle_type, trade_count_at_cycle, status)
         SELECT COALESCE(MAX(cycle_number), 0) + 1, 'weight_optimization',
                (SELECT COUNT(*) FROM trades WHERE exit_time IS NOT NULL), 'running'
         FROM learning_cycles
         RETURNING id, cycle_number`
      );
      cycleId = cycleResult.rows[0].id;

      // Get recent trades - reduced for memory
      const recentTrades = await this.getRecentTrades(30);

      if (recentTrades.length < this.MIN_TRADES_FOR_ADJUSTMENT) {
        logger.warn('Skipping optimization - insufficient data', {
          trades: recentTrades.length,
          required: this.MIN_TRADES_FOR_ADJUSTMENT
        });

        await query(
          `UPDATE learning_cycles SET status = 'completed', completed_at = NOW(),
           duration_ms = $1, error_message = 'Insufficient trades'
           WHERE id = $2`,
          [Date.now() - startTime, cycleId]
        );
        return;
      }

      // Recalculate weights
      const newWeights = await this.recalculateWeights(recentTrades);

      // Analyze rules
      const ruleEffectiveness = await this.analyzeRuleEffectiveness(recentTrades);

      // Count adjustments
      const currentWeights = await this.getCurrentWeights();
      const adjustmentCount = Object.keys(currentWeights).filter(k => {
        const key = k as keyof CategoryWeights;
        return Math.abs(newWeights[key] - currentWeights[key]) >= 1;
      }).length;

      // Update cycle status
      await query(
        `UPDATE learning_cycles
         SET status = 'completed', completed_at = NOW(),
             duration_ms = $1, adjustments_made = $2
         WHERE id = $3`,
        [Date.now() - startTime, adjustmentCount, cycleId]
      );

      logger.info('✅ Optimization cycle completed', {
        durationMs: Date.now() - startTime,
        newWeights,
        rulesAnalyzed: ruleEffectiveness.length,
        adjustments: adjustmentCount
      });

    } catch (error: any) {
      logger.error('Weight optimization cycle failed', {
        error: error.message
      });

      if (cycleId) {
        await query(
          `UPDATE learning_cycles
           SET status = 'failed', completed_at = NOW(),
               duration_ms = $1, error_message = $2
           WHERE id = $3`,
          [Date.now() - startTime, error.message, cycleId]
        );
      }

      throw error;
    }
  }

  /**
   * Get recent trades from database
   */
  private async getRecentTrades(limit: number): Promise<Trade[]> {
    try {
      const result = await query<{
        id: string;
        token_address: string;
        entry_price: string;
        entry_amount: string;
        entry_time: Date;
        exit_price: string | null;
        exit_amount: string | null;
        exit_time: Date | null;
        exit_reason: string | null;
        profit_loss: string | null;
        profit_loss_percent: string | null;
        conviction_score: string;
        fingerprint: TradeFingerprint;
        outcome: string | null;
      }>(
        `SELECT * FROM trades
         WHERE exit_time IS NOT NULL
         AND outcome IS NOT NULL
         ORDER BY exit_time DESC
         LIMIT $1`,
        [limit]
      );

      return result.rows.map(row => ({
        id: row.id,
        tokenAddress: row.token_address,
        entryPrice: parseFloat(row.entry_price),
        entryAmount: parseFloat(row.entry_amount),
        entryTime: row.entry_time,
        exitPrice: row.exit_price ? parseFloat(row.exit_price) : undefined,
        exitAmount: row.exit_amount ? parseFloat(row.exit_amount) : undefined,
        exitTime: row.exit_time || undefined,
        exitReason: row.exit_reason as Trade['exitReason'],
        profitLoss: row.profit_loss ? parseFloat(row.profit_loss) : undefined,
        profitLossPercent: row.profit_loss_percent ? parseFloat(row.profit_loss_percent) : undefined,
        convictionScore: parseFloat(row.conviction_score),
        fingerprint: row.fingerprint,
        outcome: row.outcome as Trade['outcome']
      }));
    } catch (error: any) {
      logger.error('Error fetching recent trades', { error: error.message });
      return [];
    }
  }

  /**
   * Calculate weight drift from baseline
   */
  async calculateWeightDrift(currentWeights: CategoryWeights): Promise<number> {
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

  /**
   * Reset weights to default
   */
  async resetToDefault(category?: keyof CategoryWeights): Promise<CategoryWeights> {
    if (category) {
      const current = await this.getCurrentWeights();
      current[category] = this.DEFAULT_WEIGHTS[category];
      const normalized = this.normalizeWeights(current);
      await this.saveWeights(normalized, [{
        category,
        oldWeight: current[category],
        newWeight: this.DEFAULT_WEIGHTS[category],
        reason: 'Manual reset to default',
        predictivePower: 0
      }], 0);
      return normalized;
    }

    await this.saveWeights(this.DEFAULT_WEIGHTS, [{
      category: 'smartWallet',
      oldWeight: 0,
      newWeight: 30,
      reason: 'Full reset to defaults',
      predictivePower: 0
    }], 0);

    return { ...this.DEFAULT_WEIGHTS };
  }

  /**
   * Utility: Calculate average
   */
  private average(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
  }
}
