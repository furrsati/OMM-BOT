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

export default router;
