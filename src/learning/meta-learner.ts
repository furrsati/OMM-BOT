import { logger } from '../utils/logger';
import { query, transaction } from '../db/postgres';
import type { CategoryWeights, LearningSnapshot } from '../types';

/**
 * LEARNING ENGINE - LEVEL 4: META-LEARNING
 *
 * "The Learning Engine learns about itself"
 *
 * This module evaluates whether learning adjustments actually improved
 * performance, and can revert changes that made things worse. It also
 * adjusts the learning rate if changes are consistently counterproductive.
 *
 * From CLAUDE.MD Category 15:
 * "Track the IMPACT of every Learning Engine adjustment:
 *  - After each weight/parameter change, measure performance for the next 50 trades
 *  - Did the adjustment IMPROVE win rate and profit factor? → Keep it
 *  - Did it make things WORSE? → Revert to previous value
 *  - Did it make no difference? → Revert (unnecessary complexity)"
 */

interface PerformanceMetrics {
  tradeCount: number;
  winRate: number;
  profitFactor: number;
  avgReturn: number;
  totalPnl: number;
  timestamp: Date;
}

interface AdjustmentImpact {
  adjustmentId: string;
  adjustmentType: 'weight' | 'parameter';
  parameterName: string;
  beforeValue: any;
  afterValue: any;
  beforeMetrics: PerformanceMetrics;
  afterMetrics: PerformanceMetrics;
  improvement: boolean;
  impactScore: number;
  recommendation: 'keep' | 'revert' | 'monitor';
}

interface LearningHealthStatus {
  overallHealth: 'good' | 'warning' | 'critical';
  recentImprovementRate: number;
  consecutiveFailures: number;
  learningRateMultiplier: number;
  totalDrift: number;
  recommendation: string;
}

export class MetaLearner {
  private readonly MIN_TRADES_FOR_EVALUATION = 30;
  private readonly IMPROVEMENT_THRESHOLD = 0.02; // 2% improvement needed
  private readonly DEGRADATION_THRESHOLD = -0.05; // 5% degradation triggers revert
  private readonly MAX_CONSECUTIVE_FAILURES = 3;

  // Learning rate starts at 1.0 and adjusts based on performance
  private learningRateMultiplier = 1.0;

  /**
   * Evaluate the impact of recent learning adjustments
   */
  async evaluateAdjustmentImpacts(): Promise<AdjustmentImpact[]> {
    logger.info('🔍 Evaluating learning adjustment impacts');

    try {
      // Get recent adjustments that haven't been evaluated yet
      const unevaluatedAdjustments = await this.getUnevaluatedAdjustments();

      if (unevaluatedAdjustments.length === 0) {
        logger.info('No unevaluated adjustments to review');
        return [];
      }

      const impacts: AdjustmentImpact[] = [];

      for (const adjustment of unevaluatedAdjustments) {
        const impact = await this.evaluateSingleAdjustment(adjustment);
        if (impact) {
          impacts.push(impact);

          // Record the evaluation
          await this.recordImpactEvaluation(impact);

          // If the adjustment hurt performance, consider reverting
          if (impact.recommendation === 'revert') {
            logger.warn('⚠️ Adjustment degraded performance, recommending revert', {
              parameter: impact.parameterName,
              impactScore: impact.impactScore
            });
          }
        }
      }

      // Update learning health based on recent impacts
      await this.updateLearningHealth(impacts);

      return impacts;
    } catch (error: any) {
      logger.error('Error evaluating adjustment impacts', { error: error.message });
      return [];
    }
  }

  /**
   * Evaluate a single adjustment's impact
   */
  private async evaluateSingleAdjustment(adjustment: any): Promise<AdjustmentImpact | null> {
    try {
      // Get performance metrics before the adjustment
      const beforeMetrics = await this.getPerformanceMetrics(
        adjustment.created_at,
        'before',
        this.MIN_TRADES_FOR_EVALUATION
      );

      // Get performance metrics after the adjustment
      const afterMetrics = await this.getPerformanceMetrics(
        adjustment.created_at,
        'after',
        this.MIN_TRADES_FOR_EVALUATION
      );

      // Need enough trades to evaluate
      if (beforeMetrics.tradeCount < 20 || afterMetrics.tradeCount < 20) {
        logger.debug('Insufficient trades to evaluate adjustment', {
          adjustmentId: adjustment.id,
          beforeCount: beforeMetrics.tradeCount,
          afterCount: afterMetrics.tradeCount
        });
        return null;
      }

      // Calculate impact score
      const winRateChange = afterMetrics.winRate - beforeMetrics.winRate;
      const profitFactorChange = afterMetrics.profitFactor - beforeMetrics.profitFactor;
      const avgReturnChange = afterMetrics.avgReturn - beforeMetrics.avgReturn;

      // Weighted impact score
      const impactScore = (
        (winRateChange * 0.4) +
        (profitFactorChange * 0.1 * 0.3) + // Scale profit factor
        (avgReturnChange * 0.01 * 0.3) // Scale avg return
      );

      // Determine recommendation
      let recommendation: 'keep' | 'revert' | 'monitor';
      let improvement: boolean;

      if (impactScore >= this.IMPROVEMENT_THRESHOLD) {
        recommendation = 'keep';
        improvement = true;
      } else if (impactScore <= this.DEGRADATION_THRESHOLD) {
        recommendation = 'revert';
        improvement = false;
      } else {
        // Minor change - monitor but don't revert
        recommendation = 'monitor';
        improvement = impactScore >= 0;
      }

      return {
        adjustmentId: adjustment.id,
        adjustmentType: adjustment.type || 'parameter',
        parameterName: adjustment.parameter_name,
        beforeValue: adjustment.old_value,
        afterValue: adjustment.new_value,
        beforeMetrics,
        afterMetrics,
        improvement,
        impactScore,
        recommendation
      };
    } catch (error: any) {
      logger.error('Error evaluating adjustment', {
        adjustmentId: adjustment.id,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Get performance metrics for a time period
   */
  private async getPerformanceMetrics(
    referenceTime: Date,
    period: 'before' | 'after',
    limit: number
  ): Promise<PerformanceMetrics> {
    const operator = period === 'before' ? '<' : '>=';

    try {
      const result = await query<{
        trade_count: string;
        wins: string;
        losses: string;
        total_pnl: string;
        avg_return: string;
      }>(`
        SELECT
          COUNT(*) as trade_count,
          COUNT(CASE WHEN outcome = 'WIN' THEN 1 END) as wins,
          COUNT(CASE WHEN outcome IN ('LOSS', 'RUG') THEN 1 END) as losses,
          COALESCE(SUM(profit_loss_percent), 0) as total_pnl,
          COALESCE(AVG(profit_loss_percent), 0) as avg_return
        FROM trades
        WHERE exit_time IS NOT NULL
        AND outcome IS NOT NULL
        AND exit_time ${operator} $1
        ORDER BY exit_time ${period === 'before' ? 'DESC' : 'ASC'}
        LIMIT $2
      `, [referenceTime, limit * 2]); // Get more to filter

      const data = result.rows[0];
      const tradeCount = parseInt(data.trade_count) || 0;
      const wins = parseInt(data.wins) || 0;
      const losses = parseInt(data.losses) || 0;
      const totalPnl = parseFloat(data.total_pnl) || 0;
      const avgReturn = parseFloat(data.avg_return) || 0;

      const winRate = tradeCount > 0 ? wins / tradeCount : 0;

      // Calculate profit factor (wins / losses in absolute terms)
      const winAmount = wins > 0 ? Math.abs(totalPnl * winRate) : 0;
      const lossAmount = losses > 0 ? Math.abs(totalPnl * (1 - winRate)) : 1;
      const profitFactor = winAmount / Math.max(lossAmount, 0.01);

      return {
        tradeCount,
        winRate,
        profitFactor,
        avgReturn,
        totalPnl,
        timestamp: referenceTime
      };
    } catch (error: any) {
      logger.error('Error fetching performance metrics', { error: error.message });
      return {
        tradeCount: 0,
        winRate: 0,
        profitFactor: 0,
        avgReturn: 0,
        totalPnl: 0,
        timestamp: referenceTime
      };
    }
  }

  /**
   * Get unevaluated adjustments from database
   */
  private async getUnevaluatedAdjustments(): Promise<any[]> {
    try {
      // Get weight adjustments not yet evaluated
      const weightResult = await query<any>(`
        SELECT
          lw.id,
          'weight' as type,
          'weights' as parameter_name,
          lw.weights as new_value,
          LAG(lw.weights) OVER (ORDER BY lw.version) as old_value,
          lw.created_at
        FROM learning_weights lw
        WHERE lw.id NOT IN (
          SELECT COALESCE((lm.impact->>'adjustmentId')::uuid, '00000000-0000-0000-0000-000000000000')
          FROM learning_meta lm
          WHERE lm.adjustment_type = 'weight'
        )
        AND lw.created_at < NOW() - INTERVAL '24 hours'
        ORDER BY lw.created_at
        LIMIT 5
      `);

      // Get parameter adjustments not yet evaluated
      const paramResult = await query<any>(`
        SELECT
          lp.id,
          'parameter' as type,
          lp.parameter_name,
          lp.new_value,
          lp.old_value,
          lp.created_at
        FROM learning_parameters lp
        WHERE lp.id NOT IN (
          SELECT COALESCE((lm.impact->>'adjustmentId')::uuid, '00000000-0000-0000-0000-000000000000')
          FROM learning_meta lm
          WHERE lm.adjustment_type = 'parameter'
        )
        AND lp.created_at < NOW() - INTERVAL '24 hours'
        ORDER BY lp.created_at
        LIMIT 5
      `);

      return [...weightResult.rows, ...paramResult.rows];
    } catch (error: any) {
      logger.debug('Error fetching unevaluated adjustments', { error: error.message });
      return [];
    }
  }

  /**
   * Record impact evaluation in database
   */
  private async recordImpactEvaluation(impact: AdjustmentImpact): Promise<void> {
    try {
      await query(
        `INSERT INTO learning_meta
         (cycle_id, cycle_type, adjustment_type, before_value, after_value, impact, improvement_flag, notes)
         SELECT
           COALESCE(MAX(cycle_id), 0) + 1,
           'meta_review',
           $1,
           $2,
           $3,
           $4,
           $5,
           $6
         FROM learning_meta`,
        [
          impact.adjustmentType,
          JSON.stringify(impact.beforeValue),
          JSON.stringify(impact.afterValue),
          JSON.stringify({
            adjustmentId: impact.adjustmentId,
            parameterName: impact.parameterName,
            impactScore: impact.impactScore,
            beforeMetrics: impact.beforeMetrics,
            afterMetrics: impact.afterMetrics,
            recommendation: impact.recommendation
          }),
          impact.improvement,
          `${impact.parameterName}: ${impact.recommendation} (score: ${impact.impactScore.toFixed(4)})`
        ]
      );
    } catch (error: any) {
      logger.error('Error recording impact evaluation', { error: error.message });
    }
  }

  /**
   * Update learning health based on recent impacts
   */
  private async updateLearningHealth(recentImpacts: AdjustmentImpact[]): Promise<void> {
    if (recentImpacts.length === 0) return;

    const improvements = recentImpacts.filter(i => i.improvement).length;
    const improvementRate = improvements / recentImpacts.length;

    // Count consecutive failures
    const consecutiveFailures = await this.countConsecutiveFailures();

    // Adjust learning rate
    if (consecutiveFailures >= this.MAX_CONSECUTIVE_FAILURES) {
      this.learningRateMultiplier = Math.max(0.25, this.learningRateMultiplier * 0.5);
      logger.warn('⚠️ Learning rate reduced due to consecutive failures', {
        consecutiveFailures,
        newMultiplier: this.learningRateMultiplier
      });
    } else if (improvementRate > 0.7 && this.learningRateMultiplier < 1.0) {
      this.learningRateMultiplier = Math.min(1.0, this.learningRateMultiplier * 1.2);
      logger.info('📈 Learning rate restored due to improvements', {
        improvementRate,
        newMultiplier: this.learningRateMultiplier
      });
    }
  }

  /**
   * Count consecutive failed adjustments
   */
  private async countConsecutiveFailures(): Promise<number> {
    try {
      const result = await query<{ count: string }>(`
        WITH ranked AS (
          SELECT
            improvement_flag,
            ROW_NUMBER() OVER (ORDER BY created_at DESC) as rn
          FROM learning_meta
          WHERE cycle_type = 'meta_review'
          AND improvement_flag IS NOT NULL
          ORDER BY created_at DESC
          LIMIT 10
        )
        SELECT COUNT(*) as count
        FROM ranked
        WHERE improvement_flag = false
        AND rn <= (
          SELECT COALESCE(MIN(rn), 11)
          FROM ranked
          WHERE improvement_flag = true
        ) - 1
      `);

      return parseInt(result.rows[0]?.count || '0');
    } catch (error: any) {
      logger.debug('Error counting consecutive failures', { error: error.message });
      return 0;
    }
  }

  /**
   * Revert to a previous learning snapshot
   */
  async revertToSnapshot(snapshotVersion: number): Promise<boolean> {
    logger.info('🔄 Reverting to snapshot', { version: snapshotVersion });

    try {
      // Get the snapshot
      const snapshotResult = await query<{
        id: string;
        version: number;
        weights: CategoryWeights;
        parameters: any;
      }>(`
        SELECT id, version, weights, parameters
        FROM learning_snapshots
        WHERE version = $1
      `, [snapshotVersion]);

      if (snapshotResult.rows.length === 0) {
        logger.error('Snapshot not found', { version: snapshotVersion });
        return false;
      }

      const snapshot = snapshotResult.rows[0];

      // Create a new snapshot with the reverted values
      await transaction(async (client) => {
        // Get next version number
        const versionResult = await client.query(
          `SELECT COALESCE(MAX(version), 0) + 1 as next_version FROM learning_snapshots`
        );
        const nextVersion = versionResult.rows[0].next_version;

        // Insert reverted snapshot
        await client.query(
          `INSERT INTO learning_snapshots (version, weights, parameters, trade_count, win_rate, profit_factor)
           SELECT $1, $2, $3, trade_count, win_rate, profit_factor
           FROM learning_snapshots
           WHERE version = $4`,
          [nextVersion, JSON.stringify(snapshot.weights), JSON.stringify(snapshot.parameters), snapshotVersion]
        );

        // Record the reversion
        await client.query(
          `INSERT INTO learning_meta
           (cycle_id, cycle_type, adjustment_type, before_value, after_value, impact, notes)
           VALUES (
             (SELECT COALESCE(MAX(cycle_id), 0) + 1 FROM learning_meta),
             'reversion',
             'snapshot',
             $1,
             $2,
             $3,
             $4
           )`,
          [
            JSON.stringify({ version: nextVersion - 1 }),
            JSON.stringify({ version: snapshotVersion }),
            JSON.stringify({ reason: 'manual_revert', targetVersion: snapshotVersion }),
            `Reverted to snapshot version ${snapshotVersion}`
          ]
        );
      });

      logger.info('✅ Successfully reverted to snapshot', {
        targetVersion: snapshotVersion,
        weights: snapshot.weights
      });

      return true;
    } catch (error: any) {
      logger.error('Error reverting to snapshot', { error: error.message });
      return false;
    }
  }

  /**
   * Get available snapshots for reversion
   */
  async getAvailableSnapshots(limit: number = 10): Promise<LearningSnapshot[]> {
    try {
      const result = await query<{
        id: string;
        version: number;
        weights: CategoryWeights;
        parameters: any;
        trade_count: number;
        win_rate: string;
        profit_factor: string;
        created_at: Date;
      }>(`
        SELECT id, version, weights, parameters, trade_count, win_rate, profit_factor, created_at
        FROM learning_snapshots
        ORDER BY version DESC
        LIMIT $1
      `, [limit]);

      return result.rows.map(row => ({
        id: row.id,
        version: row.version,
        weights: row.weights,
        parameters: row.parameters,
        tradeCount: row.trade_count,
        winRate: parseFloat(row.win_rate),
        profitFactor: parseFloat(row.profit_factor),
        createdAt: row.created_at
      }));
    } catch (error: any) {
      logger.error('Error fetching snapshots', { error: error.message });
      return [];
    }
  }

  /**
   * Get learning health status
   */
  async getLearningHealthStatus(): Promise<LearningHealthStatus> {
    try {
      // Get recent improvement rate
      const recentResult = await query<{ total: string; improved: string }>(`
        SELECT
          COUNT(*) as total,
          COUNT(CASE WHEN improvement_flag = true THEN 1 END) as improved
        FROM learning_meta
        WHERE cycle_type = 'meta_review'
        AND created_at > NOW() - INTERVAL '30 days'
      `);

      const total = parseInt(recentResult.rows[0]?.total || '0');
      const improved = parseInt(recentResult.rows[0]?.improved || '0');
      const improvementRate = total > 0 ? improved / total : 0.5;

      // Get consecutive failures
      const consecutiveFailures = await this.countConsecutiveFailures();

      // Get total weight drift
      const driftResult = await query<{ weights: CategoryWeights }>(`
        SELECT weights FROM learning_snapshots ORDER BY version DESC LIMIT 1
      `);

      const currentWeights = driftResult.rows[0]?.weights || {
        smartWallet: 30,
        tokenSafety: 25,
        marketConditions: 15,
        socialSignals: 10,
        entryQuality: 20
      };

      const baseline = {
        smartWallet: 30,
        tokenSafety: 25,
        marketConditions: 15,
        socialSignals: 10,
        entryQuality: 20
      };

      const totalDrift = Object.keys(baseline).reduce((sum, key) => {
        const k = key as keyof CategoryWeights;
        return sum + Math.abs(currentWeights[k] - baseline[k]);
      }, 0);

      // Determine overall health
      let overallHealth: 'good' | 'warning' | 'critical';
      let recommendation: string;

      if (consecutiveFailures >= this.MAX_CONSECUTIVE_FAILURES || improvementRate < 0.3) {
        overallHealth = 'critical';
        recommendation = 'Consider pausing learning engine and reverting to a stable snapshot';
      } else if (totalDrift > 40 || improvementRate < 0.5 || consecutiveFailures >= 2) {
        overallHealth = 'warning';
        recommendation = 'Monitor closely. Consider freezing some parameters';
      } else {
        overallHealth = 'good';
        recommendation = 'Learning engine is performing well';
      }

      return {
        overallHealth,
        recentImprovementRate: improvementRate,
        consecutiveFailures,
        learningRateMultiplier: this.learningRateMultiplier,
        totalDrift,
        recommendation
      };
    } catch (error: any) {
      logger.error('Error getting learning health status', { error: error.message });
      return {
        overallHealth: 'warning',
        recentImprovementRate: 0.5,
        consecutiveFailures: 0,
        learningRateMultiplier: 1.0,
        totalDrift: 0,
        recommendation: 'Unable to determine health status'
      };
    }
  }

  /**
   * Execute meta-learning review cycle
   */
  async executeMetaReviewCycle(): Promise<void> {
    logger.info('🔄 Executing meta-learning review cycle');

    const startTime = Date.now();
    let cycleId: string | null = null;

    try {
      // Record cycle start
      const cycleResult = await query<{ id: string }>(
        `INSERT INTO learning_cycles (cycle_number, cycle_type, trade_count_at_cycle, status)
         SELECT COALESCE(MAX(cycle_number), 0) + 1, 'meta_review',
                (SELECT COUNT(*) FROM trades WHERE exit_time IS NOT NULL), 'running'
         FROM learning_cycles
         RETURNING id`
      );
      cycleId = cycleResult.rows[0].id;

      // Evaluate adjustment impacts
      const impacts = await this.evaluateAdjustmentImpacts();

      // Get health status
      const health = await this.getLearningHealthStatus();

      // Handle critical health
      if (health.overallHealth === 'critical') {
        logger.error('🚨 Learning engine health critical', {
          improvementRate: health.recentImprovementRate,
          consecutiveFailures: health.consecutiveFailures,
          recommendation: health.recommendation
        });

        // Auto-revert to last good snapshot if too many failures
        if (health.consecutiveFailures >= this.MAX_CONSECUTIVE_FAILURES) {
          const snapshots = await this.getAvailableSnapshots(5);
          // Find a snapshot from before the failures started
          const safeSnapshot = snapshots.find(s => s.winRate > 0.35);
          if (safeSnapshot) {
            logger.info('Auto-reverting to safe snapshot', { version: safeSnapshot.version });
            await this.revertToSnapshot(safeSnapshot.version);
          }
        }
      }

      // Update cycle status
      await query(
        `UPDATE learning_cycles
         SET status = 'completed', completed_at = NOW(),
             duration_ms = $1, adjustments_made = $2
         WHERE id = $3`,
        [Date.now() - startTime, impacts.length, cycleId]
      );

      logger.info('✅ Meta-learning review completed', {
        durationMs: Date.now() - startTime,
        impactsEvaluated: impacts.length,
        health: health.overallHealth,
        improvementRate: health.recentImprovementRate
      });

    } catch (error: any) {
      logger.error('Meta-learning review cycle failed', { error: error.message });

      if (cycleId) {
        await query(
          `UPDATE learning_cycles SET status = 'failed', completed_at = NOW(),
           duration_ms = $1, error_message = $2
           WHERE id = $3`,
          [Date.now() - startTime, error.message, cycleId]
        );
      }

      throw error;
    }
  }

  /**
   * Generate comprehensive learning report
   */
  async generateLearningReport(): Promise<any> {
    logger.info('📊 Generating learning report');

    try {
      // Get current weights and parameters
      const currentSnapshot = await query<{
        version: number;
        weights: CategoryWeights;
        parameters: any;
        trade_count: number;
        win_rate: string;
        profit_factor: string;
        created_at: Date;
      }>(`
        SELECT * FROM learning_snapshots ORDER BY version DESC LIMIT 1
      `);

      // Get baseline drift
      const health = await this.getLearningHealthStatus();

      // Get recent adjustments
      const recentAdjustments = await query<any>(`
        SELECT * FROM learning_parameters
        ORDER BY created_at DESC
        LIMIT 10
      `);

      // Get impact history
      const impactHistory = await query<any>(`
        SELECT
          adjustment_type,
          improvement_flag,
          impact,
          notes,
          created_at
        FROM learning_meta
        WHERE cycle_type = 'meta_review'
        ORDER BY created_at DESC
        LIMIT 20
      `);

      // Get cycle history
      const cycleHistory = await query<any>(`
        SELECT
          cycle_type,
          status,
          adjustments_made,
          duration_ms,
          created_at
        FROM learning_cycles
        ORDER BY created_at DESC
        LIMIT 20
      `);

      const report = {
        generatedAt: new Date(),
        currentState: {
          snapshotVersion: currentSnapshot.rows[0]?.version || 1,
          weights: currentSnapshot.rows[0]?.weights,
          parameters: currentSnapshot.rows[0]?.parameters,
          tradeCount: currentSnapshot.rows[0]?.trade_count || 0,
          winRate: parseFloat(currentSnapshot.rows[0]?.win_rate || '0'),
          profitFactor: parseFloat(currentSnapshot.rows[0]?.profit_factor || '0')
        },
        health,
        recentAdjustments: recentAdjustments.rows,
        impactHistory: impactHistory.rows,
        cycleHistory: cycleHistory.rows,
        recommendations: this.generateRecommendations(health, impactHistory.rows)
      };

      // Save report
      await query(
        `INSERT INTO learning_meta
         (cycle_id, cycle_type, impact, notes)
         VALUES (
           (SELECT COALESCE(MAX(cycle_id), 0) + 1 FROM learning_meta),
           'full_report',
           $1,
           'Comprehensive learning report generated'
         )`,
        [JSON.stringify(report)]
      );

      return report;
    } catch (error: any) {
      logger.error('Error generating learning report', { error: error.message });
      return null;
    }
  }

  /**
   * Generate recommendations based on current state
   */
  private generateRecommendations(health: LearningHealthStatus, impactHistory: any[]): string[] {
    const recommendations: string[] = [];

    if (health.overallHealth === 'critical') {
      recommendations.push('URGENT: Consider pausing the learning engine');
      recommendations.push('Review recent adjustments for potential issues');
      recommendations.push('Consider reverting to a previous stable snapshot');
    }

    if (health.totalDrift > 50) {
      recommendations.push('Total weight drift exceeds 50% - manual review recommended');
    }

    if (health.learningRateMultiplier < 0.5) {
      recommendations.push('Learning rate has been significantly reduced due to poor performance');
      recommendations.push('Review data quality and market conditions');
    }

    if (health.consecutiveFailures >= 2) {
      recommendations.push(`${health.consecutiveFailures} consecutive failed adjustments detected`);
      recommendations.push('Consider freezing some parameters temporarily');
    }

    // Analyze impact patterns
    const recentImpacts = impactHistory.slice(0, 5);
    const revertRecommendations = recentImpacts.filter(i =>
      i.impact?.recommendation === 'revert'
    );

    if (revertRecommendations.length >= 2) {
      recommendations.push('Multiple recent adjustments recommended for revert');
      recommendations.push('Learning may be overfitting to recent data');
    }

    if (recommendations.length === 0) {
      recommendations.push('Learning engine is operating normally');
      recommendations.push('Continue monitoring performance metrics');
    }

    return recommendations;
  }

  /**
   * Get current learning rate multiplier
   */
  getLearningRateMultiplier(): number {
    return this.learningRateMultiplier;
  }

  /**
   * Check stability protection - ensure enough data before adjustments
   */
  async checkStabilityProtection(): Promise<{ canAdjust: boolean; reason: string }> {
    try {
      const result = await query<{ count: string }>(`
        SELECT COUNT(*) as count FROM trades WHERE exit_time IS NOT NULL
      `);

      const tradeCount = parseInt(result.rows[0]?.count || '0');

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
    } catch (error: any) {
      return {
        canAdjust: false,
        reason: 'Error checking stability protection'
      };
    }
  }
}
