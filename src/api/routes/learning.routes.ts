import { Router } from 'express';
import { asyncHandler } from '../middleware';
import { botContextManager } from '../services/bot-context';
import { getPool } from '../../db/postgres';

const router = Router();

/**
 * GET /api/learning/weights
 * Get current category weights
 */
router.get(
  '/weights',
  asyncHandler(async (req: any, res: any) => {
    const ctx = botContextManager.getContext();

    // Get current weights from learning scheduler
    const weights = await ctx.learningScheduler.getCurrentWeights();

    res.json({
      success: true,
      data: weights,
    });
  })
);

/**
 * GET /api/learning/parameters
 * Get current optimized parameters
 */
router.get(
  '/parameters',
  asyncHandler(async (req: any, res: any) => {
    // Get active bot parameters from database
    const result = await getPool().query(
      `SELECT * FROM bot_parameters WHERE is_active = true ORDER BY version DESC LIMIT 1`
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No active bot parameters found',
        code: 'NO_PARAMETERS',
      });
    }

    const row = result.rows[0];
    const parameters = {
      version: row.version,
      dipEntryRange: row.dip_entry_range,
      stopLossPercent: parseFloat(row.stop_loss_percent),
      positionSizes: row.position_sizes,
      maxOpenPositions: row.max_open_positions,
      maxDailyLoss: parseFloat(row.max_daily_loss),
      maxDailyProfit: parseFloat(row.max_daily_profit),
      createdAt: row.created_at,
    };

    res.json({
      success: true,
      data: parameters,
    });
  })
);

/**
 * GET /api/learning/patterns
 * Get win and danger patterns summary
 */
router.get(
  '/patterns',
  asyncHandler(async (req: any, res: any) => {
    // Get win patterns count
    const winResult = await getPool().query(
      `SELECT COUNT(*) as count, AVG(avg_return) as avg_return FROM win_patterns`
    );

    // Get danger patterns count
    const dangerResult = await getPool().query(
      `SELECT COUNT(*) as count, AVG(confidence_score) as avg_confidence FROM danger_patterns`
    );

    // Get top 5 win patterns
    const topWinPatterns = await getPool().query(
      `SELECT id, avg_return, occurrences, last_seen
       FROM win_patterns
       ORDER BY avg_return DESC
       LIMIT 5`
    );

    // Get top 5 danger patterns
    const topDangerPatterns = await getPool().query(
      `SELECT id, confidence_score, occurrences, last_seen
       FROM danger_patterns
       ORDER BY confidence_score DESC
       LIMIT 5`
    );

    res.json({
      success: true,
      data: {
        winPatterns: {
          count: parseInt(winResult.rows[0].count || '0', 10),
          avgReturn: parseFloat(winResult.rows[0].avg_return || '0'),
          top: topWinPatterns.rows.map((row) => ({
            id: row.id,
            avgReturn: parseFloat(row.avg_return),
            occurrences: row.occurrences,
            lastSeen: row.last_seen,
          })),
        },
        dangerPatterns: {
          count: parseInt(dangerResult.rows[0].count || '0', 10),
          avgConfidence: parseFloat(dangerResult.rows[0].avg_confidence || '0'),
          top: topDangerPatterns.rows.map((row) => ({
            id: row.id,
            confidence: parseFloat(row.confidence_score),
            occurrences: row.occurrences,
            lastSeen: row.last_seen,
          })),
        },
      },
    });
  })
);

/**
 * GET /api/learning/snapshots
 * Get historical learning snapshots
 */
router.get(
  '/snapshots',
  asyncHandler(async (req: any, res: any) => {
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 10, 50);

    const result = await getPool().query(
      `SELECT
        id,
        version,
        weights,
        parameters,
        trade_count,
        win_rate,
        profit_factor,
        created_at
      FROM learning_snapshots
      ORDER BY version DESC
      LIMIT $1`,
      [limit]
    );

    const snapshots = result.rows.map((row) => ({
      id: row.id,
      version: row.version,
      weights: row.weights,
      parameters: row.parameters,
      tradeCount: row.trade_count,
      winRate: parseFloat(row.win_rate),
      profitFactor: parseFloat(row.profit_factor),
      createdAt: row.created_at,
    }));

    res.json({
      success: true,
      data: snapshots,
    });
  })
);

/**
 * GET /api/learning/stats
 * Get learning engine statistics
 */
router.get(
  '/stats',
  asyncHandler(async (req: any, res: any) => {
    // Get total trades count
    const tradesResult = await getPool().query(
      `SELECT COUNT(*) as total FROM trades`
    );

    // Get latest snapshot for optimization info
    const snapshotResult = await getPool().query(
      `SELECT version, created_at, trade_count FROM learning_snapshots ORDER BY version DESC LIMIT 1`
    );

    // Get bot settings for learning mode
    const settingsResult = await getPool().query(
      `SELECT value FROM bot_settings WHERE key = 'learning'`
    );

    const totalTrades = parseInt(tradesResult.rows[0]?.total || '0', 10);
    const latestSnapshot = snapshotResult.rows[0];
    const learningSettings = settingsResult.rows[0]?.value || {};

    res.json({
      success: true,
      data: {
        totalTrades,
        tradesAnalyzed: latestSnapshot?.trade_count || 0,
        lastOptimization: latestSnapshot?.created_at || null,
        nextOptimization: Math.max(0, 50 - (totalTrades % 50)),
        totalAdjustments: latestSnapshot?.version || 0,
        driftFromBaseline: learningSettings.driftFromBaseline || 0,
        learningMode: learningSettings.mode || 'active',
      },
    });
  })
);

/**
 * POST /api/learning/weight/:name/lock
 * Lock or unlock a category weight
 */
router.post(
  '/weight/:name/lock',
  asyncHandler(async (req: any, res: any) => {
    const { name } = req.params;
    const { locked } = req.body;

    // Get current learning settings
    const result = await getPool().query(
      `SELECT value FROM bot_settings WHERE key = 'learning'`
    );

    const settings = result.rows[0]?.value || { lockedWeights: [] };
    const lockedWeights = settings.lockedWeights || [];

    if (locked) {
      if (!lockedWeights.includes(name)) {
        lockedWeights.push(name);
      }
    } else {
      const index = lockedWeights.indexOf(name);
      if (index > -1) {
        lockedWeights.splice(index, 1);
      }
    }

    settings.lockedWeights = lockedWeights;

    await getPool().query(
      `INSERT INTO bot_settings (key, value, updated_at)
       VALUES ('learning', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
      [JSON.stringify(settings)]
    );

    res.json({
      success: true,
      message: `Weight ${name} ${locked ? 'locked' : 'unlocked'}`,
    });
  })
);

/**
 * POST /api/learning/weight/:name/reset
 * Reset a category weight to default
 */
router.post(
  '/weight/:name/reset',
  asyncHandler(async (req: any, res: any) => {
    const { name } = req.params;
    const ctx = botContextManager.getContext();

    // Reset weight using learning scheduler
    await ctx.learningScheduler.resetWeight(name);

    res.json({
      success: true,
      message: `Weight ${name} reset to default`,
    });
  })
);

/**
 * POST /api/learning/parameter/:name/lock
 * Lock or unlock a parameter
 */
router.post(
  '/parameter/:name/lock',
  asyncHandler(async (req: any, res: any) => {
    const { name } = req.params;
    const { locked } = req.body;

    // Get current learning settings
    const result = await getPool().query(
      `SELECT value FROM bot_settings WHERE key = 'learning'`
    );

    const settings = result.rows[0]?.value || { lockedParameters: [] };
    const lockedParameters = settings.lockedParameters || [];

    if (locked) {
      if (!lockedParameters.includes(name)) {
        lockedParameters.push(name);
      }
    } else {
      const index = lockedParameters.indexOf(name);
      if (index > -1) {
        lockedParameters.splice(index, 1);
      }
    }

    settings.lockedParameters = lockedParameters;

    await getPool().query(
      `INSERT INTO bot_settings (key, value, updated_at)
       VALUES ('learning', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
      [JSON.stringify(settings)]
    );

    res.json({
      success: true,
      message: `Parameter ${name} ${locked ? 'locked' : 'unlocked'}`,
    });
  })
);

/**
 * POST /api/learning/parameter/:name/reset
 * Reset a parameter to default
 */
router.post(
  '/parameter/:name/reset',
  asyncHandler(async (req: any, res: any) => {
    const { name } = req.params;
    const ctx = botContextManager.getContext();

    // Reset parameter using learning scheduler
    await ctx.learningScheduler.resetParameter(name);

    res.json({
      success: true,
      message: `Parameter ${name} reset to default`,
    });
  })
);

/**
 * POST /api/learning/mode
 * Set learning engine mode (active, shadow, paused)
 */
router.post(
  '/mode',
  asyncHandler(async (req: any, res: any) => {
    const { mode } = req.body;

    if (!['active', 'shadow', 'paused'].includes(mode)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid mode. Must be: active, shadow, or paused',
        code: 'INVALID_MODE',
      });
    }

    // Get current learning settings
    const result = await getPool().query(
      `SELECT value FROM bot_settings WHERE key = 'learning'`
    );

    const settings = result.rows[0]?.value || {};
    settings.mode = mode;

    await getPool().query(
      `INSERT INTO bot_settings (key, value, updated_at)
       VALUES ('learning', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
      [JSON.stringify(settings)]
    );

    res.json({
      success: true,
      message: `Learning mode set to ${mode}`,
    });
  })
);

/**
 * POST /api/learning/revert
 * Revert to previous learning snapshot
 */
router.post(
  '/revert',
  asyncHandler(async (req: any, res: any) => {
    // Get the previous snapshot (second latest)
    const result = await getPool().query(
      `SELECT id, version, weights, parameters
       FROM learning_snapshots
       ORDER BY version DESC
       LIMIT 2`
    );

    if (result.rows.length < 2) {
      return res.status(400).json({
        success: false,
        error: 'No previous snapshot to revert to',
        code: 'NO_SNAPSHOT',
      });
    }

    const previousSnapshot = result.rows[1];
    const ctx = botContextManager.getContext();

    // Apply the previous snapshot's weights and parameters
    await ctx.learningScheduler.applySnapshot(previousSnapshot);

    res.json({
      success: true,
      message: `Reverted to snapshot version ${previousSnapshot.version}`,
      version: previousSnapshot.version,
    });
  })
);

export default router;
