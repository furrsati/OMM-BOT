import { Router } from 'express';
import {
  asyncHandler,
  requireAuth,
  validateBody,
  schemas,
  auditLog,
} from '../middleware';
import { getPool } from '../../db/postgres';

const router = Router();

// Require authentication for all settings routes
router.use(requireAuth);

// Default settings structure based on claude.md V3.0 rulebook
const DEFAULT_SETTINGS = {
  // Category 6: Position Sizing
  position_sizing: {
    highConvictionSize: 5,      // 85-100 conviction: 4-5% of wallet
    mediumConvictionSize: 3,    // 70-84 conviction: 2-3% of wallet
    lowConvictionSize: 1,       // 50-69 conviction: 1% of wallet
    maxOpenPositions: 5,        // Max 3-5 positions
    maxTotalExposure: 20,       // Never exceed 20% of wallet
    maxSingleTradeRisk: 1.5,    // Max 1.5% of portfolio per trade
  },
  // Category 5: Entry Rules
  entry_rules: {
    highConvictionThreshold: 85,    // 85-100 = HIGH CONVICTION
    mediumConvictionThreshold: 70,  // 70-84 = MEDIUM CONVICTION
    lowConvictionThreshold: 50,     // 50-69 = LOW CONVICTION, below 50 = REJECT
    minSmartWalletCountTier1: 3,    // 3+ Tier 1/2 wallets for primary trigger
    minSmartWalletCountEarly: 2,    // 2+ Tier 1 for early discovery
    minLiquidityDepth: 30000,       // Min $30K liquidity (below is risky)
    preferredLiquidityDepth: 50000, // $50K+ for +10 points
    minDipEntry: 20,                // Enter on 20-30% dip from local high
    maxDipEntry: 30,
    maxTokenAgeMinutes: 10,         // Under 10 min = 0 points (higher risk)
    tokenAgeBonus: 60,              // > 1 hour = +5 points
  },
  // Category 9: Stop-Loss System
  exit_rules: {
    defaultStopLoss: 25,            // -25% hard stop-loss
    earlyDiscoveryStopLoss: 15,     // -15% for early discovery entries
    trailingStopActivation: 20,     // Activate trailing at +20%
    trailingStop20to50: 15,         // Up 20-50%: trail at 15% below
    trailingStop50to100: 12,        // Up 50-100%: trail at 12% below
    trailingStop100plus: 10,        // Up 100%+: trail at 10% below
    timeBasedStopHours: 4,          // Exit if position stale 4+ hours
    timeBasedStopMinPnL: -5,        // Time stop only if between -5% and +10%
    timeBasedStopMaxPnL: 10,
  },
  // Category 10: Take-Profit Strategy (Standard Entry)
  take_profit: {
    level1: 30,           // At +30%: Sell 20%
    level1Percent: 20,
    level2: 60,           // At +60%: Sell 25%
    level2Percent: 25,
    level3: 100,          // At +100%: Sell 25%
    level3Percent: 25,
    level4: 200,          // At +200%: Sell 15%
    level4Percent: 15,
    moonbagPercent: 15,   // Hold remaining 15% as moonbag
  },
  // Category 10: Take-Profit Strategy (Early Discovery Entry)
  take_profit_early: {
    level1: 50,           // At +50%: Sell 25%
    level1Percent: 25,
    level2: 100,          // At +100%: Sell 25%
    level2Percent: 25,
    level3: 200,          // At +200%: Sell 25%
    level3Percent: 25,
    moonbagPercent: 25,   // Hold remaining 25% as moonbag
  },
  // Category 11: Daily Limits & Discipline
  daily_limits: {
    maxDailyLoss: 8,              // -8%: STOP ALL TRADING, 12-hour cooldown
    maxDailyProfit: 15,           // +15%: Stop new entries
    losingStreakPause: 5,         // 5+ losses: FULL STOP for 6 hours
    losingStreakPauseHours: 6,
    weeklyCircuitBreaker: 15,     // -15% weekly: pause 48 hours
    weeklyCircuitBreakerHours: 48,
    losingStreak2Reduction: 25,   // 2 losses: reduce sizes by 25%
    losingStreak3Reduction: 50,   // 3+ losses: reduce sizes by 50%
  },
  // Category 7: Execution & Infrastructure
  execution: {
    maxSlippageBuy: 5,            // 3-5% max slippage on buys
    maxSlippageSell: 8,           // 5-8% max slippage on sells
    maxSlippageEmergency: 15,     // 10-15% for emergency sells
    maxRetries: 2,                // Retry up to 2 times
    retryPriorityFeeMultiplier: 1.5, // 1.5x priority fee each retry
    targetLatencyMs: 500,         // Sub-500ms target
  },
  // Category 3: Market Conditions thresholds
  market_conditions: {
    solCautionThreshold: 3,       // SOL down 3-7%: CAUTIOUS MODE
    solDefensiveThreshold: 7,     // SOL down 7-15%: DEFENSIVE MODE
    solPauseThreshold: 15,        // SOL down 15%+: PAUSE MODE
    btcCautionThreshold: 5,       // BTC down 5%: reduce sizes 25%
    btcDefensiveThreshold: 10,    // BTC down 10%: DEFENSIVE MODE
    offPeakConvictionBoost: 10,   // Raise threshold by +10 during off-peak
    peakHoursStart: 9,            // 9 AM EST
    peakHoursEnd: 23,             // 11 PM EST
  },
  // Category 1: Learning Engine Weights (adjustable)
  learning_weights: {
    smartWallet: 30,              // Default 30% weight
    tokenSafety: 25,              // Default 25% weight
    marketConditions: 15,         // Default 15% weight
    socialSignals: 10,            // Default 10% weight
    entryQuality: 20,             // Default 20% weight
    minWeight: 5,                 // No category below 5%
    maxWeight: 40,                // No category above 40%
    maxAdjustmentPerCycle: 5,     // Max ±5% per cycle
  },
  // Notifications
  notifications: {
    telegramEnabled: false,
    telegramChatId: '',
    discordEnabled: false,
    discordWebhook: '',
  },
};

/**
 * GET /api/settings
 * Get all bot settings
 */
router.get(
  '/',
  asyncHandler(async (_req: any, res: any) => {
    const result = await getPool().query(
      `SELECT key, value FROM bot_settings`
    );

    // Build settings object from database
    const settings: Record<string, any> = { ...DEFAULT_SETTINGS };

    for (const row of result.rows) {
      settings[row.key] = row.value;
    }

    // Return all settings grouped by category
    const allSettings = {
      position_sizing: {
        highConvictionSize: settings.position_sizing?.highConvictionSize ?? 5,
        mediumConvictionSize: settings.position_sizing?.mediumConvictionSize ?? 3,
        lowConvictionSize: settings.position_sizing?.lowConvictionSize ?? 1,
        maxOpenPositions: settings.position_sizing?.maxOpenPositions ?? 5,
        maxTotalExposure: settings.position_sizing?.maxTotalExposure ?? 20,
        maxSingleTradeRisk: settings.position_sizing?.maxSingleTradeRisk ?? 1.5,
      },
      entry_rules: {
        highConvictionThreshold: settings.entry_rules?.highConvictionThreshold ?? 85,
        mediumConvictionThreshold: settings.entry_rules?.mediumConvictionThreshold ?? 70,
        lowConvictionThreshold: settings.entry_rules?.lowConvictionThreshold ?? 50,
        minSmartWalletCountTier1: settings.entry_rules?.minSmartWalletCountTier1 ?? 3,
        minSmartWalletCountEarly: settings.entry_rules?.minSmartWalletCountEarly ?? 2,
        minLiquidityDepth: settings.entry_rules?.minLiquidityDepth ?? 30000,
        preferredLiquidityDepth: settings.entry_rules?.preferredLiquidityDepth ?? 50000,
        minDipEntry: settings.entry_rules?.minDipEntry ?? 20,
        maxDipEntry: settings.entry_rules?.maxDipEntry ?? 30,
        maxTokenAgeMinutes: settings.entry_rules?.maxTokenAgeMinutes ?? 10,
        tokenAgeBonus: settings.entry_rules?.tokenAgeBonus ?? 60,
      },
      exit_rules: {
        defaultStopLoss: settings.exit_rules?.defaultStopLoss ?? 25,
        earlyDiscoveryStopLoss: settings.exit_rules?.earlyDiscoveryStopLoss ?? 15,
        trailingStopActivation: settings.exit_rules?.trailingStopActivation ?? 20,
        trailingStop20to50: settings.exit_rules?.trailingStop20to50 ?? 15,
        trailingStop50to100: settings.exit_rules?.trailingStop50to100 ?? 12,
        trailingStop100plus: settings.exit_rules?.trailingStop100plus ?? 10,
        timeBasedStopHours: settings.exit_rules?.timeBasedStopHours ?? 4,
        timeBasedStopMinPnL: settings.exit_rules?.timeBasedStopMinPnL ?? -5,
        timeBasedStopMaxPnL: settings.exit_rules?.timeBasedStopMaxPnL ?? 10,
      },
      take_profit: {
        level1: settings.take_profit?.level1 ?? 30,
        level1Percent: settings.take_profit?.level1Percent ?? 20,
        level2: settings.take_profit?.level2 ?? 60,
        level2Percent: settings.take_profit?.level2Percent ?? 25,
        level3: settings.take_profit?.level3 ?? 100,
        level3Percent: settings.take_profit?.level3Percent ?? 25,
        level4: settings.take_profit?.level4 ?? 200,
        level4Percent: settings.take_profit?.level4Percent ?? 15,
        moonbagPercent: settings.take_profit?.moonbagPercent ?? 15,
      },
      take_profit_early: {
        level1: settings.take_profit_early?.level1 ?? 50,
        level1Percent: settings.take_profit_early?.level1Percent ?? 25,
        level2: settings.take_profit_early?.level2 ?? 100,
        level2Percent: settings.take_profit_early?.level2Percent ?? 25,
        level3: settings.take_profit_early?.level3 ?? 200,
        level3Percent: settings.take_profit_early?.level3Percent ?? 25,
        moonbagPercent: settings.take_profit_early?.moonbagPercent ?? 25,
      },
      daily_limits: {
        maxDailyLoss: settings.daily_limits?.maxDailyLoss ?? 8,
        maxDailyProfit: settings.daily_limits?.maxDailyProfit ?? 15,
        losingStreakPause: settings.daily_limits?.losingStreakPause ?? 5,
        losingStreakPauseHours: settings.daily_limits?.losingStreakPauseHours ?? 6,
        weeklyCircuitBreaker: settings.daily_limits?.weeklyCircuitBreaker ?? 15,
        weeklyCircuitBreakerHours: settings.daily_limits?.weeklyCircuitBreakerHours ?? 48,
        losingStreak2Reduction: settings.daily_limits?.losingStreak2Reduction ?? 25,
        losingStreak3Reduction: settings.daily_limits?.losingStreak3Reduction ?? 50,
      },
      execution: {
        maxSlippageBuy: settings.execution?.maxSlippageBuy ?? 5,
        maxSlippageSell: settings.execution?.maxSlippageSell ?? 8,
        maxSlippageEmergency: settings.execution?.maxSlippageEmergency ?? 15,
        maxRetries: settings.execution?.maxRetries ?? 2,
        retryPriorityFeeMultiplier: settings.execution?.retryPriorityFeeMultiplier ?? 1.5,
        targetLatencyMs: settings.execution?.targetLatencyMs ?? 500,
      },
      market_conditions: {
        solCautionThreshold: settings.market_conditions?.solCautionThreshold ?? 3,
        solDefensiveThreshold: settings.market_conditions?.solDefensiveThreshold ?? 7,
        solPauseThreshold: settings.market_conditions?.solPauseThreshold ?? 15,
        btcCautionThreshold: settings.market_conditions?.btcCautionThreshold ?? 5,
        btcDefensiveThreshold: settings.market_conditions?.btcDefensiveThreshold ?? 10,
        offPeakConvictionBoost: settings.market_conditions?.offPeakConvictionBoost ?? 10,
        peakHoursStart: settings.market_conditions?.peakHoursStart ?? 9,
        peakHoursEnd: settings.market_conditions?.peakHoursEnd ?? 23,
      },
      learning_weights: {
        smartWallet: settings.learning_weights?.smartWallet ?? 30,
        tokenSafety: settings.learning_weights?.tokenSafety ?? 25,
        marketConditions: settings.learning_weights?.marketConditions ?? 15,
        socialSignals: settings.learning_weights?.socialSignals ?? 10,
        entryQuality: settings.learning_weights?.entryQuality ?? 20,
        minWeight: settings.learning_weights?.minWeight ?? 5,
        maxWeight: settings.learning_weights?.maxWeight ?? 40,
        maxAdjustmentPerCycle: settings.learning_weights?.maxAdjustmentPerCycle ?? 5,
      },
      notifications: {
        telegramEnabled: settings.notifications?.telegramEnabled ?? false,
        telegramChatId: settings.notifications?.telegramChatId ?? '',
        discordEnabled: settings.notifications?.discordEnabled ?? false,
        discordWebhook: settings.notifications?.discordWebhook ?? '',
      },
    };

    res.json({
      success: true,
      data: allSettings,
    });
  })
);

/**
 * PUT /api/settings
 * Update bot settings
 */
router.put(
  '/',
  validateBody(schemas.settingsUpdate),
  auditLog('SETTINGS_UPDATE'),
  asyncHandler(async (req: any, res: any) => {
    const updates = req.body;

    // Settings are updated by category directly
    // Accept updates in the format: { category: { field: value } }
    const validCategories = [
      'position_sizing',
      'entry_rules',
      'exit_rules',
      'take_profit',
      'take_profit_early',
      'daily_limits',
      'execution',
      'market_conditions',
      'learning_weights',
      'notifications',
    ];

    // Update each category that has changes
    for (const [category, values] of Object.entries(updates)) {
      if (!validCategories.includes(category)) {
        continue;
      }
      if (typeof values !== 'object' || values === null) {
        continue;
      }
      if (Object.keys(values as object).length > 0) {
        // Get existing values
        const existing = await getPool().query(
          `SELECT value FROM bot_settings WHERE key = $1`,
          [category]
        );

        const currentValue = existing.rows[0]?.value || DEFAULT_SETTINGS[category as keyof typeof DEFAULT_SETTINGS] || {};
        const newValue = { ...currentValue, ...(values as object) };

        await getPool().query(
          `INSERT INTO bot_settings (key, value, updated_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
          [category, JSON.stringify(newValue)]
        );
      }
    }

    res.json({
      success: true,
      message: 'Settings updated',
    });
  })
);

/**
 * POST /api/settings/reset
 * Reset all settings to defaults
 */
router.post(
  '/reset',
  auditLog('SETTINGS_RESET'),
  asyncHandler(async (_req: any, res: any) => {
    // Delete all settings and re-insert defaults
    await getPool().query(`DELETE FROM bot_settings`);

    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      await getPool().query(
        `INSERT INTO bot_settings (key, value) VALUES ($1, $2)`,
        [key, JSON.stringify(value)]
      );
    }

    res.json({
      success: true,
      message: 'Settings reset to defaults',
    });
  })
);

export default router;
