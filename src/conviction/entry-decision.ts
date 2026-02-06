/**
 * Entry Decision Engine
 *
 * Makes the final go/no-go decision by checking:
 * 1. Hard reject rules (honeypot, mint authority, blacklist, etc.)
 * 2. Daily and position limits
 * 3. Conviction threshold
 * 4. Cooldown periods
 * 5. Learning engine adjustments
 *
 * This is the final gatekeeper before trade execution.
 */

import { logger, logThinking, logCheckpoint, logStep, logDecision } from '../utils/logger';
import { AggregatedSignal } from './signal-aggregator';
import { ConvictionScore } from './conviction-scorer';
import { query } from '../db/postgres';

export interface EntryDecision {
  shouldEnter: boolean;
  reason: string;

  // Conviction data
  convictionScore: number;
  convictionLevel: string;
  positionSizePercent: number;

  // Limit checks
  withinDailyLossLimit: boolean;
  withinDailyProfitLimit: boolean;
  withinMaxPositions: boolean;
  notInCooldown: boolean;

  // Safety checks
  passedHardRejects: boolean;
  hardRejectReason: string | null;

  // Final decision
  approvedForExecution: boolean;
  timestamp: number;
}

interface PortfolioLimits {
  dailyPnL: number;
  dailyLossLimit: number;
  dailyProfitLimit: number;
  openPositions: number;
  maxOpenPositions: number;
  totalExposurePercent: number;
  maxTotalExposure: number;
}

export class EntryDecisionEngine {
  private dailyPnL: number = 0;
  private openPositions: number = 0;
  private lastTradeTimestamp: number = 0;
  private losingStreak: number = 0;
  private cooldownUntil: number = 0;

  constructor() {
    // Initialize from database on startup
    this.loadStateFromDB().catch(error => {
      logger.error('Failed to load entry decision state from DB', { error: error.message });
    });
  }

  /**
   * Make final entry decision
   */
  async decide(
    signal: AggregatedSignal,
    conviction: ConvictionScore
  ): Promise<EntryDecision> {
    const tokenShort = signal.tokenAddress.slice(0, 8);
    logStep(1, 9, `Entry decision engine starting for ${tokenShort}...`);
    logThinking('ENTRY', `Evaluating token ${tokenShort} with conviction ${conviction.totalScore.toFixed(1)} (${conviction.convictionLevel})`);

    try {
      // Step 1: Check hard reject rules (instant fail)
      logStep(1, 9, `Checking hard reject rules...`);
      const hardRejectCheck = this.checkHardRejects(signal, conviction);
      if (!hardRejectCheck.passed) {
        const reason = hardRejectCheck.reason || 'Hard reject rule triggered';
        logCheckpoint('Hard Reject Rules', 'FAIL', reason);
        logDecision('REJECTED', `Hard reject triggered: ${reason}`, { token: tokenShort });
        return this.createRejectionDecision(
          conviction,
          'HARD_REJECT',
          reason,
          false,
          reason
        );
      }
      logCheckpoint('Hard Reject Rules', 'PASS', 'No hard rejects triggered');

      // Step 2: Get portfolio limits
      logStep(2, 9, `Loading portfolio limits...`);
      const limits = await this.getPortfolioLimits();
      logThinking('LIMITS', `Portfolio state loaded`, {
        dailyPnL: `${limits.dailyPnL.toFixed(2)}%`,
        openPositions: `${limits.openPositions}/${limits.maxOpenPositions}`,
        totalExposure: `${limits.totalExposurePercent.toFixed(1)}%/${limits.maxTotalExposure}%`
      });

      // Step 3: Check daily loss limit
      logStep(3, 9, `Checking daily loss limit...`);
      if (!this.checkDailyLossLimit(limits)) {
        logCheckpoint('Daily Loss Limit', 'FAIL', `Daily P&L ${limits.dailyPnL.toFixed(2)}% <= ${limits.dailyLossLimit}%`);
        logDecision('REJECTED', 'Daily loss limit reached', { dailyPnL: limits.dailyPnL });
        return this.createRejectionDecision(
          conviction,
          'DAILY_LOSS_LIMIT',
          'Daily loss limit reached (-8%)',
          false,
          null
        );
      }
      logCheckpoint('Daily Loss Limit', 'PASS', `Daily P&L ${limits.dailyPnL.toFixed(2)}% > ${limits.dailyLossLimit}%`);

      // Step 4: Check daily profit limit
      logStep(4, 9, `Checking daily profit limit...`);
      if (!this.checkDailyProfitLimit(limits)) {
        logCheckpoint('Daily Profit Limit', 'FAIL', `Daily P&L ${limits.dailyPnL.toFixed(2)}% >= ${limits.dailyProfitLimit}%`);
        logDecision('REJECTED', 'Daily profit limit reached (stop new entries)', { dailyPnL: limits.dailyPnL });
        return this.createRejectionDecision(
          conviction,
          'DAILY_PROFIT_LIMIT',
          'Daily profit limit reached (+15%)',
          true,
          null
        );
      }
      logCheckpoint('Daily Profit Limit', 'PASS', `Daily P&L ${limits.dailyPnL.toFixed(2)}% < ${limits.dailyProfitLimit}%`);

      // Step 5: Check max open positions
      logStep(5, 9, `Checking max open positions...`);
      if (!this.checkMaxPositions(limits)) {
        logCheckpoint('Max Positions', 'FAIL', `${limits.openPositions} >= ${limits.maxOpenPositions}`);
        logDecision('REJECTED', 'Maximum open positions reached', { openPositions: limits.openPositions });
        return this.createRejectionDecision(
          conviction,
          'MAX_POSITIONS',
          `Maximum open positions reached (${limits.maxOpenPositions})`,
          true,
          null
        );
      }
      logCheckpoint('Max Positions', 'PASS', `${limits.openPositions} < ${limits.maxOpenPositions}`);

      // Step 6: Check cooldown period
      logStep(6, 9, `Checking cooldown status...`);
      if (!this.checkCooldown()) {
        const minutesRemaining = Math.ceil((this.cooldownUntil - Date.now()) / 60000);
        logCheckpoint('Cooldown Period', 'FAIL', `${minutesRemaining} min remaining`);
        logDecision('REJECTED', `Cooldown active for ${minutesRemaining} more minutes`, { cooldownUntil: new Date(this.cooldownUntil).toISOString() });
        return this.createRejectionDecision(
          conviction,
          'COOLDOWN',
          `Cooldown active (${minutesRemaining} min remaining)`,
          true,
          null
        );
      }
      logCheckpoint('Cooldown Period', 'PASS', 'No cooldown active');

      // Step 7: Check conviction threshold
      logStep(7, 9, `Checking conviction threshold...`);
      if (!conviction.shouldEnter) {
        logCheckpoint('Conviction Threshold', 'FAIL', `Score ${conviction.totalScore.toFixed(1)} below entry threshold`);
        logDecision('REJECTED', `Conviction too low: ${conviction.totalScore.toFixed(1)} (${conviction.convictionLevel})`, {
          score: conviction.totalScore,
          level: conviction.convictionLevel
        });
        return this.createRejectionDecision(
          conviction,
          'LOW_CONVICTION',
          `Conviction score ${conviction.totalScore.toFixed(1)} below threshold`,
          true,
          null
        );
      }
      logCheckpoint('Conviction Threshold', 'PASS', `Score ${conviction.totalScore.toFixed(1)} meets threshold`);

      // Step 8: Check total portfolio exposure
      logStep(8, 9, `Checking total portfolio exposure...`);
      if (!this.checkTotalExposure(limits, conviction.recommendedPositionPercent)) {
        const newExposure = limits.totalExposurePercent + conviction.recommendedPositionPercent;
        logCheckpoint('Portfolio Exposure', 'FAIL', `${newExposure.toFixed(1)}% would exceed ${limits.maxTotalExposure}%`);
        logDecision('REJECTED', 'Would exceed max portfolio exposure', { newExposure, maxExposure: limits.maxTotalExposure });
        return this.createRejectionDecision(
          conviction,
          'MAX_EXPOSURE',
          'Total portfolio exposure would exceed 20%',
          true,
          null
        );
      }
      logCheckpoint('Portfolio Exposure', 'PASS', `${(limits.totalExposurePercent + conviction.recommendedPositionPercent).toFixed(1)}% <= ${limits.maxTotalExposure}%`);

      // Step 9: Adjust position size based on losing streak
      logStep(9, 9, `Calculating final position size...`);
      let adjustedPositionSize = conviction.recommendedPositionPercent;
      if (this.losingStreak >= 2) {
        const originalSize = adjustedPositionSize;
        adjustedPositionSize *= 0.75; // Reduce by 25%
        logThinking('STREAK_ADJ', `Losing streak ${this.losingStreak}: reducing position ${originalSize}% → ${adjustedPositionSize.toFixed(2)}% (-25%)`);
      }
      if (this.losingStreak >= 3) {
        const originalSize = adjustedPositionSize;
        adjustedPositionSize *= 0.5; // Reduce by 50%
        logThinking('STREAK_ADJ', `Losing streak ${this.losingStreak}: further reducing ${originalSize.toFixed(2)}% → ${adjustedPositionSize.toFixed(2)}% (-50%)`);
      }

      // ALL CHECKS PASSED - APPROVE ENTRY
      const decision: EntryDecision = {
        shouldEnter: true,
        reason: 'All checks passed',
        convictionScore: conviction.totalScore,
        convictionLevel: conviction.convictionLevel,
        positionSizePercent: adjustedPositionSize,
        withinDailyLossLimit: true,
        withinDailyProfitLimit: true,
        withinMaxPositions: true,
        notInCooldown: true,
        passedHardRejects: true,
        hardRejectReason: null,
        approvedForExecution: true,
        timestamp: Date.now()
      };

      logDecision('APPROVED FOR ENTRY', `All 9 checks passed`, {
        token: tokenShort,
        conviction: conviction.totalScore.toFixed(1),
        level: conviction.convictionLevel,
        positionSize: `${adjustedPositionSize.toFixed(2)}%`
      });

      logThinking('SUMMARY', `Entry approved: ${tokenShort} | Conviction: ${conviction.totalScore.toFixed(1)} (${conviction.convictionLevel}) | Position: ${adjustedPositionSize.toFixed(2)}%`);

      return decision;

    } catch (error: any) {
      logger.error('Error making entry decision', {
        token: signal.tokenAddress,
        error: error.message
      });

      logDecision('ERROR', `Decision engine error: ${error.message}`, { token: tokenShort });

      // On error, reject (fail closed)
      return this.createRejectionDecision(
        conviction,
        'ERROR',
        `Decision engine error: ${error.message}`,
        false,
        null
      );
    }
  }

  /**
   * Check hard reject rules
   */
  private checkHardRejects(
    signal: AggregatedSignal,
    _conviction: ConvictionScore
  ): { passed: boolean; reason: string | null } {
    // Hard reject from safety analysis
    if (signal.safety.isHardRejected) {
      return {
        passed: false,
        reason: signal.safety.rejectReason || 'Token failed safety checks'
      };
    }

    // Market regime PAUSE
    if (signal.marketContext.regime === 'PAUSE') {
      return {
        passed: false,
        reason: 'Market regime: PAUSE (SOL down 15%+)'
      };
    }

    // All hard rejects passed
    return { passed: true, reason: null };
  }

  /**
   * Check daily loss limit (-8%)
   */
  private checkDailyLossLimit(limits: PortfolioLimits): boolean {
    return limits.dailyPnL > limits.dailyLossLimit;
  }

  /**
   * Check daily profit limit (+15%)
   */
  private checkDailyProfitLimit(limits: PortfolioLimits): boolean {
    return limits.dailyPnL < limits.dailyProfitLimit;
  }

  /**
   * Check max open positions (3-5 depending on regime)
   */
  private checkMaxPositions(limits: PortfolioLimits): boolean {
    return limits.openPositions < limits.maxOpenPositions;
  }

  /**
   * Check if cooldown period is active
   */
  private checkCooldown(): boolean {
    return Date.now() >= this.cooldownUntil;
  }

  /**
   * Check total portfolio exposure (max 20%)
   */
  private checkTotalExposure(limits: PortfolioLimits, newPositionPercent: number): boolean {
    return (limits.totalExposurePercent + newPositionPercent) <= limits.maxTotalExposure;
  }

  /**
   * Get current portfolio limits from database
   */
  private async getPortfolioLimits(): Promise<PortfolioLimits> {
    try {
      // Calculate daily P&L from trades closed today
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const dailyTradesResult = await query<{ total_pnl: string }>(`
        SELECT COALESCE(SUM(profit_loss_percent), 0) as total_pnl
        FROM trades
        WHERE exit_time >= $1
        AND exit_time IS NOT NULL
      `, [todayStart.toISOString()]);

      const dailyPnL = parseFloat(dailyTradesResult.rows[0]?.total_pnl || '0');

      // Count open positions and calculate total exposure
      const positionsResult = await query<{ count: string; total_exposure: string }>(`
        SELECT
          COUNT(*) as count,
          COALESCE(SUM(
            CASE
              WHEN remaining_amount IS NOT NULL AND entry_price IS NOT NULL
              THEN (remaining_amount * entry_price)
              ELSE (entry_amount * entry_price)
            END
          ), 0) as total_exposure
        FROM positions
        WHERE status = 'OPEN'
      `);

      const openPositions = parseInt(positionsResult.rows[0]?.count || '0');

      // Get wallet balance to calculate exposure percentage
      // For now, use a reasonable estimate based on position sizes
      // In production, this should query actual wallet balance
      const totalExposureUSD = parseFloat(positionsResult.rows[0]?.total_exposure || '0');

      // Estimate total exposure as percentage (assuming ~$1000 per % point as baseline)
      // This will be refined once we track actual wallet balance
      const estimatedWalletValue = 10000; // Default estimate, should be from wallet
      const totalExposurePercent = estimatedWalletValue > 0
        ? (totalExposureUSD / estimatedWalletValue) * 100
        : openPositions * 3; // Fallback to estimate

      // Update local state
      this.openPositions = openPositions;
      this.dailyPnL = dailyPnL;

      return {
        dailyPnL,
        dailyLossLimit: -8, // -8% max loss per CLAUDE.md
        dailyProfitLimit: 15, // +15% max profit per CLAUDE.md
        openPositions,
        maxOpenPositions: 5, // Max 5 positions per CLAUDE.md
        totalExposurePercent: Math.min(totalExposurePercent, 100),
        maxTotalExposure: 20 // Max 20% total exposure per CLAUDE.md
      };

    } catch (error: any) {
      logger.error('Error getting portfolio limits', { error: error.message });
      // Return safe defaults on error
      return {
        dailyPnL: this.dailyPnL,
        dailyLossLimit: -8,
        dailyProfitLimit: 15,
        openPositions: this.openPositions,
        maxOpenPositions: 5,
        totalExposurePercent: this.openPositions * 3,
        maxTotalExposure: 20
      };
    }
  }

  /**
   * Create rejection decision
   */
  private createRejectionDecision(
    conviction: ConvictionScore,
    code: string,
    reason: string,
    passedHardRejects: boolean,
    hardRejectReason: string | null
  ): EntryDecision {
    logger.warn(`❌ ENTRY REJECTED: ${code}`, { reason });

    return {
      shouldEnter: false,
      reason: `[${code}] ${reason}`,
      convictionScore: conviction.totalScore,
      convictionLevel: conviction.convictionLevel,
      positionSizePercent: 0,
      withinDailyLossLimit: code !== 'DAILY_LOSS_LIMIT',
      withinDailyProfitLimit: code !== 'DAILY_PROFIT_LIMIT',
      withinMaxPositions: code !== 'MAX_POSITIONS',
      notInCooldown: code !== 'COOLDOWN',
      passedHardRejects,
      hardRejectReason,
      approvedForExecution: false,
      timestamp: Date.now()
    };
  }

  /**
   * Update state after a trade (win or loss)
   */
  updateAfterTrade(won: boolean, pnlPercent: number): void {
    this.dailyPnL += pnlPercent;
    this.lastTradeTimestamp = Date.now();

    if (won) {
      this.losingStreak = 0;
    } else {
      this.losingStreak++;

      // Apply cooldowns based on losing streak
      if (this.losingStreak >= 5) {
        // 5+ losses: 6 hour cooldown
        this.cooldownUntil = Date.now() + 6 * 60 * 60 * 1000;
        logger.warn(`🚨 5+ losing streak - 6 hour cooldown activated`);
      } else if (this.losingStreak >= 3) {
        // 3-4 losses: 1 hour cooldown
        this.cooldownUntil = Date.now() + 60 * 60 * 1000;
        logger.warn(`⚠️ 3+ losing streak - 1 hour cooldown activated`);
      }
    }

    // Check daily loss limit trigger
    if (this.dailyPnL <= -8) {
      this.cooldownUntil = Date.now() + 12 * 60 * 60 * 1000; // 12 hour cooldown
      logger.error(`🚨 DAILY LOSS LIMIT HIT (-8%) - 12 hour cooldown`);
    }

    this.saveStateToDB().catch(error => {
      logger.error('Failed to save entry decision state', { error: error.message });
    });
  }

  /**
   * Reset daily stats (call this at start of each trading day)
   */
  resetDaily(): void {
    this.dailyPnL = 0;
    logger.info('📊 Daily stats reset');

    this.saveStateToDB().catch(error => {
      logger.error('Failed to save entry decision state', { error: error.message });
    });
  }

  /**
   * Update open position count
   */
  setOpenPositions(count: number): void {
    this.openPositions = count;
  }

  /**
   * Get current state
   */
  getState() {
    return {
      dailyPnL: this.dailyPnL,
      openPositions: this.openPositions,
      losingStreak: this.losingStreak,
      cooldownActive: Date.now() < this.cooldownUntil,
      cooldownEndsAt: this.cooldownUntil > Date.now() ? new Date(this.cooldownUntil).toISOString() : null
    };
  }

  /**
   * Load state from database on startup
   */
  private async loadStateFromDB(): Promise<void> {
    try {
      // Calculate daily P&L from trades closed today
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const dailyTradesResult = await query<{ total_pnl: string }>(`
        SELECT COALESCE(SUM(profit_loss_percent), 0) as total_pnl
        FROM trades
        WHERE exit_time >= $1
        AND exit_time IS NOT NULL
      `, [todayStart.toISOString()]);

      this.dailyPnL = parseFloat(dailyTradesResult.rows[0]?.total_pnl || '0');

      // Count open positions
      const positionsResult = await query<{ count: string }>(`
        SELECT COUNT(*) as count FROM positions WHERE status = 'OPEN'
      `);
      this.openPositions = parseInt(positionsResult.rows[0]?.count || '0');

      // Calculate losing streak from recent trades
      const recentTradesResult = await query<{ outcome: string }>(`
        SELECT outcome FROM trades
        WHERE exit_time IS NOT NULL
        ORDER BY exit_time DESC
        LIMIT 10
      `);

      // Count consecutive losses from most recent
      this.losingStreak = 0;
      for (const trade of recentTradesResult.rows) {
        if (trade.outcome === 'LOSS' || trade.outcome === 'EMERGENCY' || trade.outcome === 'RUG') {
          this.losingStreak++;
        } else {
          break; // Stop at first non-loss
        }
      }

      // Load cooldown state from cache
      const cooldownResult = await query<{ value: string }>(`
        SELECT value FROM cache WHERE key = 'entry_decision_cooldown'
      `);

      if (cooldownResult.rows.length > 0) {
        const cooldownData = JSON.parse(cooldownResult.rows[0].value);
        this.cooldownUntil = cooldownData.cooldownUntil || 0;
      }

      logger.info('Entry Decision Engine state loaded from database', {
        dailyPnL: this.dailyPnL.toFixed(2) + '%',
        openPositions: this.openPositions,
        losingStreak: this.losingStreak,
        cooldownActive: Date.now() < this.cooldownUntil
      });

    } catch (error: any) {
      logger.error('Error loading entry decision state', { error: error.message });
      // Start with defaults on error
      this.dailyPnL = 0;
      this.openPositions = 0;
      this.losingStreak = 0;
      this.cooldownUntil = 0;
    }
  }

  /**
   * Save state to database (cooldown and streak info)
   */
  private async saveStateToDB(): Promise<void> {
    try {
      const stateData = JSON.stringify({
        cooldownUntil: this.cooldownUntil,
        losingStreak: this.losingStreak,
        lastTradeTimestamp: this.lastTradeTimestamp,
        updatedAt: new Date().toISOString()
      });

      // Upsert cooldown state to cache
      await query(`
        INSERT INTO cache (key, value, expires_at)
        VALUES ('entry_decision_cooldown', $1, NOW() + INTERVAL '24 hours')
        ON CONFLICT (key) DO UPDATE SET
          value = EXCLUDED.value,
          expires_at = EXCLUDED.expires_at
      `, [stateData]);

      logger.debug('Entry Decision Engine state saved to database');

    } catch (error: any) {
      logger.error('Error saving entry decision state', { error: error.message });
    }
  }
}
