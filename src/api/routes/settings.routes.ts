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

// Default settings structure
const DEFAULT_SETTINGS = {
  position_sizing: {
    maxPositionSize: 5,
    minPositionSize: 1,
    maxOpenPositions: 5,
    maxTotalExposure: 20,
    maxSingleTradeRisk: 1.5,
  },
  entry_rules: {
    minConvictionScore: 70,
    minSmartWalletCount: 2,
    maxTokenAge: 24,
    minLiquidityDepth: 30000,
    maxDipEntry: 30,
    minDipEntry: 20,
  },
  exit_rules: {
    defaultStopLoss: 25,
    earlyDiscoveryStopLoss: 15,
    trailingStopActivation: 20,
    trailingStopDistance: 15,
    timeBasedStopHours: 4,
  },
  take_profit: {
    level1: 30,
    level1Percent: 20,
    level2: 60,
    level2Percent: 25,
    level3: 100,
    level3Percent: 25,
    moonbagPercent: 15,
  },
  daily_limits: {
    maxDailyLoss: 8,
    maxDailyProfit: 15,
    losingStreakPause: 5,
    weeklyCircuitBreaker: 15,
  },
  execution: {
    maxSlippageBuy: 5,
    maxSlippageSell: 8,
    maxSlippageEmergency: 15,
    maxRetries: 2,
    targetLatencyMs: 500,
  },
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

    // Flatten for frontend
    const flatSettings = {
      // Position Sizing
      maxPositionSize: settings.position_sizing?.maxPositionSize ?? 5,
      minPositionSize: settings.position_sizing?.minPositionSize ?? 1,
      maxOpenPositions: settings.position_sizing?.maxOpenPositions ?? 5,
      maxTotalExposure: settings.position_sizing?.maxTotalExposure ?? 20,
      maxSingleTradeRisk: settings.position_sizing?.maxSingleTradeRisk ?? 1.5,

      // Entry Rules
      minConvictionScore: settings.entry_rules?.minConvictionScore ?? 70,
      minSmartWalletCount: settings.entry_rules?.minSmartWalletCount ?? 2,
      maxTokenAge: settings.entry_rules?.maxTokenAge ?? 24,
      minLiquidityDepth: settings.entry_rules?.minLiquidityDepth ?? 30000,
      maxDipEntry: settings.entry_rules?.maxDipEntry ?? 30,
      minDipEntry: settings.entry_rules?.minDipEntry ?? 20,

      // Exit Rules
      defaultStopLoss: settings.exit_rules?.defaultStopLoss ?? 25,
      earlyDiscoveryStopLoss: settings.exit_rules?.earlyDiscoveryStopLoss ?? 15,
      trailingStopActivation: settings.exit_rules?.trailingStopActivation ?? 20,
      trailingStopDistance: settings.exit_rules?.trailingStopDistance ?? 15,
      timeBasedStopHours: settings.exit_rules?.timeBasedStopHours ?? 4,

      // Take Profit
      takeProfitLevel1: settings.take_profit?.level1 ?? 30,
      takeProfitLevel1Percent: settings.take_profit?.level1Percent ?? 20,
      takeProfitLevel2: settings.take_profit?.level2 ?? 60,
      takeProfitLevel2Percent: settings.take_profit?.level2Percent ?? 25,
      takeProfitLevel3: settings.take_profit?.level3 ?? 100,
      takeProfitLevel3Percent: settings.take_profit?.level3Percent ?? 25,
      moonbagPercent: settings.take_profit?.moonbagPercent ?? 15,

      // Daily Limits
      maxDailyLoss: settings.daily_limits?.maxDailyLoss ?? 8,
      maxDailyProfit: settings.daily_limits?.maxDailyProfit ?? 15,
      losingStreakPause: settings.daily_limits?.losingStreakPause ?? 5,
      weeklyCircuitBreaker: settings.daily_limits?.weeklyCircuitBreaker ?? 15,

      // Execution
      maxSlippageBuy: settings.execution?.maxSlippageBuy ?? 5,
      maxSlippageSell: settings.execution?.maxSlippageSell ?? 8,
      maxSlippageEmergency: settings.execution?.maxSlippageEmergency ?? 15,
      maxRetries: settings.execution?.maxRetries ?? 2,
      targetLatencyMs: settings.execution?.targetLatencyMs ?? 500,

      // Notifications
      telegramEnabled: settings.notifications?.telegramEnabled ?? false,
      telegramChatId: settings.notifications?.telegramChatId ?? '',
      discordEnabled: settings.notifications?.discordEnabled ?? false,
      discordWebhook: settings.notifications?.discordWebhook ?? '',
    };

    res.json({
      success: true,
      data: flatSettings,
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

    // Group updates by category
    const grouped: Record<string, Record<string, any>> = {
      position_sizing: {},
      entry_rules: {},
      exit_rules: {},
      take_profit: {},
      daily_limits: {},
      execution: {},
      notifications: {},
    };

    // Map flat keys to grouped
    const keyMap: Record<string, [string, string]> = {
      maxPositionSize: ['position_sizing', 'maxPositionSize'],
      minPositionSize: ['position_sizing', 'minPositionSize'],
      maxOpenPositions: ['position_sizing', 'maxOpenPositions'],
      maxTotalExposure: ['position_sizing', 'maxTotalExposure'],
      maxSingleTradeRisk: ['position_sizing', 'maxSingleTradeRisk'],
      minConvictionScore: ['entry_rules', 'minConvictionScore'],
      minSmartWalletCount: ['entry_rules', 'minSmartWalletCount'],
      maxTokenAge: ['entry_rules', 'maxTokenAge'],
      minLiquidityDepth: ['entry_rules', 'minLiquidityDepth'],
      maxDipEntry: ['entry_rules', 'maxDipEntry'],
      minDipEntry: ['entry_rules', 'minDipEntry'],
      defaultStopLoss: ['exit_rules', 'defaultStopLoss'],
      earlyDiscoveryStopLoss: ['exit_rules', 'earlyDiscoveryStopLoss'],
      trailingStopActivation: ['exit_rules', 'trailingStopActivation'],
      trailingStopDistance: ['exit_rules', 'trailingStopDistance'],
      timeBasedStopHours: ['exit_rules', 'timeBasedStopHours'],
      takeProfitLevel1: ['take_profit', 'level1'],
      takeProfitLevel1Percent: ['take_profit', 'level1Percent'],
      takeProfitLevel2: ['take_profit', 'level2'],
      takeProfitLevel2Percent: ['take_profit', 'level2Percent'],
      takeProfitLevel3: ['take_profit', 'level3'],
      takeProfitLevel3Percent: ['take_profit', 'level3Percent'],
      moonbagPercent: ['take_profit', 'moonbagPercent'],
      maxDailyLoss: ['daily_limits', 'maxDailyLoss'],
      maxDailyProfit: ['daily_limits', 'maxDailyProfit'],
      losingStreakPause: ['daily_limits', 'losingStreakPause'],
      weeklyCircuitBreaker: ['daily_limits', 'weeklyCircuitBreaker'],
      maxSlippageBuy: ['execution', 'maxSlippageBuy'],
      maxSlippageSell: ['execution', 'maxSlippageSell'],
      maxSlippageEmergency: ['execution', 'maxSlippageEmergency'],
      maxRetries: ['execution', 'maxRetries'],
      targetLatencyMs: ['execution', 'targetLatencyMs'],
      telegramEnabled: ['notifications', 'telegramEnabled'],
      telegramChatId: ['notifications', 'telegramChatId'],
      discordEnabled: ['notifications', 'discordEnabled'],
      discordWebhook: ['notifications', 'discordWebhook'],
    };

    for (const [key, value] of Object.entries(updates)) {
      const mapping = keyMap[key];
      if (mapping) {
        const [category, field] = mapping;
        grouped[category][field] = value;
      }
    }

    // Update each category that has changes
    for (const [category, values] of Object.entries(grouped)) {
      if (Object.keys(values).length > 0) {
        // Get existing values
        const existing = await getPool().query(
          `SELECT value FROM bot_settings WHERE key = $1`,
          [category]
        );

        const currentValue = existing.rows[0]?.value || DEFAULT_SETTINGS[category as keyof typeof DEFAULT_SETTINGS] || {};
        const newValue = { ...currentValue, ...values };

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
