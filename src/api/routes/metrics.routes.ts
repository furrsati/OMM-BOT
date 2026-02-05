import { Router } from 'express';
import { asyncHandler } from '../middleware';
import { botContextManager } from '../services/bot-context';
import { getPool } from '../../db/postgres';

const router = Router();

/**
 * GET /api/metrics/performance
 * Get overall bot performance metrics
 */
router.get(
  '/performance',
  asyncHandler(async (req: any, res: any) => {
    const ctx = botContextManager.getContext();

    // Get position stats
    const positionStats = ctx.positionManager.getStats();

    // Get execution stats
    const execStats = ctx.executionManager.getStats();

    // Get total trades from database
    const tradesResult = await getPool().query(
      `SELECT
        COUNT(*) as total_trades,
        COUNT(CASE WHEN outcome = 'WIN' THEN 1 END) as wins,
        COUNT(CASE WHEN outcome = 'LOSS' THEN 1 END) as losses,
        AVG(CASE WHEN outcome = 'WIN' THEN profit_loss_percent END) as avg_winner,
        AVG(CASE WHEN outcome = 'LOSS' THEN profit_loss_percent END) as avg_loser,
        SUM(profit_loss) as total_pnl_usd,
        SUM(profit_loss_percent) as total_pnl_percent
      FROM trades
      WHERE outcome IS NOT NULL`
    );

    const row = tradesResult.rows[0];
    const totalTrades = parseInt(row.total_trades || '0', 10);
    const wins = parseInt(row.wins || '0', 10);
    const losses = parseInt(row.losses || '0', 10);
    const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;

    // Calculate profit factor
    const winsPnL = parseFloat(
      (await getPool().query(`SELECT SUM(profit_loss) as sum FROM trades WHERE outcome = 'WIN'`))
        .rows[0].sum || '0'
    );
    const lossesPnL = Math.abs(
      parseFloat(
        (await getPool().query(`SELECT SUM(profit_loss) as sum FROM trades WHERE outcome = 'LOSS'`))
          .rows[0].sum || '0'
      )
    );
    const profitFactor = lossesPnL > 0 ? winsPnL / lossesPnL : winsPnL > 0 ? Infinity : 0;

    res.json({
      success: true,
      data: {
        overall: {
          totalTrades,
          winRate: parseFloat(winRate.toFixed(2)),
          profitFactor: parseFloat(profitFactor.toFixed(2)),
          totalPnL: {
            usd: parseFloat((row.total_pnl_usd || 0).toFixed(2)),
            percent: parseFloat((row.total_pnl_percent || 0).toFixed(2)),
          },
        },
        averages: {
          avgWinner: parseFloat((row.avg_winner || 0).toFixed(2)),
          avgLoser: Math.abs(parseFloat((row.avg_loser || 0).toFixed(2))),
        },
        current: {
          openPositions: positionStats.openPositions,
          dailyPnL: positionStats.totalPnL,
        },
        execution: {
          totalExecutions: execStats.totalExecutions,
          successRate: execStats.successRate,
          pendingOrders: execStats.pendingBuys + execStats.pendingSells,
        },
        uptime: Math.floor((Date.now() - ctx.startTime.getTime()) / 1000),
      },
    });
  })
);

/**
 * GET /api/metrics/daily
 * Get daily P&L breakdown
 */
router.get(
  '/daily',
  asyncHandler(async (req: any, res: any) => {
    const days = Math.min(parseInt(req.query.days as string, 10) || 7, 30);

    // Get daily P&L for last N days
    const result = await getPool().query(
      `SELECT
        DATE(exit_time) as date,
        COUNT(*) as trades,
        SUM(CASE WHEN outcome = 'WIN' THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN outcome = 'LOSS' THEN 1 ELSE 0 END) as losses,
        SUM(profit_loss) as pnl_usd,
        SUM(profit_loss_percent) as pnl_percent
      FROM trades
      WHERE exit_time >= NOW() - INTERVAL '${days} days'
        AND outcome IS NOT NULL
      GROUP BY DATE(exit_time)
      ORDER BY DATE(exit_time) DESC`
    );

    const dailyStats = result.rows.map((row) => ({
      date: row.date,
      trades: parseInt(row.trades, 10),
      wins: parseInt(row.wins, 10),
      losses: parseInt(row.losses, 10),
      winRate: parseInt(row.trades, 10) > 0 ? (parseInt(row.wins, 10) / parseInt(row.trades, 10)) * 100 : 0,
      pnl: {
        usd: parseFloat((row.pnl_usd || 0).toFixed(2)),
        percent: parseFloat((row.pnl_percent || 0).toFixed(2)),
      },
    }));

    res.json({
      success: true,
      data: dailyStats,
    });
  })
);

export default router;
