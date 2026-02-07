/**
 * Paper Trading API Routes
 *
 * Endpoints for paper trading functionality:
 * - Wallet balance and stats
 * - Open positions
 * - Trade history
 * - Event console
 * - Controls (reset, pause, resume)
 */

import { Router } from 'express';
import { asyncHandler } from '../middleware';
import { getPool } from '../../db/postgres';
import { botContextManager } from '../services/bot-context';

const router = Router();

/**
 * GET /api/paper-trading/wallet
 * Get paper wallet balance and stats
 */
router.get(
  '/wallet',
  asyncHandler(async (_req: any, res: any) => {
    const result = await getPool().query(`
      SELECT
        id,
        initial_balance_sol,
        current_balance_sol,
        reserved_balance_sol,
        available_balance_sol,
        initial_balance_usd,
        current_balance_usd,
        total_trades,
        winning_trades,
        losing_trades,
        breakeven_trades,
        total_pnl_sol,
        total_pnl_usd,
        total_pnl_percent,
        best_trade_pnl_percent,
        worst_trade_pnl_percent,
        best_trade_token,
        worst_trade_token,
        current_streak,
        longest_win_streak,
        longest_loss_streak,
        daily_pnl_sol,
        daily_pnl_percent,
        daily_trades,
        daily_reset_at,
        max_position_size_percent,
        max_open_positions,
        max_daily_loss_percent,
        max_daily_profit_percent,
        is_active,
        is_paused,
        pause_reason,
        created_at,
        updated_at,
        last_trade_at
      FROM paper_wallet
      WHERE id = 1
    `);

    if (result.rows.length === 0) {
      return res.json({
        success: true,
        data: null,
        message: 'Paper wallet not initialized'
      });
    }

    const row = result.rows[0];
    const totalTrades = (row.winning_trades || 0) + (row.losing_trades || 0) + (row.breakeven_trades || 0);
    const winRate = totalTrades > 0 ? ((row.winning_trades || 0) / totalTrades) * 100 : 0;

    res.json({
      success: true,
      data: {
        balance: {
          initial: parseFloat(row.initial_balance_sol) || 10,
          current: parseFloat(row.current_balance_sol) || 10,
          reserved: parseFloat(row.reserved_balance_sol) || 0,
          available: parseFloat(row.available_balance_sol) || 10,
          usd: parseFloat(row.current_balance_usd) || null
        },
        performance: {
          totalTrades: row.total_trades || 0,
          winningTrades: row.winning_trades || 0,
          losingTrades: row.losing_trades || 0,
          breakevenTrades: row.breakeven_trades || 0,
          winRate: winRate.toFixed(1),
          totalPnlSol: parseFloat(row.total_pnl_sol) || 0,
          totalPnlPercent: parseFloat(row.total_pnl_percent) || 0,
          bestTrade: {
            pnlPercent: parseFloat(row.best_trade_pnl_percent) || 0,
            token: row.best_trade_token
          },
          worstTrade: {
            pnlPercent: parseFloat(row.worst_trade_pnl_percent) || 0,
            token: row.worst_trade_token
          }
        },
        streaks: {
          current: row.current_streak || 0,
          longestWin: row.longest_win_streak || 0,
          longestLoss: row.longest_loss_streak || 0
        },
        daily: {
          pnlSol: parseFloat(row.daily_pnl_sol) || 0,
          pnlPercent: parseFloat(row.daily_pnl_percent) || 0,
          trades: row.daily_trades || 0,
          resetAt: row.daily_reset_at
        },
        settings: {
          maxPositionSize: parseFloat(row.max_position_size_percent) || 5,
          maxOpenPositions: row.max_open_positions || 5,
          maxDailyLoss: parseFloat(row.max_daily_loss_percent) || 8,
          maxDailyProfit: parseFloat(row.max_daily_profit_percent) || 15
        },
        status: {
          isActive: row.is_active,
          isPaused: row.is_paused,
          pauseReason: row.pause_reason,
          lastTradeAt: row.last_trade_at
        },
        timestamps: {
          createdAt: row.created_at,
          updatedAt: row.updated_at
        }
      }
    });
  })
);

/**
 * GET /api/paper-trading/positions
 * Get all open paper positions
 */
router.get(
  '/positions',
  asyncHandler(async (_req: any, res: any) => {
    const result = await getPool().query(`
      SELECT
        pp.id,
        pp.paper_trade_id,
        pp.token_address,
        pp.token_name,
        pp.token_symbol,
        pp.entry_price,
        pp.entry_amount_sol,
        pp.entry_amount_tokens,
        pp.remaining_amount_tokens,
        pp.entry_time,
        pp.current_price,
        pp.highest_price,
        pp.lowest_price,
        pp.unrealized_pnl_sol,
        pp.unrealized_pnl_percent,
        pp.unrealized_pnl_usd,
        pp.stop_loss_price,
        pp.stop_loss_percent,
        pp.trailing_stop_active,
        pp.trailing_stop_price,
        pp.trailing_stop_percent,
        pp.take_profit_1_hit,
        pp.take_profit_2_hit,
        pp.take_profit_3_hit,
        pp.take_profit_4_hit,
        pp.tp1_amount_sold,
        pp.tp2_amount_sold,
        pp.tp3_amount_sold,
        pp.tp4_amount_sold,
        pp.realized_pnl_sol,
        pp.realized_pnl_usd,
        pp.status,
        pp.smart_wallets_holding,
        pp.smart_wallets_exited,
        pp.danger_signals,
        pp.created_at,
        pp.updated_at,
        pp.last_price_update,
        pt.conviction_level,
        pt.entry_type,
        pt.entry_conviction_score
      FROM paper_positions pp
      LEFT JOIN paper_trades pt ON pp.paper_trade_id = pt.id
      WHERE pp.status = 'ACTIVE'
      ORDER BY pp.entry_time DESC
    `);

    const positions = result.rows.map(row => ({
      id: row.id,
      tradeId: row.paper_trade_id,
      token: {
        address: row.token_address,
        name: row.token_name || 'Unknown',
        symbol: row.token_symbol || '???'
      },
      entry: {
        price: parseFloat(row.entry_price) || 0,
        amountSol: parseFloat(row.entry_amount_sol) || 0,
        amountTokens: parseFloat(row.entry_amount_tokens) || 0,
        time: row.entry_time,
        conviction: parseFloat(row.entry_conviction_score) || 0,
        level: row.conviction_level,
        type: row.entry_type
      },
      current: {
        price: parseFloat(row.current_price) || 0,
        highestPrice: parseFloat(row.highest_price) || 0,
        lowestPrice: parseFloat(row.lowest_price) || 0,
        remainingTokens: parseFloat(row.remaining_amount_tokens) || 0
      },
      pnl: {
        unrealizedSol: parseFloat(row.unrealized_pnl_sol) || 0,
        unrealizedPercent: parseFloat(row.unrealized_pnl_percent) || 0,
        unrealizedUsd: parseFloat(row.unrealized_pnl_usd) || 0,
        realizedSol: parseFloat(row.realized_pnl_sol) || 0,
        realizedUsd: parseFloat(row.realized_pnl_usd) || 0
      },
      stopLoss: {
        price: parseFloat(row.stop_loss_price) || 0,
        percent: parseFloat(row.stop_loss_percent) || 25,
        trailingActive: row.trailing_stop_active || false,
        trailingPrice: row.trailing_stop_price ? parseFloat(row.trailing_stop_price) : null,
        trailingPercent: row.trailing_stop_percent ? parseFloat(row.trailing_stop_percent) : null
      },
      takeProfit: {
        tp1Hit: row.take_profit_1_hit || false,
        tp2Hit: row.take_profit_2_hit || false,
        tp3Hit: row.take_profit_3_hit || false,
        tp4Hit: row.take_profit_4_hit || false,
        tp1Sold: parseFloat(row.tp1_amount_sold) || 0,
        tp2Sold: parseFloat(row.tp2_amount_sold) || 0,
        tp3Sold: parseFloat(row.tp3_amount_sold) || 0,
        tp4Sold: parseFloat(row.tp4_amount_sold) || 0
      },
      smartWallets: {
        holding: row.smart_wallets_holding || [],
        exited: row.smart_wallets_exited || []
      },
      dangerSignals: row.danger_signals || [],
      timestamps: {
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        lastPriceUpdate: row.last_price_update
      }
    }));

    res.json({
      success: true,
      data: {
        positions,
        count: positions.length
      }
    });
  })
);

/**
 * POST /api/paper-trading/positions/:tokenAddress/close
 * Manually close a paper position
 */
router.post(
  '/positions/:tokenAddress/close',
  asyncHandler(async (req: any, res: any) => {
    const { tokenAddress } = req.params;

    const context = botContextManager.getContext();
    if (!context || !context.paperTradingEngine) {
      return res.status(503).json({
        success: false,
        error: 'Paper trading engine not available',
        code: 'ENGINE_UNAVAILABLE'
      });
    }

    const result = await context.paperTradingEngine.manualClose(tokenAddress);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.message,
        code: 'CLOSE_FAILED'
      });
    }

    res.json({
      success: true,
      message: result.message
    });
  })
);

/**
 * GET /api/paper-trading/trades
 * Get paper trade history
 */
router.get(
  '/trades',
  asyncHandler(async (req: any, res: any) => {
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 100);
    const offset = (page - 1) * limit;
    const status = req.query.status as string; // OPEN, CLOSED, or all

    let whereClause = '';
    const params: any[] = [limit, offset];

    if (status && status !== 'all') {
      whereClause = 'WHERE status = $3';
      params.push(status.toUpperCase());
    }

    // Get total count
    const countQuery = status && status !== 'all'
      ? `SELECT COUNT(*) as count FROM paper_trades WHERE status = $1`
      : `SELECT COUNT(*) as count FROM paper_trades`;
    const countParams = status && status !== 'all' ? [status.toUpperCase()] : [];
    const countResult = await getPool().query(countQuery, countParams);
    const totalCount = parseInt(countResult.rows[0].count, 10);

    const result = await getPool().query(`
      SELECT
        id,
        token_address,
        token_name,
        token_symbol,
        entry_price,
        entry_amount_sol,
        entry_amount_tokens,
        entry_time,
        entry_conviction_score,
        exit_price,
        exit_amount_sol,
        exit_time,
        exit_reason,
        pnl_sol,
        pnl_percent,
        pnl_usd,
        position_size_percent,
        conviction_level,
        entry_type,
        status,
        outcome,
        tier1_count,
        tier2_count,
        tier3_count,
        created_at,
        updated_at
      FROM paper_trades
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $1 OFFSET $2
    `, params);

    const trades = result.rows.map(row => ({
      id: row.id,
      token: {
        address: row.token_address,
        name: row.token_name || 'Unknown',
        symbol: row.token_symbol || '???'
      },
      entry: {
        price: parseFloat(row.entry_price) || 0,
        amountSol: parseFloat(row.entry_amount_sol) || 0,
        amountTokens: parseFloat(row.entry_amount_tokens) || 0,
        time: row.entry_time,
        conviction: parseFloat(row.entry_conviction_score) || 0,
        level: row.conviction_level,
        type: row.entry_type,
        positionSizePercent: parseFloat(row.position_size_percent) || 0
      },
      exit: row.exit_time ? {
        price: parseFloat(row.exit_price) || 0,
        amountSol: parseFloat(row.exit_amount_sol) || 0,
        time: row.exit_time,
        reason: row.exit_reason
      } : null,
      pnl: {
        sol: parseFloat(row.pnl_sol) || 0,
        percent: parseFloat(row.pnl_percent) || 0,
        usd: parseFloat(row.pnl_usd) || 0
      },
      smartWallets: {
        tier1: row.tier1_count || 0,
        tier2: row.tier2_count || 0,
        tier3: row.tier3_count || 0
      },
      status: row.status,
      outcome: row.outcome,
      timestamps: {
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }
    }));

    res.json({
      success: true,
      data: trades,
      pagination: {
        page,
        limit,
        total: totalCount,
        totalPages: Math.ceil(totalCount / limit),
        hasMore: offset + trades.length < totalCount
      }
    });
  })
);

/**
 * GET /api/paper-trading/events
 * Get paper trade events (for console display)
 */
router.get(
  '/events',
  asyncHandler(async (req: any, res: any) => {
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 100, 500);
    const severity = req.query.severity as string; // INFO, WARNING, SUCCESS, DANGER

    let whereClause = '';
    const params: any[] = [limit];

    if (severity && severity !== 'all') {
      whereClause = 'WHERE severity = $2';
      params.push(severity.toUpperCase());
    }

    const result = await getPool().query(`
      SELECT
        id,
        paper_trade_id,
        paper_position_id,
        event_type,
        event_data,
        price_at_event,
        pnl_at_event,
        message,
        severity,
        created_at
      FROM paper_trade_events
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $1
    `, params);

    const events = result.rows.map(row => ({
      id: row.id,
      tradeId: row.paper_trade_id,
      positionId: row.paper_position_id,
      type: row.event_type,
      data: row.event_data,
      price: parseFloat(row.price_at_event) || 0,
      pnl: parseFloat(row.pnl_at_event) || 0,
      message: row.message,
      severity: row.severity,
      timestamp: row.created_at
    }));

    res.json({
      success: true,
      data: events
    });
  })
);

/**
 * GET /api/paper-trading/daily-stats
 * Get daily performance stats for charts
 */
router.get(
  '/daily-stats',
  asyncHandler(async (req: any, res: any) => {
    const days = Math.min(parseInt(req.query.days as string, 10) || 30, 90);

    const result = await getPool().query(`
      SELECT
        date,
        balance_sol,
        balance_usd,
        trades_count,
        wins,
        losses,
        pnl_sol,
        pnl_usd,
        pnl_percent,
        volume_sol,
        best_trade_percent,
        worst_trade_percent,
        sol_price_usd,
        market_regime,
        created_at
      FROM paper_daily_stats
      ORDER BY date DESC
      LIMIT $1
    `, [days]);

    const stats = result.rows.map(row => ({
      date: row.date,
      balance: {
        sol: parseFloat(row.balance_sol) || 0,
        usd: parseFloat(row.balance_usd) || 0
      },
      trades: {
        count: row.trades_count || 0,
        wins: row.wins || 0,
        losses: row.losses || 0
      },
      pnl: {
        sol: parseFloat(row.pnl_sol) || 0,
        usd: parseFloat(row.pnl_usd) || 0,
        percent: parseFloat(row.pnl_percent) || 0
      },
      volume: parseFloat(row.volume_sol) || 0,
      bestTrade: parseFloat(row.best_trade_percent) || 0,
      worstTrade: parseFloat(row.worst_trade_percent) || 0,
      solPrice: parseFloat(row.sol_price_usd) || 0,
      marketRegime: row.market_regime
    }));

    res.json({
      success: true,
      data: stats
    });
  })
);

/**
 * POST /api/paper-trading/reset
 * Reset paper wallet to initial state
 */
router.post(
  '/reset',
  asyncHandler(async (req: any, res: any) => {
    const { initialBalance } = req.body;
    const balance = parseFloat(initialBalance) || 10;

    const context = botContextManager.getContext();
    if (!context || !context.paperTradingEngine) {
      return res.status(503).json({
        success: false,
        error: 'Paper trading engine not available',
        code: 'ENGINE_UNAVAILABLE'
      });
    }

    await context.paperTradingEngine.resetWallet(balance);

    res.json({
      success: true,
      message: `Paper wallet reset to ${balance} SOL`
    });
  })
);

/**
 * POST /api/paper-trading/pause
 * Pause paper trading
 */
router.post(
  '/pause',
  asyncHandler(async (req: any, res: any) => {
    const { reason } = req.body;

    const context = botContextManager.getContext();
    if (!context || !context.paperTradingEngine) {
      return res.status(503).json({
        success: false,
        error: 'Paper trading engine not available',
        code: 'ENGINE_UNAVAILABLE'
      });
    }

    await context.paperTradingEngine.pauseTrading(reason || 'Manual pause');

    res.json({
      success: true,
      message: 'Paper trading paused'
    });
  })
);

/**
 * POST /api/paper-trading/resume
 * Resume paper trading
 */
router.post(
  '/resume',
  asyncHandler(async (_req: any, res: any) => {
    const context = botContextManager.getContext();
    if (!context || !context.paperTradingEngine) {
      return res.status(503).json({
        success: false,
        error: 'Paper trading engine not available',
        code: 'ENGINE_UNAVAILABLE'
      });
    }

    await context.paperTradingEngine.resumeTrading();

    res.json({
      success: true,
      message: 'Paper trading resumed'
    });
  })
);

/**
 * GET /api/paper-trading/summary
 * Get overall paper trading summary
 */
router.get(
  '/summary',
  asyncHandler(async (_req: any, res: any) => {
    // Get wallet stats
    const walletResult = await getPool().query(`
      SELECT * FROM paper_wallet WHERE id = 1
    `);

    // Get open positions count and value
    const positionsResult = await getPool().query(`
      SELECT
        COUNT(*) as count,
        COALESCE(SUM(unrealized_pnl_sol), 0) as total_unrealized_pnl,
        COALESCE(SUM(entry_amount_sol), 0) as total_invested
      FROM paper_positions
      WHERE status = 'ACTIVE'
    `);

    // Get recent trade stats
    const recentTradesResult = await getPool().query(`
      SELECT
        COUNT(*) as count,
        COUNT(CASE WHEN outcome = 'WIN' THEN 1 END) as wins,
        COUNT(CASE WHEN outcome = 'LOSS' THEN 1 END) as losses,
        COALESCE(AVG(pnl_percent), 0) as avg_pnl
      FROM paper_trades
      WHERE status = 'CLOSED'
      AND created_at > NOW() - INTERVAL '7 days'
    `);

    const wallet = walletResult.rows[0] || {};
    const positions = positionsResult.rows[0] || {};
    const recentTrades = recentTradesResult.rows[0] || {};

    const totalTrades = (wallet.winning_trades || 0) + (wallet.losing_trades || 0) + (wallet.breakeven_trades || 0);
    const winRate = totalTrades > 0 ? ((wallet.winning_trades || 0) / totalTrades) * 100 : 0;

    res.json({
      success: true,
      data: {
        wallet: {
          balance: parseFloat(wallet.current_balance_sol) || 10,
          available: parseFloat(wallet.available_balance_sol) || 10,
          reserved: parseFloat(wallet.reserved_balance_sol) || 0,
          totalPnl: parseFloat(wallet.total_pnl_sol) || 0,
          totalPnlPercent: parseFloat(wallet.total_pnl_percent) || 0,
          isPaused: wallet.is_paused || false
        },
        positions: {
          count: parseInt(positions.count) || 0,
          unrealizedPnl: parseFloat(positions.total_unrealized_pnl) || 0,
          totalInvested: parseFloat(positions.total_invested) || 0
        },
        performance: {
          totalTrades,
          winRate: winRate.toFixed(1),
          currentStreak: wallet.current_streak || 0
        },
        last7Days: {
          trades: parseInt(recentTrades.count) || 0,
          wins: parseInt(recentTrades.wins) || 0,
          losses: parseInt(recentTrades.losses) || 0,
          avgPnl: parseFloat(recentTrades.avg_pnl) || 0
        }
      }
    });
  })
);

export default router;
