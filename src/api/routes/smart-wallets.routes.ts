import { Router } from 'express';
import { randomUUID } from 'crypto';
import {
  asyncHandler,
  requireAuth,
  validateBody,
  validateParams,
  schemas,
  auditLog,
} from '../middleware';
import { getPool } from '../../db/postgres';

const router = Router();

// Require authentication for modification routes only
// GET routes are read-only and less sensitive

/**
 * GET /api/smart-wallets
 * Get all tracked smart wallets with performance metrics
 */
router.get(
  '/',
  asyncHandler(async (req: any, res: any) => {
    const result = await getPool().query(
      `SELECT
        id,
        address,
        tier,
        score,
        win_rate,
        average_return,
        tokens_entered,
        COALESCE(tokens_won, 0) as tokens_won,
        COALESCE(avg_peak_multiplier, 0) as avg_peak_multiplier,
        COALESCE(best_pick_multiplier, 0) as best_pick_multiplier,
        COALESCE(recent_tokens, '[]'::jsonb) as recent_tokens,
        last_active,
        is_active,
        is_crowded,
        notes,
        created_at
      FROM smart_wallets
      WHERE is_active = true
      ORDER BY tier ASC, score DESC
      LIMIT 100`
    );

    const wallets = result.rows.map((row) => ({
      id: row.id,
      address: row.address,
      tier: row.tier,
      score: parseFloat(row.score) || 0,
      // Win rate: tokens that hit 2x+ / total tokens
      winRate: parseFloat(row.win_rate) || 0,
      // Average peak multiplier achieved
      avgReturn: parseFloat(row.avg_peak_multiplier) || parseFloat(row.average_return) || 0,
      // Total tokens this wallet entered early
      tokensEntered: row.tokens_entered || 0,
      // Tokens that hit 2x+
      tokensWon: row.tokens_won || 0,
      // Best single pick multiplier
      bestPick: parseFloat(row.best_pick_multiplier) || 0,
      // Recent token entries with results
      recentTokens: row.recent_tokens || [],
      lastActive: row.last_active,
      isCrowded: row.is_crowded || false,
      notes: row.notes,
      addedAt: row.created_at,
    }));

    res.json({
      success: true,
      data: wallets,
    });
  })
);

/**
 * GET /api/smart-wallets/:id
 * Get a specific smart wallet
 */
router.get(
  '/:id',
  asyncHandler(async (req: any, res: any) => {
    const { id } = req.params;

    const result = await getPool().query(
      `SELECT * FROM smart_wallets WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Wallet not found',
        code: 'WALLET_NOT_FOUND',
      });
    }

    const row = result.rows[0];
    const wallet = {
      id: row.id,
      address: row.address,
      tier: row.tier,
      score: parseFloat(row.score) || 0,
      winRate: parseFloat(row.win_rate) || 0,
      avgReturn: parseFloat(row.average_return) || 0,
      totalTrades: row.tokens_entered || 0,
      lastActive: row.last_active,
      isCrowded: row.is_crowded || false,
      notes: row.notes,
      metrics: {
        totalTrades: row.total_trades || 0,
        successfulTrades: row.successful_trades || 0,
        averageHoldTime: row.average_hold_time || 0
      },
      addedAt: row.created_at,
    };

    res.json({
      success: true,
      data: wallet,
    });
  })
);

/**
 * POST /api/smart-wallets
 * Add a new smart wallet to track
 */
router.post(
  '/',
  requireAuth,
  validateBody(schemas.smartWalletCreate),
  auditLog('SMART_WALLET_ADD'),
  asyncHandler(async (req: any, res: any) => {
    const { address, tier, notes } = req.body;
    // Validation is handled by schema

    // Check if wallet already exists
    const existing = await getPool().query(
      `SELECT id FROM smart_wallets WHERE address = $1`,
      [address]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({
        success: false,
        error: 'Wallet already tracked',
        code: 'WALLET_EXISTS',
      });
    }

    const walletId = randomUUID();
    const result = await getPool().query(
      `INSERT INTO smart_wallets
       (id, address, tier, notes, score, win_rate, average_return, tokens_entered,
        total_trades, successful_trades, average_hold_time, is_active, is_crowded, last_active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 50, 0, 0, 0, 0, 0, 0, true, false, NOW(), NOW(), NOW())
       RETURNING id, address, tier, score, created_at`,
      [walletId, address, tier, notes || null]
    );

    const row = result.rows[0];
    res.status(201).json({
      success: true,
      data: {
        id: row.id,
        address: row.address,
        tier: row.tier,
        score: 0,
        addedAt: row.created_at,
      },
    });
  })
);

/**
 * PATCH /api/smart-wallets/:id
 * Update a smart wallet
 */
router.patch(
  '/:id',
  requireAuth,
  validateParams(schemas.idParam),
  validateBody(schemas.smartWalletUpdate),
  auditLog('SMART_WALLET_UPDATE'),
  asyncHandler(async (req: any, res: any) => {
    const { id } = req.params;
    const { tier, notes, isCrowded, isActive } = req.body;

    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (tier !== undefined) {
      // Validation handled by schema
      updates.push(`tier = $${paramIndex++}`);
      values.push(tier);
    }

    if (notes !== undefined) {
      updates.push(`notes = $${paramIndex++}`);
      values.push(notes);
    }

    if (isCrowded !== undefined) {
      updates.push(`is_crowded = $${paramIndex++}`);
      values.push(isCrowded);
    }

    if (isActive !== undefined) {
      updates.push(`is_active = $${paramIndex++}`);
      values.push(isActive);
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No fields to update',
        code: 'NO_UPDATES',
      });
    }

    values.push(id);
    const result = await getPool().query(
      `UPDATE smart_wallets
       SET ${updates.join(', ')}, updated_at = NOW()
       WHERE id = $${paramIndex}
       RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Wallet not found',
        code: 'WALLET_NOT_FOUND',
      });
    }

    res.json({
      success: true,
      message: 'Wallet updated',
    });
  })
);

/**
 * DELETE /api/smart-wallets/:id
 * Remove a smart wallet from tracking
 */
router.delete(
  '/:id',
  requireAuth,
  validateParams(schemas.idParam),
  auditLog('SMART_WALLET_REMOVE'),
  asyncHandler(async (req: any, res: any) => {
    const { id } = req.params;

    const result = await getPool().query(
      `UPDATE smart_wallets SET is_active = false WHERE id = $1 RETURNING id`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Wallet not found',
        code: 'WALLET_NOT_FOUND',
      });
    }

    res.json({
      success: true,
      message: 'Wallet removed from tracking',
    });
  })
);

/**
 * POST /api/smart-wallets/import
 * Bulk import smart wallets
 */
router.post(
  '/import',
  requireAuth,
  validateBody(schemas.smartWalletImport),
  auditLog('SMART_WALLET_BULK_IMPORT'),
  asyncHandler(async (req: any, res: any) => {
    const { wallets } = req.body;

    const results = {
      imported: 0,
      skipped: 0,
      errors: [] as string[],
    };

    for (const wallet of wallets) {
      try {
        // Check if wallet already exists
        const existing = await getPool().query(
          `SELECT id, is_active FROM smart_wallets WHERE address = $1`,
          [wallet.address]
        );

        if (existing.rows.length > 0) {
          // Reactivate if inactive, otherwise skip
          if (!existing.rows[0].is_active) {
            await getPool().query(
              `UPDATE smart_wallets
               SET is_active = true, tier = $2, notes = $3, updated_at = NOW()
               WHERE address = $1`,
              [wallet.address, wallet.tier || 2, wallet.notes || null]
            );
            results.imported++;
          } else {
            results.skipped++;
          }
          continue;
        }

        // Insert new wallet with explicit UUID and all required columns
        await getPool().query(
          `INSERT INTO smart_wallets
           (id, address, tier, notes, score, win_rate, average_return, is_active, last_active,
            tokens_entered, total_trades, successful_trades, average_hold_time, is_crowded, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, 0, true, NOW(), 0, 0, 0, 0, false, NOW(), NOW())`,
          [
            randomUUID(),
            wallet.address,
            wallet.tier || 2,
            wallet.notes || null,
            wallet.score || 50,
            wallet.winRate || 0,
          ]
        );
        results.imported++;
      } catch (error: any) {
        results.errors.push(`${wallet.address.slice(0, 8)}...: ${error.message}`);
      }
    }

    res.status(201).json({
      success: true,
      data: results,
      message: `Imported ${results.imported} wallets, skipped ${results.skipped} existing`,
    });
  })
);

/**
 * POST /api/smart-wallets/backfill
 * Trigger backfill of discovery data for existing wallets
 */
router.post(
  '/backfill',
  requireAuth,
  auditLog('SMART_WALLET_BACKFILL'),
  asyncHandler(async (req: any, res: any) => {
    // Import dynamically to avoid circular dependencies
    const { Connection } = await import('@solana/web3.js');
    const { WalletScanner } = await import('../../discovery/wallet-scanner');

    const rpcUrl = process.env.SOLANA_RPC_PRIMARY || 'https://api.mainnet-beta.solana.com';
    const connection = new Connection(rpcUrl, 'confirmed');
    const scanner = new WalletScanner(connection);

    // Run backfill in background
    scanner.backfillExistingWallets().catch((error: any) => {
      console.error('Backfill error:', error);
    });

    res.json({
      success: true,
      message: 'Backfill started in background. Check logs for progress.',
    });
  })
);

export default router;
