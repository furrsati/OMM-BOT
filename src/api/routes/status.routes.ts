import { Router } from 'express';
import { asyncHandler } from '../middleware';
import { botContextManager } from '../services/bot-context';
import { healthCheck as dbHealthCheck } from '../../db/postgres';
import { healthCheck as cacheHealthCheck } from '../../db/cache';

const router = Router();

/**
 * GET /api/status/health
 * Health check endpoint for monitoring services (Render, cron-job.org, etc.)
 */
router.get(
  '/health',
  asyncHandler(async (req: any, res: any) => {
    const ctx = botContextManager.getContext();

    // Check RPC
    let rpcHealthy = false;
    let rpcError = null;
    try {
      const slot = await ctx.connection.getSlot();
      rpcHealthy = slot > 0;
    } catch (error: any) {
      rpcError = error.message;
    }

    // Check Database
    const dbHealthy = await dbHealthCheck();

    // Check Cache
    const cacheHealthy = await cacheHealthCheck();

    // Overall health
    const isHealthy = rpcHealthy && dbHealthy && cacheHealthy;

    res.status(isHealthy ? 200 : 503).json({
      success: true,
      data: {
        status: isHealthy ? 'healthy' : 'degraded',
        timestamp: new Date().toISOString(),
        uptime: Math.floor((Date.now() - ctx.startTime.getTime()) / 1000), // seconds
        services: {
          rpc: {
            healthy: rpcHealthy,
            error: rpcError,
          },
          database: {
            healthy: dbHealthy,
          },
          cache: {
            healthy: cacheHealthy,
          },
        },
      },
    });
  })
);

/**
 * GET /api/status
 * Get current bot status and configuration
 */
router.get(
  '/',
  asyncHandler(async (req: any, res: any) => {
    const ctx = botContextManager.getContext();

    // Get current market regime
    const regimeState = ctx.regimeDetector.getRegimeState();

    // Get decision engine state
    const decisionState = ctx.entryDecision.getState();

    // Get position stats
    const positionStats = ctx.positionManager.getStats();

    // Get execution stats
    const execStats = ctx.executionManager.getStats();

    // Get learning engine status
    const learningStatus = ctx.learningScheduler.getStatus();

    res.json({
      success: true,
      data: {
        bot: {
          isRunning: ctx.isRunning,
          isPaused: ctx.isPaused,
          tradingEnabled: botContextManager.isTradingEnabled(),
          paperTradingMode: botContextManager.isPaperTradingMode(),
          uptime: Math.floor((Date.now() - ctx.startTime.getTime()) / 1000),
          startTime: ctx.startTime.toISOString(),
        },
        market: {
          regime: regimeState.regime,
          reason: regimeState.reason,
          solChange24h: regimeState.solChange24h,
          btcChange24h: regimeState.btcChange24h,
        },
        trading: {
          dailyPnL: decisionState.dailyPnL,
          openPositions: decisionState.openPositions,
          losingStreak: decisionState.losingStreak,
          cooldownActive: decisionState.cooldownActive,
        },
        positions: {
          open: positionStats.openPositions,
          totalTrades: positionStats.totalTrades,
          winRate: positionStats.winRate,
          totalPnL: positionStats.totalPnL,
        },
        execution: {
          pendingBuys: execStats.pendingBuys,
          pendingSells: execStats.pendingSells,
          totalExecutions: execStats.totalExecutions,
          successRate: execStats.successRate,
        },
        learning: {
          active: learningStatus.isActive,
          totalTrades: learningStatus.totalTrades,
          lastWeightOptimization: learningStatus.lastWeightOptimization,
          lastParameterTuning: learningStatus.lastParameterTuning,
        },
      },
    });
  })
);

/**
 * GET /api/status/config
 * Get current bot configuration
 */
router.get(
  '/config',
  asyncHandler(async (req: any, res: any) => {
    res.json({
      success: true,
      data: {
        trading: {
          maxPositionSizePercent: parseFloat(process.env.MAX_POSITION_SIZE_PERCENT || '5'),
          maxDailyLossPercent: parseFloat(process.env.MAX_DAILY_LOSS_PERCENT || '8'),
          maxDailyProfitPercent: parseFloat(process.env.MAX_DAILY_PROFIT_PERCENT || '15'),
          defaultStopLossPercent: parseFloat(process.env.DEFAULT_STOP_LOSS_PERCENT || '25'),
          maxOpenPositions: parseInt(process.env.MAX_OPEN_POSITIONS || '5', 10),
        },
        conviction: {
          highThreshold: parseFloat(process.env.HIGH_CONVICTION_THRESHOLD || '85'),
          mediumThreshold: parseFloat(process.env.MEDIUM_CONVICTION_THRESHOLD || '70'),
          lowThreshold: parseFloat(process.env.LOW_CONVICTION_THRESHOLD || '50'),
        },
        execution: {
          maxBuySlippage: parseFloat(process.env.MAX_BUY_SLIPPAGE || '5'),
          maxSellSlippage: parseFloat(process.env.MAX_SELL_SLIPPAGE || '8'),
          maxEmergencySlippage: parseFloat(process.env.MAX_EMERGENCY_SLIPPAGE || '15'),
        },
        environment: {
          nodeEnv: process.env.NODE_ENV || 'development',
          tradingEnabled: botContextManager.isTradingEnabled(),
          paperTradingMode: botContextManager.isPaperTradingMode(),
        },
      },
    });
  })
);

export default router;
