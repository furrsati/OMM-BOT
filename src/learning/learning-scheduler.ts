import { logger, logLearningEngineAdjustment } from '../utils/logger';
import { db } from '../db/postgres';
import { PatternMatcher } from './pattern-matcher';
import { WeightOptimizer } from './weight-optimizer';
import { ParameterTuner } from './parameter-tuner';
import { MetaLearner, type LearningSnapshot } from './meta-learner';
import type { Trade } from '../types';

/**
 * LEARNING ENGINE SCHEDULER
 *
 * Coordinates all learning cycles and schedules their execution.
 * This is the main coordinator that ties together all 4 levels of learning.
 *
 * Schedule:
 * - Every trade: Pattern matching (Level 1)
 * - Every 50 trades: Weight optimization (Level 2) + Parameter tuning (Level 3)
 * - Every 100 trades: Meta-learning review (Level 4)
 * - Every 200 trades: Full report + drift analysis
 *
 * Phase 7 Implementation: COMPLETE
 */

export interface LearningSchedulerStatus {
  totalTrades: number;
  lastWeightOptimization: Date | null;
  lastParameterTuning: Date | null;
  lastMetaReview: Date | null;
  lastFullReport: Date | null;
  isActive: boolean;
}

export class LearningScheduler {
  private patternMatcher: PatternMatcher;
  private weightOptimizer: WeightOptimizer;
  private parameterTuner: ParameterTuner;
  private metaLearner: MetaLearner;

  private intervalId: NodeJS.Timeout | null = null;
  private isActive: boolean = false;

  // Track when each cycle type last ran
  private lastWeightOptimization: Date | null = null;
  private lastParameterTuning: Date | null = null;
  private lastMetaReview: Date | null = null;
  private lastFullReport: Date | null = null;

  // Cycle tracking
  private lastProcessedTradeCount: number = 0;
  private cyclesRun: Set<string> = new Set();

  constructor() {
    this.patternMatcher = new PatternMatcher();
    this.weightOptimizer = new WeightOptimizer();
    this.parameterTuner = new ParameterTuner();
    this.metaLearner = new MetaLearner();

    logger.info('🧠 Learning Scheduler initialized');
  }

  /**
   * Start the learning scheduler
   * Checks for due cycles every 5 minutes
   */
  async start(): Promise<void> {
    if (this.isActive) {
      logger.warn('Learning Scheduler already running');
      return;
    }

    this.isActive = true;
    logger.info('▶️ Starting Learning Scheduler');

    // Check immediately on start
    await this.checkAndRunCycles();

    // Then check every 5 minutes
    this.intervalId = setInterval(async () => {
      await this.checkAndRunCycles();
    }, 5 * 60 * 1000); // 5 minutes

    logger.info('✅ Learning Scheduler started (checking every 5 minutes)');
  }

  /**
   * Stop the learning scheduler
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    this.isActive = false;
    logger.info('⏹️ Learning Scheduler stopped');
  }

  /**
   * Called when a trade completes
   * Handles Level 1 pattern matching immediately
   */
  async onTradeCompleted(trade: Trade): Promise<void> {
    try {
      logger.debug('📝 Processing completed trade for learning', {
        token: trade.tokenAddress,
        outcome: trade.outcome
      });

      // Level 1: Pattern matching (happens immediately)
      const fingerprint = await this.patternMatcher.createFingerprint(trade);
      await this.patternMatcher.storeTradePattern(trade, fingerprint);

      // Update pattern libraries
      await this.patternMatcher.updatePatternLibraries(trade, fingerprint);

      // Trigger cycle check
      await this.checkAndRunCycles();

    } catch (error: any) {
      logger.error('Error processing completed trade', {
        error: error.message,
        token: trade.tokenAddress
      });
    }
  }

  /**
   * Check if any learning cycles are due and run them
   */
  private async checkAndRunCycles(): Promise<void> {
    try {
      const totalTrades = await this.getTotalCompletedTrades();

      // Don't run cycles if insufficient data
      if (totalTrades < 30) {
        logger.debug('Skipping learning cycles (insufficient data)', {
          trades: totalTrades,
          required: 30
        });
        return;
      }

      // Check if we've processed new trades since last check
      if (totalTrades === this.lastProcessedTradeCount) {
        return; // No new trades
      }

      this.lastProcessedTradeCount = totalTrades;

      // Every 50 trades: Weight optimization + Parameter tuning
      if (totalTrades >= 50 && totalTrades % 50 === 0) {
        const cycleKey = `weight_param_${totalTrades}`;
        if (!this.cyclesRun.has(cycleKey)) {
          await this.runWeightOptimization(totalTrades);
          await this.runParameterTuning(totalTrades);
          this.cyclesRun.add(cycleKey);
        }
      }

      // Every 100 trades: Meta-learning review
      if (totalTrades >= 100 && totalTrades % 100 === 0) {
        const cycleKey = `meta_${totalTrades}`;
        if (!this.cyclesRun.has(cycleKey)) {
          await this.runMetaLearningReview(totalTrades);
          this.cyclesRun.add(cycleKey);
        }
      }

      // Every 200 trades: Full report
      if (totalTrades >= 200 && totalTrades % 200 === 0) {
        const cycleKey = `report_${totalTrades}`;
        if (!this.cyclesRun.has(cycleKey)) {
          await this.generateFullReport(totalTrades);
          this.cyclesRun.add(cycleKey);
        }
      }

    } catch (error: any) {
      logger.error('Error checking learning cycles', {
        error: error.message
      });
    }
  }

  /**
   * Run weight optimization cycle (Level 2)
   */
  private async runWeightOptimization(tradeCount: number): Promise<void> {
    logger.info('📊 Running weight optimization cycle', { tradeCount });

    try {
      // Record cycle start
      await this.recordCycleStart('weight_optimization', tradeCount);

      // Run optimization
      await this.weightOptimizer.executeOptimizationCycle();

      this.lastWeightOptimization = new Date();

      logLearningEngineAdjustment('weight_optimization', {
        cycle: 'weight_optimization',
        tradeCount,
        timestamp: new Date().toISOString()
      });

      await this.recordCycleComplete('weight_optimization', tradeCount, 'completed');

      logger.info('✅ Weight optimization cycle completed');

    } catch (error: any) {
      logger.error('Weight optimization cycle failed', {
        error: error.message
      });
      await this.recordCycleComplete('weight_optimization', tradeCount, 'failed', error.message);
    }
  }

  /**
   * Run parameter tuning cycle (Level 3)
   */
  private async runParameterTuning(tradeCount: number): Promise<void> {
    logger.info('🎯 Running parameter tuning cycle', { tradeCount });

    try {
      await this.recordCycleStart('parameter_tuning', tradeCount);

      await this.parameterTuner.executeTuningCycle();

      this.lastParameterTuning = new Date();

      logLearningEngineAdjustment('parameter_tuning', {
        cycle: 'parameter_tuning',
        tradeCount,
        timestamp: new Date().toISOString()
      });

      await this.recordCycleComplete('parameter_tuning', tradeCount, 'completed');

      logger.info('✅ Parameter tuning cycle completed');

    } catch (error: any) {
      logger.error('Parameter tuning cycle failed', {
        error: error.message
      });
      await this.recordCycleComplete('parameter_tuning', tradeCount, 'failed', error.message);
    }
  }

  /**
   * Run meta-learning review (Level 4)
   */
  private async runMetaLearningReview(tradeCount: number): Promise<void> {
    logger.info('🧠 Running meta-learning review', { tradeCount });

    try {
      await this.recordCycleStart('meta_review', tradeCount);

      // Get previous and current snapshots
      const snapshots = await this.metaLearner.getAvailableSnapshots();

      if (snapshots.length >= 2) {
        const before = snapshots[1]; // Previous
        const after = snapshots[0]; // Current

        // Evaluate impact
        const impact = await this.metaLearner.evaluateLearningImpact(before, after);

        // Adjust learning rate if needed
        await this.metaLearner.adjustLearningRate(impact);

        logger.info('Meta-learning review result', {
          improved: impact.improved,
          degraded: impact.degraded,
          reason: impact.reason
        });
      }

      this.lastMetaReview = new Date();

      await this.recordCycleComplete('meta_review', tradeCount, 'completed');

      logger.info('✅ Meta-learning review completed');

    } catch (error: any) {
      logger.error('Meta-learning review failed', {
        error: error.message
      });
      await this.recordCycleComplete('meta_review', tradeCount, 'failed', error.message);
    }
  }

  /**
   * Generate full learning report (every 200 trades)
   */
  private async generateFullReport(tradeCount: number): Promise<void> {
    logger.info('📋 Generating full learning report', { tradeCount });

    try {
      await this.recordCycleStart('full_report', tradeCount);

      // Get pattern stats
      const patternStats = await this.patternMatcher.getPatternStats();

      // Get current weights
      const currentWeights = await this.weightOptimizer.getCurrentWeights();

      // Calculate drift from baseline
      const drift = await this.weightOptimizer.calculateWeightDrift(currentWeights);

      // Get available snapshots
      const snapshots = await this.metaLearner.getAvailableSnapshots();

      logger.info('================================================');
      logger.info('📊 LEARNING ENGINE FULL REPORT');
      logger.info('================================================');
      logger.info(`Trade Count: ${tradeCount}`);
      logger.info('');
      logger.info('Pattern Libraries:');
      logger.info(`  • Win Patterns: ${patternStats.winPatterns}`);
      logger.info(`  • Danger Patterns: ${patternStats.dangerPatterns}`);
      logger.info('');
      logger.info('Current Weights:');
      logger.info(`  • Smart Wallet: ${currentWeights.smartWallet}%`);
      logger.info(`  • Token Safety: ${currentWeights.tokenSafety}%`);
      logger.info(`  • Market Conditions: ${currentWeights.marketConditions}%`);
      logger.info(`  • Social Signals: ${currentWeights.socialSignals}%`);
      logger.info(`  • Entry Quality: ${currentWeights.entryQuality}%`);
      logger.info('');
      logger.info(`Weight Drift from Baseline: ${drift.toFixed(1)}%`);

      if (drift > 50) {
        logger.warn('⚠️ SIGNIFICANT DRIFT DETECTED - Manual review recommended');
      }

      logger.info('');
      logger.info(`Learning Snapshots: ${snapshots.length} available`);
      logger.info('================================================');

      this.lastFullReport = new Date();

      await this.recordCycleComplete('full_report', tradeCount, 'completed');

      logger.info('✅ Full learning report generated');

    } catch (error: any) {
      logger.error('Full report generation failed', {
        error: error.message
      });
      await this.recordCycleComplete('full_report', tradeCount, 'failed', error.message);
    }
  }

  /**
   * Get total number of completed trades
   */
  private async getTotalCompletedTrades(): Promise<number> {
    try {
      const result = await db.query<any>(`
        SELECT COUNT(*) as count
        FROM trades
        WHERE outcome IS NOT NULL
      `);

      return parseInt(result.rows[0]?.count || 0);
    } catch (error: any) {
      logger.error('Error getting total trades', { error: error.message });
      return 0;
    }
  }

  /**
   * Record cycle start in database
   */
  private async recordCycleStart(
    cycleType: string,
    tradeCount: number
  ): Promise<void> {
    try {
      await db.query(`
        INSERT INTO learning_cycles (
          cycle_number,
          cycle_type,
          trade_count_at_cycle,
          status,
          created_at
        ) VALUES ($1, $2, $3, $4, NOW())
      `, [tradeCount, cycleType, tradeCount, 'running']);
    } catch (error: any) {
      logger.error('Error recording cycle start', {
        error: error.message,
        cycleType
      });
    }
  }

  /**
   * Record cycle completion in database
   */
  private async recordCycleComplete(
    cycleType: string,
    tradeCount: number,
    status: 'completed' | 'failed',
    errorMessage?: string
  ): Promise<void> {
    try {
      await db.query(`
        UPDATE learning_cycles
        SET status = $1,
            error_message = $2,
            completed_at = NOW()
        WHERE cycle_type = $3
          AND trade_count_at_cycle = $4
          AND status = 'running'
      `, [status, errorMessage || null, cycleType, tradeCount]);
    } catch (error: any) {
      logger.error('Error recording cycle completion', {
        error: error.message,
        cycleType
      });
    }
  }

  /**
   * Get current scheduler status
   */
  getStatus(): LearningSchedulerStatus {
    return {
      totalTrades: this.lastProcessedTradeCount,
      lastWeightOptimization: this.lastWeightOptimization,
      lastParameterTuning: this.lastParameterTuning,
      lastMetaReview: this.lastMetaReview,
      lastFullReport: this.lastFullReport,
      isActive: this.isActive
    };
  }

  /**
   * Manually trigger weight optimization (for testing/operator control)
   */
  async triggerWeightOptimization(): Promise<void> {
    const tradeCount = await this.getTotalCompletedTrades();
    await this.runWeightOptimization(tradeCount);
  }

  /**
   * Manually trigger parameter tuning (for testing/operator control)
   */
  async triggerParameterTuning(): Promise<void> {
    const tradeCount = await this.getTotalCompletedTrades();
    await this.runParameterTuning(tradeCount);
  }

  /**
   * Manually trigger full report (for testing/operator control)
   */
  async triggerFullReport(): Promise<void> {
    const tradeCount = await this.getTotalCompletedTrades();
    await this.generateFullReport(tradeCount);
  }
}
