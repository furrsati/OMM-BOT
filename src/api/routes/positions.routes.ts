import { Router } from 'express';
import { asyncHandler } from '../middleware';
import { getPool } from '../../db/postgres';

const router = Router();

/**
 * GET /api/positions/current
 * Get all currently open positions with real-time P&L
 */
router.get(
  '/current',
  asyncHandler(async (_req: any, res: any) => {
    // Get all open positions from database
    const result = await getPool().query(
      `SELECT
        id,
        token_address,
        token_name,
        token_symbol,
        entry_price,
        entry_amount,
        entry_time,
        entry_conviction,
        current_price,
        highest_price,
        stop_loss_price,
        trailing_stop_active,
        take_profit_30_hit,
        take_profit_60_hit,
        take_profit_100_hit,
        take_profit_200_hit,
        remaining_amount,
        pnl_percent,
        pnl_usd,
        status,
        smart_wallets_in_position,
        created_at,
        updated_at
      FROM positions
      WHERE status = 'OPEN'
      ORDER BY created_at DESC`
    );

    const positions = result.rows.map((row) => ({
      id: row.id,
      tokenAddress: row.token_address,
      tokenName: row.token_name,
      tokenSymbol: row.token_symbol,
      entry: {
        price: parseFloat(row.entry_price),
        amount: parseFloat(row.entry_amount),
        time: row.entry_time,
        conviction: row.entry_conviction,
      },
      current: {
        price: row.current_price ? parseFloat(row.current_price) : null,
        highestPrice: row.highest_price ? parseFloat(row.highest_price) : null,
      },
      stopLoss: {
        price: row.stop_loss_price ? parseFloat(row.stop_loss_price) : null,
        trailingActive: row.trailing_stop_active,
      },
      takeProfit: {
        tp30Hit: row.take_profit_30_hit,
        tp60Hit: row.take_profit_60_hit,
        tp100Hit: row.take_profit_100_hit,
        tp200Hit: row.take_profit_200_hit,
      },
      remainingAmount: parseFloat(row.remaining_amount),
      pnl: {
        percent: row.pnl_percent ? parseFloat(row.pnl_percent) : 0,
        usd: row.pnl_usd ? parseFloat(row.pnl_usd) : 0,
      },
      smartWallets: row.smart_wallets_in_position || [],
      status: row.status,
      updatedAt: row.updated_at,
    }));

    res.json({
      success: true,
      data: {
        positions,
        count: positions.length,
      },
    });
  })
);

/**
 * GET /api/positions/:tokenAddress
 * Get details for a specific position
 */
router.get(
  '/:tokenAddress',
  asyncHandler(async (req: any, res: any) => {
    const { tokenAddress } = req.params;

    const result = await getPool().query(
      `SELECT * FROM positions WHERE token_address = $1`,
      [tokenAddress]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Position not found',
        code: 'POSITION_NOT_FOUND',
      });
    }

    const row = result.rows[0];
    const position = {
      id: row.id,
      tokenAddress: row.token_address,
      tokenName: row.token_name,
      tokenSymbol: row.token_symbol,
      entry: {
        price: parseFloat(row.entry_price),
        amount: parseFloat(row.entry_amount),
        time: row.entry_time,
        conviction: row.entry_conviction,
      },
      current: {
        price: row.current_price ? parseFloat(row.current_price) : null,
        highestPrice: row.highest_price ? parseFloat(row.highest_price) : null,
      },
      stopLoss: {
        price: row.stop_loss_price ? parseFloat(row.stop_loss_price) : null,
        trailingActive: row.trailing_stop_active,
      },
      takeProfit: {
        tp30Hit: row.take_profit_30_hit,
        tp60Hit: row.take_profit_60_hit,
        tp100Hit: row.take_profit_100_hit,
        tp200Hit: row.take_profit_200_hit,
      },
      remainingAmount: parseFloat(row.remaining_amount),
      pnl: {
        percent: row.pnl_percent ? parseFloat(row.pnl_percent) : 0,
        usd: row.pnl_usd ? parseFloat(row.pnl_usd) : 0,
      },
      smartWallets: row.smart_wallets_in_position || [],
      status: row.status,
      exitReason: row.exit_reason,
      exitTime: row.exit_time,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };

    res.json({
      success: true,
      data: position,
    });
  })
);

/**
 * POST /api/positions/:id/close
 * Manually close a position
 */
router.post(
  '/:id/close',
  asyncHandler(async (req: any, res: any) => {
    const { id } = req.params;

    // Get position
    const result = await getPool().query(
      `SELECT * FROM positions WHERE id = $1 AND status = 'OPEN'`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Position not found or already closed',
        code: 'POSITION_NOT_FOUND',
      });
    }

    const position = result.rows[0];

    // Close the position
    try {
      // Log the manual close request
      console.log('Manual close requested for position:', {
        tokenAddress: position.token_address,
        amount: parseFloat(position.remaining_amount),
      });

      // Update position status
      await getPool().query(
        `UPDATE positions
         SET status = 'CLOSED',
             exit_reason = 'MANUAL_CLOSE',
             exit_time = NOW(),
             updated_at = NOW()
         WHERE id = $1`,
        [id]
      );

      res.json({
        success: true,
        message: 'Position close initiated',
        data: {
          id,
          tokenAddress: position.token_address,
          tokenSymbol: position.token_symbol,
          exitReason: 'MANUAL_CLOSE',
        },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to close position',
        code: 'CLOSE_FAILED',
      });
    }
  })
);

/**
 * GET /api/positions/history
 * Get closed positions with pagination
 */
router.get(
  '/history',
  asyncHandler(async (req: any, res: any) => {
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 100); // Max 100
    const offset = (page - 1) * limit;

    // Get total count
    const countResult = await getPool().query(
      `SELECT COUNT(*) as count FROM positions WHERE status != 'OPEN'`
    );
    const totalCount = parseInt(countResult.rows[0].count, 10);

    // Get closed positions
    const result = await getPool().query(
      `SELECT
        id,
        token_address,
        token_name,
        token_symbol,
        entry_price,
        entry_amount,
        entry_time,
        entry_conviction,
        pnl_percent,
        pnl_usd,
        status,
        exit_reason,
        exit_time,
        created_at,
        updated_at
      FROM positions
      WHERE status != 'OPEN'
      ORDER BY exit_time DESC
      LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const positions = result.rows.map((row) => ({
      id: row.id,
      tokenAddress: row.token_address,
      tokenName: row.token_name,
      tokenSymbol: row.token_symbol,
      entry: {
        price: parseFloat(row.entry_price),
        amount: parseFloat(row.entry_amount),
        time: row.entry_time,
        conviction: row.entry_conviction,
      },
      pnl: {
        percent: row.pnl_percent ? parseFloat(row.pnl_percent) : 0,
        usd: row.pnl_usd ? parseFloat(row.pnl_usd) : 0,
      },
      status: row.status,
      exitReason: row.exit_reason,
      exitTime: row.exit_time,
    }));

    res.json({
      success: true,
      data: positions,
      pagination: {
        page,
        limit,
        total: totalCount,
        totalPages: Math.ceil(totalCount / limit),
        hasMore: offset + positions.length < totalCount,
      },
    });
  })
);

export default router;
