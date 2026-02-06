import { Router } from 'express';
import {
  asyncHandler,
  requireAuth,
  validateBody,
  validateQuery,
  schemas,
  criticalLimiter,
  auditLog,
} from '../middleware';
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
 *
 * SECURITY: This is a critical endpoint that requires:
 * - Authentication (API key)
 * - Strict rate limiting (5 per hour)
 * - Input validation
 * - Audit logging
 */
router.post(
  '/sweep',
  criticalLimiter, // Very strict rate limiting
  requireAuth, // Require API key authentication
  validateBody(schemas.walletSweep), // Validate input
  auditLog('WALLET_SWEEP'), // Log this operation
  asyncHandler(async (req: any, res: any) => {
    const { amount, destinationAddress } = req.body;

    // Additional validation: verify destination is a valid Solana address
    try {
      new PublicKey(destinationAddress);
    } catch {
      return res.status(400).json({
        success: false,
        error: 'Invalid destination address',
        code: 'INVALID_ADDRESS',
      });
    }

    // Get current wallet balance to validate amount
    const ctx = botContextManager.getContext();
    const walletAddress = process.env.BOT_WALLET_ADDRESS;

    if (!walletAddress) {
      return res.status(503).json({
        success: false,
        error: 'Wallet not configured',
        code: 'WALLET_NOT_CONFIGURED',
      });
    }

    let currentBalance = 0;
    try {
      const pubkey = new PublicKey(walletAddress);
      const balance = await ctx.connection.getBalance(pubkey);
      currentBalance = balance / LAMPORTS_PER_SOL;
    } catch (error: any) {
      return res.status(503).json({
        success: false,
        error: 'Could not verify wallet balance',
        code: 'BALANCE_CHECK_FAILED',
      });
    }

    // Validate amount against balance (leave minimum for fees)
    const minReserve = 0.01; // Keep 0.01 SOL for transaction fees
    if (amount > currentBalance - minReserve) {
      return res.status(400).json({
        success: false,
        error: `Insufficient balance. Available: ${(currentBalance - minReserve).toFixed(4)} SOL`,
        code: 'INSUFFICIENT_BALANCE',
      });
    }

    // Execute the sweep transaction
    try {
      const {
        Transaction,
        SystemProgram,
        Keypair,
        sendAndConfirmTransaction,
      } = await import('@solana/web3.js');

      // Load bot wallet keypair from environment
      const privateKey = process.env.BOT_WALLET_PRIVATE_KEY;
      if (!privateKey) {
        return res.status(503).json({
          success: false,
          error: 'Bot wallet private key not configured',
          code: 'WALLET_NOT_CONFIGURED',
        });
      }

      // Parse the private key (supports base58 or JSON array format)
      let secretKey: Uint8Array;
      try {
        if (privateKey.startsWith('[')) {
          secretKey = new Uint8Array(JSON.parse(privateKey));
        } else {
          // Base58 format - need to decode
          const bs58 = await import('bs58');
          secretKey = bs58.decode(privateKey);
        }
      } catch (parseError: any) {
        return res.status(503).json({
          success: false,
          error: 'Invalid wallet private key format',
          code: 'INVALID_PRIVATE_KEY',
        });
      }

      const fromWallet = Keypair.fromSecretKey(secretKey);
      const toPubkey = new PublicKey(destinationAddress);

      // Convert SOL amount to lamports
      const lamports = Math.floor(amount * LAMPORTS_PER_SOL);

      // Create transfer transaction
      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: fromWallet.publicKey,
          toPubkey: toPubkey,
          lamports: lamports,
        })
      );

      // Get recent blockhash
      const { blockhash } = await ctx.connection.getLatestBlockhash('confirmed');
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = fromWallet.publicKey;

      // Sign and send transaction
      const signature = await sendAndConfirmTransaction(
        ctx.connection,
        transaction,
        [fromWallet],
        { commitment: 'confirmed' }
      );

      // Log the sweep in audit table
      await getPool().query(
        `INSERT INTO audit_log (action, actor, details, ip_address)
         VALUES ($1, $2, $3, $4)`,
        [
          'WALLET_SWEEP_SUCCESS',
          'system',
          JSON.stringify({
            amount,
            destination: destinationAddress,
            signature,
            fromBalance: currentBalance,
          }),
          req.ip || 'unknown',
        ]
      );

      res.json({
        success: true,
        message: 'Sweep completed successfully',
        data: {
          amount,
          destination: destinationAddress,
          signature,
          status: 'confirmed',
          explorerUrl: `https://solscan.io/tx/${signature}`,
        },
      });

    } catch (txError: any) {
      // Log failed sweep attempt
      await getPool().query(
        `INSERT INTO audit_log (action, actor, details, ip_address)
         VALUES ($1, $2, $3, $4)`,
        [
          'WALLET_SWEEP_FAILED',
          'system',
          JSON.stringify({
            amount,
            destination: destinationAddress,
            error: txError.message,
          }),
          req.ip || 'unknown',
        ]
      );

      return res.status(500).json({
        success: false,
        error: `Sweep transaction failed: ${txError.message}`,
        code: 'TRANSACTION_FAILED',
      });
    }
  })
);

/**
 * GET /api/wallet/transactions
 * Get transaction history
 */
router.get(
  '/transactions',
  validateQuery(schemas.pagination),
  asyncHandler(async (req: any, res: any) => {
    const { limit, offset } = req.query;

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
