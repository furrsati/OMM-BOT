import { Router } from 'express';
import {
  asyncHandler,
  controlLimiter,
  criticalLimiter,
  requireAuth,
  validateBody,
  schemas,
  auditLog,
} from '../middleware';
import { botContextManager } from '../services/bot-context';

const router = Router();

// Apply rate limiting to all bot control routes
router.use(controlLimiter);

// Require authentication for all bot control routes
router.use(requireAuth);

/**
 * POST /api/bot/start
 * Start the bot
 */
router.post(
  '/start',
  auditLog('BOT_START'),
  asyncHandler(async (req: any, res: any) => {
    const ctx = botContextManager.getContext();

    botContextManager.updateState({ isRunning: true, isPaused: false });

    await ctx.alertManager.sendAlert({
      level: 'HIGH',
      type: 'BOT_STARTED',
      message: '🚀 Bot started via dashboard',
      timestamp: new Date(),
    });

    res.json({
      success: true,
      message: 'Bot started successfully',
      data: {
        isRunning: true,
        isPaused: false,
      },
    });
  })
);

/**
 * POST /api/bot/stop
 * Stop the bot
 */
router.post(
  '/stop',
  auditLog('BOT_STOP'),
  asyncHandler(async (req: any, res: any) => {
    const ctx = botContextManager.getContext();

    botContextManager.updateState({ isRunning: false, isPaused: false });

    await ctx.alertManager.sendAlert({
      level: 'HIGH',
      type: 'BOT_STOPPED',
      message: '🛑 Bot stopped via dashboard',
      timestamp: new Date(),
    });

    res.json({
      success: true,
      message: 'Bot stopped successfully',
      data: {
        isRunning: false,
        isPaused: false,
      },
    });
  })
);

/**
 * POST /api/bot/pause
 * Pause trading (bot keeps monitoring)
 */
router.post(
  '/pause',
  auditLog('BOT_PAUSE'),
  asyncHandler(async (req: any, res: any) => {
    const ctx = botContextManager.getContext();

    botContextManager.updateState({ isPaused: true });

    await ctx.alertManager.sendAlert({
      level: 'MEDIUM',
      type: 'BOT_PAUSED',
      message: '⏸️ Bot paused via dashboard - new entries disabled',
      timestamp: new Date(),
    });

    res.json({
      success: true,
      message: 'Bot paused successfully',
      data: {
        isRunning: ctx.isRunning,
        isPaused: true,
      },
    });
  })
);

/**
 * POST /api/bot/resume
 * Resume trading
 */
router.post(
  '/resume',
  auditLog('BOT_RESUME'),
  asyncHandler(async (req: any, res: any) => {
    const ctx = botContextManager.getContext();

    botContextManager.updateState({ isPaused: false });

    await ctx.alertManager.sendAlert({
      level: 'MEDIUM',
      type: 'BOT_RESUMED',
      message: '▶️ Bot resumed via dashboard',
      timestamp: new Date(),
    });

    res.json({
      success: true,
      message: 'Bot resumed successfully',
      data: {
        isRunning: ctx.isRunning,
        isPaused: false,
      },
    });
  })
);

/**
 * POST /api/bot/kill
 * Emergency kill switch - stop all trading and exit all positions
 * SECURITY: Critical operation with extra rate limiting
 */
router.post(
  '/kill',
  criticalLimiter,
  auditLog('BOT_KILL'),
  asyncHandler(async (req: any, res: any) => {
    const ctx = botContextManager.getContext();

    await ctx.killSwitch.trigger('DASHBOARD_EMERGENCY_STOP');

    botContextManager.updateState({ isRunning: false, isPaused: false, tradingEnabled: false });

    res.json({
      success: true,
      message: 'Kill switch activated. Emergency shutdown initiated.',
      data: {
        triggered: true,
        timestamp: new Date().toISOString(),
      },
    });
  })
);

/**
 * POST /api/bot/config
 * Update bot configuration (paper trading mode, trading enabled)
 */
router.post(
  '/config',
  validateBody(schemas.botConfig),
  auditLog('CONFIG_UPDATE'),
  asyncHandler(async (req: any, res: any) => {
    const ctx = botContextManager.getContext();
    const { paperTradingMode, tradingEnabled } = req.body;

    const updates: any = {};
    const messages: string[] = [];

    if (typeof paperTradingMode === 'boolean') {
      updates.paperTradingMode = paperTradingMode;
      messages.push(paperTradingMode ? '📝 Paper trading mode ENABLED' : '💰 LIVE trading mode ENABLED');
    }

    if (typeof tradingEnabled === 'boolean') {
      updates.tradingEnabled = tradingEnabled;
      messages.push(tradingEnabled ? '✅ Trading ENABLED' : '⛔ Trading DISABLED');
    }

    if (Object.keys(updates).length > 0) {
      botContextManager.updateState(updates);

      // Send alert for each change
      for (const message of messages) {
        await ctx.alertManager.sendAlert({
          level: 'HIGH',
          type: 'CONFIG_CHANGED',
          message,
          timestamp: new Date(),
        });
      }
    }

    res.json({
      success: true,
      message: 'Configuration updated',
      data: {
        paperTradingMode: botContextManager.isPaperTradingMode(),
        tradingEnabled: botContextManager.isTradingEnabled(),
      },
    });
  })
);

/**
 * POST /api/bot/regime
 * Override market regime
 */
router.post(
  '/regime',
  validateBody(schemas.regimeOverride),
  auditLog('REGIME_OVERRIDE'),
  asyncHandler(async (req: any, res: any) => {
    const ctx = botContextManager.getContext();
    const { regime } = req.body;
    // Validation is handled by schema

    ctx.regimeDetector.setManualOverride(regime);

    await ctx.alertManager.sendAlert({
      level: 'HIGH',
      type: 'REGIME_OVERRIDE',
      message: `⚡ Market regime manually set to: ${regime}`,
      timestamp: new Date(),
    });

    res.json({
      success: true,
      message: `Market regime set to ${regime}`,
      data: {
        regime,
        isOverride: true,
      },
    });
  })
);

export default router;
