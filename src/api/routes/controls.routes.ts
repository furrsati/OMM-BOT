import { Router } from 'express';
import { asyncHandler, controlLimiter } from '../middleware';
import { botContextManager } from '../services/bot-context';

const router = Router();

// Apply stricter rate limiting to all control routes
router.use(controlLimiter);

/**
 * POST /api/controls/pause
 * Pause new trade entries (existing positions continue to be managed)
 */
router.post(
  '/pause',
  asyncHandler(async (req: any, res: any) => {
    const ctx = botContextManager.getContext();

    // Update bot state
    botContextManager.updateState({ isPaused: true });

    // Log the action
    await ctx.alertManager.sendAlert({
      level: 'MEDIUM',
      type: 'BOT_PAUSED',
      message: '⏸️  Bot paused via API - new entries disabled',
      timestamp: new Date(),
    });

    res.json({
      success: true,
      message: 'Bot paused successfully. New entries disabled.',
      data: {
        isPaused: true,
        isRunning: ctx.isRunning,
      },
    });
  })
);

/**
 * POST /api/controls/resume
 * Resume normal trading operations
 */
router.post(
  '/resume',
  asyncHandler(async (req: any, res: any) => {
    const ctx = botContextManager.getContext();

    // Update bot state
    botContextManager.updateState({ isPaused: false });

    // Log the action
    await ctx.alertManager.sendAlert({
      level: 'MEDIUM',
      type: 'BOT_RESUMED',
      message: '▶️  Bot resumed via API - normal operations',
      timestamp: new Date(),
    });

    res.json({
      success: true,
      message: 'Bot resumed successfully. Normal operations.',
      data: {
        isPaused: false,
        isRunning: ctx.isRunning,
      },
    });
  })
);

/**
 * POST /api/controls/kill-switch
 * Emergency shutdown - stop all trading and exit all positions
 */
router.post(
  '/kill-switch',
  asyncHandler(async (req: any, res: any) => {
    const ctx = botContextManager.getContext();

    // Trigger kill switch
    await ctx.killSwitch.trigger('API_EMERGENCY_STOP');

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
 * GET /api/controls/kill-switch/status
 * Check kill switch status
 */
router.get(
  '/kill-switch/status',
  asyncHandler(async (req: any, res: any) => {
    const ctx = botContextManager.getContext();

    const isTriggered = ctx.killSwitch.isTriggered();

    res.json({
      success: true,
      data: {
        triggered: isTriggered,
        enabled: process.env.ENABLE_KILL_SWITCH === 'true',
      },
    });
  })
);

/**
 * GET /api/controls/state
 * Get current bot control state
 */
router.get(
  '/state',
  asyncHandler(async (req: any, res: any) => {
    const ctx = botContextManager.getContext();

    res.json({
      success: true,
      data: {
        isRunning: ctx.isRunning,
        isPaused: ctx.isPaused,
        tradingEnabled: process.env.ENABLE_TRADING === 'true',
        paperTradingMode: process.env.PAPER_TRADING_MODE === 'true',
        killSwitchTriggered: ctx.killSwitch.isTriggered(),
      },
    });
  })
);

export default router;
