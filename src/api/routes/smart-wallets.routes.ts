import { Router } from 'express';
import { asyncHandler } from '../middleware';
import { getPool } from '../../db/postgres';

const router = Router();

/**
 * GET /api/smart-wallets
 * Get all tracked smart wallets
 */
router.get(
  '/',
  asyncHandler(async (req: any, res: any) => {
    const result = await getPool().query(
      `SELECT
        id,
        wallet_address,
        tier,
        score,
        win_rate,
        average_return,
        tokens_entered,
        last_active,
        is_active,
        is_crowded,
        notes,
        metrics,
        created_at
      FROM smart_wallets
      WHERE is_active = true
      ORDER BY tier ASC, score DESC`
    );

    const wallets = result.rows.map((row) => ({
      id: row.id,
      address: row.wallet_address,
      tier: row.tier,
      score: parseFloat(row.score) || 0,
      winRate: parseFloat(row.win_rate) || 0,
      avgReturn: parseFloat(row.average_return) || 0,
      totalTrades: row.tokens_entered || 0,
      lastActive: row.last_active,
      isCrowded: row.is_crowded || false,
      notes: row.notes,
      metrics: row.metrics || {},
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
      address: row.wallet_address,
      tier: row.tier,
      score: parseFloat(row.score) || 0,
      winRate: parseFloat(row.win_rate) || 0,
      avgReturn: parseFloat(row.average_return) || 0,
      totalTrades: row.tokens_entered || 0,
      lastActive: row.last_active,
      isCrowded: row.is_crowded || false,
      notes: row.notes,
      metrics: row.metrics || {},
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
  asyncHandler(async (req: any, res: any) => {
    const { address, tier = 3, notes } = req.body;

    if (!address || address.length !== 44) {
      return res.status(400).json({
        success: false,
        error: 'Invalid wallet address',
        code: 'INVALID_ADDRESS',
      });
    }

    // Check if wallet already exists
    const existing = await getPool().query(
      `SELECT id FROM smart_wallets WHERE wallet_address = $1`,
      [address]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({
        success: false,
        error: 'Wallet already tracked',
        code: 'WALLET_EXISTS',
      });
    }

    const result = await getPool().query(
      `INSERT INTO smart_wallets (wallet_address, tier, notes, metrics)
       VALUES ($1, $2, $3, $4)
       RETURNING id, wallet_address, tier, score, created_at`,
      [address, tier, notes || null, JSON.stringify({})]
    );

    const row = result.rows[0];
    res.status(201).json({
      success: true,
      data: {
        id: row.id,
        address: row.wallet_address,
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
  asyncHandler(async (req: any, res: any) => {
    const { id } = req.params;
    const { tier, notes, isCrowded, isActive } = req.body;

    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (tier !== undefined) {
      if (![1, 2, 3].includes(tier)) {
        return res.status(400).json({
          success: false,
          error: 'Tier must be 1, 2, or 3',
          code: 'INVALID_TIER',
        });
      }
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

export default router;
