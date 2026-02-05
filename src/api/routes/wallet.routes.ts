import { Router } from 'express';
import { asyncHandler } from '../middleware';
import { botContextManager } from '../services/bot-context';
import { getPool } from '../../db/postgres';
import { LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';

const router = Router();

/**
 * GET /api/wallet
 * Get bot wallet balance and holdings
 */
router.get(
  '/',
  asyncHandler(async (_req: any, res: any) => {
    const ctx = botContextManager.getContext();
    const walletAddress = process.env.BOT_WALLET_ADDRESS;

    if (!walletAddress) {
      return res.json({
        success: true,
        data: {
          address: 'Not configured',
          balance: { sol: 0, solUsd: 0, tokens: [], totalValueUsd: 0 },
          recentTransactions: [],
          dailyPnL: 0,
          weeklyPnL: 0,
          allTimePnL: 0,
        },
      });
    }

    let solBalance = 0;
    let solUsd = 0;

    try {
      // Get SOL balance
      const pubkey = new PublicKey(walletAddress);
      const balance = await ctx.connection.getBalance(pubkey);
      solBalance = balance / LAMPORTS_PER_SOL;

      // Get SOL price (use price feed if available)
      let solPrice = 150; // fallback
      try {
        if (ctx.priceFeed?.getSOLPrice) {
          solPrice = await ctx.priceFeed.getSOLPrice();
        }
      } catch {
        // Use fallback price
      }
      solUsd = solBalance * solPrice;
    } catch (error: any) {
      console.error('Error fetching wallet balance:', error.message);
    }

    // Get P&L from trades
    const pnlResult = await getPool().query(`
      SELECT
        COALESCE(SUM(CASE WHEN entry_time >= NOW() - INTERVAL '1 day' THEN profit_loss ELSE 0 END), 0) as daily_pnl,
        COALESCE(SUM(CASE WHEN entry_time >= NOW() - INTERVAL '7 days' THEN profit_loss ELSE 0 END), 0) as weekly_pnl,
        COALESCE(SUM(profit_loss), 0) as total_pnl
      FROM trades
      WHERE profit_loss IS NOT NULL
    `);

    const pnl = pnlResult.rows[0];

    // Get recent transactions from execution history
    const txResult = await getPool().query(`
      SELECT
        id, type, token_symbol, amount, value_usd, signature, status, created_at
      FROM execution_history
      ORDER BY created_at DESC
      LIMIT 10
    `);

    const transactions = txResult.rows.map((row) => ({
      signature: row.signature || row.id,
      type: row.type,
      amount: parseFloat(row.amount) || 0,
      token: row.token_symbol || 'SOL',
      timestamp: row.created_at,
      status: row.status,
    }));

    res.json({
      success: true,
      data: {
        address: walletAddress,
        balance: {
          sol: solBalance,
          solUsd: solUsd,
          tokens: [], // TODO: Implement token balance fetching
          totalValueUsd: solUsd,
        },
        recentTransactions: transactions,
        dailyPnL: parseFloat(pnl.daily_pnl) || 0,
        weeklyPnL: parseFloat(pnl.weekly_pnl) || 0,
        allTimePnL: parseFloat(pnl.total_pnl) || 0,
      },
    });
  })
);

/**
 * POST /api/wallet/sweep
 * Sweep profits to cold storage wallet
 */
router.post(
  '/sweep',
  asyncHandler(async (req: any, res: any) => {
    const { amount, destinationAddress } = req.body;

    if (!destinationAddress) {
      return res.status(400).json({
        success: false,
        error: 'Destination address required',
        code: 'DESTINATION_REQUIRED',
      });
    }

    // Validate destination address
    try {
      new PublicKey(destinationAddress);
    } catch {
      return res.status(400).json({
        success: false,
        error: 'Invalid destination address',
        code: 'INVALID_ADDRESS',
      });
    }

    // TODO: Implement actual sweep functionality
    // For now, return a placeholder response
    res.json({
      success: true,
      message: 'Sweep initiated',
      data: {
        amount: amount || 0,
        destination: destinationAddress,
        status: 'pending',
        note: 'Sweep functionality not yet implemented',
      },
    });
  })
);

/**
 * GET /api/wallet/transactions
 * Get transaction history
 */
router.get(
  '/transactions',
  asyncHandler(async (req: any, res: any) => {
    const { limit = 50, offset = 0 } = req.query;

    const result = await getPool().query(
      `SELECT
        id, type, token_address, token_symbol, amount, price, value_usd,
        signature, status, latency_ms, slippage_percent, priority_fee,
        retries, error_message, rpc_node, created_at
      FROM execution_history
      ORDER BY created_at DESC
      LIMIT $1 OFFSET $2`,
      [parseInt(limit as string, 10), parseInt(offset as string, 10)]
    );

    const transactions = result.rows.map((row) => ({
      id: row.id,
      type: row.type,
      tokenAddress: row.token_address,
      tokenSymbol: row.token_symbol,
      amount: parseFloat(row.amount) || 0,
      price: parseFloat(row.price) || 0,
      valueUsd: parseFloat(row.value_usd) || 0,
      signature: row.signature,
      status: row.status,
      latencyMs: row.latency_ms,
      slippagePercent: parseFloat(row.slippage_percent) || 0,
      priorityFee: parseFloat(row.priority_fee) || 0,
      retries: row.retries,
      error: row.error_message,
      rpcNode: row.rpc_node,
      timestamp: row.created_at,
    }));

    res.json({
      success: true,
      data: transactions,
    });
  })
);

export default router;
