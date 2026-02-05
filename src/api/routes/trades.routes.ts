import { Router } from 'express';
import { asyncHandler } from '../middleware';
import { getPool } from '../../db/postgres';

const router = Router();

/**
 * GET /api/trades/recent
 * Get recent trades (default: last 50)
 */
router.get(
  '/recent',
  asyncHandler(async (req: any, res: any) => {
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 100);

    const result = await getPool().query(
      `SELECT
        id,
        token_address,
        entry_price,
        entry_amount,
        entry_time,
        exit_price,
        exit_amount,
        exit_time,
        exit_reason,
        profit_loss,
        profit_loss_percent,
        conviction_score,
        outcome,
        created_at
      FROM trades
      ORDER BY entry_time DESC
      LIMIT $1`,
      [limit]
    );

    const trades = result.rows.map((row) => ({
      id: row.id,
      tokenAddress: row.token_address,
      entry: {
        price: parseFloat(row.entry_price),
        amount: parseFloat(row.entry_amount),
        time: row.entry_time,
      },
      exit: row.exit_time
        ? {
            price: parseFloat(row.exit_price),
            amount: parseFloat(row.exit_amount),
            time: row.exit_time,
            reason: row.exit_reason,
          }
        : null,
      profitLoss: row.profit_loss ? parseFloat(row.profit_loss) : null,
      profitLossPercent: row.profit_loss_percent ? parseFloat(row.profit_loss_percent) : null,
      convictionScore: row.conviction_score ? parseFloat(row.conviction_score) : null,
      outcome: row.outcome,
      createdAt: row.created_at,
    }));

    res.json({
      success: true,
      data: trades,
    });
  })
);

/**
 * GET /api/trades/stats
 * Get trade statistics (win rate, avg winner/loser, etc.)
 */
router.get(
  '/stats',
  asyncHandler(async (req: any, res: any) => {
    // Total trades
    const totalResult = await getPool().query(
      `SELECT COUNT(*) as count FROM trades WHERE outcome IS NOT NULL`
    );
    const totalTrades = parseInt(totalResult.rows[0].count, 10);

    // Winning trades
    const winsResult = await getPool().query(
      `SELECT COUNT(*) as count, AVG(profit_loss_percent) as avg
       FROM trades WHERE outcome = 'WIN'`
    );
    const winCount = parseInt(winsResult.rows[0].count || '0', 10);
    const avgWinner = parseFloat(winsResult.rows[0].avg || '0');

    // Losing trades
    const lossesResult = await getPool().query(
      `SELECT COUNT(*) as count, AVG(profit_loss_percent) as avg
       FROM trades WHERE outcome = 'LOSS'`
    );
    const lossCount = parseInt(lossesResult.rows[0].count || '0', 10);
    const avgLoser = Math.abs(parseFloat(lossesResult.rows[0].avg || '0'));

    // Total P&L
    const pnlResult = await getPool().query(
      `SELECT SUM(profit_loss) as total_usd, SUM(profit_loss_percent) as total_percent
       FROM trades WHERE outcome IS NOT NULL`
    );
    const totalPnLUsd = parseFloat(pnlResult.rows[0].total_usd || '0');
    const totalPnLPercent = parseFloat(pnlResult.rows[0].total_percent || '0');

    // Calculate win rate
    const winRate = totalTrades > 0 ? (winCount / totalTrades) * 100 : 0;

    // Calculate profit factor
    const totalWins = parseFloat(
      (await getPool().query(`SELECT SUM(profit_loss) as sum FROM trades WHERE outcome = 'WIN'`))
        .rows[0].sum || '0'
    );
    const totalLosses = Math.abs(
      parseFloat(
        (await getPool().query(`SELECT SUM(profit_loss) as sum FROM trades WHERE outcome = 'LOSS'`))
          .rows[0].sum || '0'
      )
    );
    const profitFactor = totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0;

    res.json({
      success: true,
      data: {
        totalTrades,
        winCount,
        lossCount,
        winRate: parseFloat(winRate.toFixed(2)),
        avgWinner: parseFloat(avgWinner.toFixed(2)),
        avgLoser: parseFloat(avgLoser.toFixed(2)),
        totalPnL: {
          usd: parseFloat(totalPnLUsd.toFixed(2)),
          percent: parseFloat(totalPnLPercent.toFixed(2)),
        },
        profitFactor: parseFloat(profitFactor.toFixed(2)),
      },
    });
  })
);

/**
 * GET /api/trades/:id
 * Get details for a specific trade
 */
router.get(
  '/:id',
  asyncHandler(async (req: any, res: any) => {
    const { id } = req.params;

    const result = await getPool().query(
      `SELECT * FROM trades WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Trade not found',
        code: 'TRADE_NOT_FOUND',
      });
    }

    const row = result.rows[0];
    const trade = {
      id: row.id,
      tokenAddress: row.token_address,
      entry: {
        price: parseFloat(row.entry_price),
        amount: parseFloat(row.entry_amount),
        time: row.entry_time,
      },
      exit: row.exit_time
        ? {
            price: parseFloat(row.exit_price),
            amount: parseFloat(row.exit_amount),
            time: row.exit_time,
            reason: row.exit_reason,
          }
        : null,
      profitLoss: row.profit_loss ? parseFloat(row.profit_loss) : null,
      profitLossPercent: row.profit_loss_percent ? parseFloat(row.profit_loss_percent) : null,
      convictionScore: row.conviction_score ? parseFloat(row.conviction_score) : null,
      fingerprint: row.fingerprint,
      outcome: row.outcome,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };

    res.json({
      success: true,
      data: trade,
    });
  })
);

export default router;
