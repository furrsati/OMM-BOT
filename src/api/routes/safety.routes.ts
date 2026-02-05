import { Router } from 'express';
import { asyncHandler } from '../middleware';
import { botContextManager } from '../services/bot-context';
import { getPool } from '../../db/postgres';

const router = Router();

/**
 * GET /api/safety
 * Get safety stats and blacklist overview
 */
router.get(
  '/',
  asyncHandler(async (_req: any, res: any) => {
    // Get blacklist stats
    const blacklistResult = await getPool().query(`
      SELECT
        COUNT(*) as total_blacklisted,
        COUNT(CASE WHEN type = 'wallet' THEN 1 END) as wallet_count,
        COUNT(CASE WHEN type = 'contract' THEN 1 END) as contract_count
      FROM blacklist
    `);

    // Get recent blacklist entries
    const recentBlacklist = await getPool().query(`
      SELECT id, address, type, reason, created_at
      FROM blacklist
      ORDER BY created_at DESC
      LIMIT 10
    `);

    // Get safety scan stats from tokens table
    const tokenStats = await getPool().query(`
      SELECT
        COUNT(*) as tokens_scanned,
        AVG(safety_score) as avg_safety_score,
        COUNT(CASE WHEN is_honeypot = true THEN 1 END) as honeypots_detected
      FROM tokens
      WHERE created_at >= NOW() - INTERVAL '24 hours'
    `);

    // Get recent rejections from token_opportunities
    const recentRejections = await getPool().query(`
      SELECT token_address, token_name, rejection_reason, conviction_score as safety_score, decision_time
      FROM token_opportunities
      WHERE status = 'REJECTED'
      ORDER BY decision_time DESC
      LIMIT 10
    `);

    const stats = blacklistResult.rows[0];
    const tokenScanStats = tokenStats.rows[0];

    res.json({
      success: true,
      data: {
        stats: {
          totalBlacklisted: parseInt(stats.total_blacklisted) || 0,
          hardRejectsToday: parseInt(tokenScanStats.honeypots_detected) || 0,
          tokensScanned: parseInt(tokenScanStats.tokens_scanned) || 0,
          avgSafetyScore: parseFloat(tokenScanStats.avg_safety_score) || 0,
        },
        blacklist: recentBlacklist.rows.map((row) => ({
          id: row.id,
          address: row.address,
          type: row.type === 'wallet' ? 'deployer' : row.type,
          reason: row.reason,
          addedAt: row.created_at,
          rugCount: 0,
        })),
        recentRejections: recentRejections.rows.map((row) => ({
          tokenAddress: row.token_address,
          tokenName: row.token_name || 'Unknown',
          reason: row.rejection_reason || 'Safety check failed',
          timestamp: row.decision_time,
          safetyScore: parseFloat(row.safety_score) || 0,
        })),
      },
    });
  })
);

/**
 * POST /api/safety/check
 * Run safety analysis on a token
 */
router.post(
  '/check',
  asyncHandler(async (req: any, res: any) => {
    const { tokenAddress } = req.body;

    if (!tokenAddress || tokenAddress.length !== 44) {
      return res.status(400).json({
        success: false,
        error: 'Invalid token address',
        code: 'INVALID_ADDRESS',
      });
    }

    const ctx = botContextManager.getContext();
    const checks: Array<{ name: string; status: string; details: string; points: number }> = [];
    let totalScore = 0;

    try {
      // Run safety analysis using the SafetyScorer.analyze method
      const safetyResult = await ctx.safetyScorer.analyze(tokenAddress);

      // Map safety result to checks format
      if (safetyResult) {
        const isHoneypot = safetyResult.honeypotAnalysis?.isHoneypot || false;
        const hasMint = safetyResult.contractAnalysis?.hasMintAuthority || false;
        const hasFreeze = safetyResult.contractAnalysis?.hasFreezeAuthority || false;
        const holderConcentration = safetyResult.contractAnalysis?.topHolderPercent || 0;

        checks.push({
          name: 'Honeypot Check',
          status: isHoneypot ? 'fail' : 'pass',
          details: isHoneypot ? 'Token is a honeypot' : 'Token is tradeable',
          points: isHoneypot ? 0 : 20,
        });

        checks.push({
          name: 'Mint Authority',
          status: hasMint ? 'fail' : 'pass',
          details: hasMint ? 'Mint authority active' : 'No mint authority',
          points: hasMint ? 0 : 15,
        });

        checks.push({
          name: 'Freeze Authority',
          status: hasFreeze ? 'warning' : 'pass',
          details: hasFreeze ? 'Freeze authority active' : 'No freeze authority',
          points: hasFreeze ? 5 : 10,
        });

        checks.push({
          name: 'Holder Distribution',
          status: holderConcentration > 40 ? 'warning' : 'pass',
          details: `Top holders control ${holderConcentration.toFixed(1)}%`,
          points: holderConcentration > 40 ? 5 : 15,
        });

        checks.push({
          name: 'Overall Safety',
          status: safetyResult.overallScore >= 70 ? 'pass' : safetyResult.overallScore >= 50 ? 'warning' : 'fail',
          details: `Safety level: ${safetyResult.safetyLevel}`,
          points: safetyResult.overallScore >= 70 ? 20 : safetyResult.overallScore >= 50 ? 10 : 0,
        });

        checks.push({
          name: 'Blacklist Check',
          status: safetyResult.isHardRejected ? 'fail' : 'pass',
          details: safetyResult.rejectReason || 'Not blacklisted',
          points: safetyResult.isHardRejected ? 0 : 10,
        });

        totalScore = safetyResult.overallScore;
      }
    } catch (error: any) {
      checks.push({
        name: 'Analysis Error',
        status: 'fail',
        details: error.message || 'Failed to analyze token',
        points: 0,
      });
    }

    const passed = totalScore >= 50 && !checks.some((c) => c.name === 'Honeypot Check' && c.status === 'fail');

    res.json({
      success: true,
      data: {
        tokenAddress,
        checks,
        score: totalScore,
        maxScore: 90,
        passed,
      },
    });
  })
);

/**
 * GET /api/safety/blacklist
 * Get full blacklist
 */
router.get(
  '/blacklist',
  asyncHandler(async (req: any, res: any) => {
    const { type, limit = 100 } = req.query;

    let query = `SELECT id, address, type, reason, depth, evidence, created_at FROM blacklist`;
    const values: any[] = [];

    if (type) {
      query += ` WHERE type = $1`;
      values.push(type);
    }

    query += ` ORDER BY created_at DESC LIMIT $${values.length + 1}`;
    values.push(parseInt(limit as string, 10));

    const result = await getPool().query(query, values);

    const blacklist = result.rows.map((row) => ({
      id: row.id,
      address: row.address,
      type: row.type,
      reason: row.reason,
      depth: row.depth,
      evidence: row.evidence || {},
      addedAt: row.created_at,
    }));

    res.json({
      success: true,
      data: blacklist,
    });
  })
);

/**
 * POST /api/safety/blacklist
 * Add address to blacklist
 */
router.post(
  '/blacklist',
  asyncHandler(async (req: any, res: any) => {
    const { address, type = 'wallet', reason } = req.body;

    if (!address || address.length !== 44) {
      return res.status(400).json({
        success: false,
        error: 'Invalid address',
        code: 'INVALID_ADDRESS',
      });
    }

    if (!reason) {
      return res.status(400).json({
        success: false,
        error: 'Reason is required',
        code: 'REASON_REQUIRED',
      });
    }

    // Check if already blacklisted
    const existing = await getPool().query(
      `SELECT id FROM blacklist WHERE address = $1`,
      [address]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({
        success: false,
        error: 'Address already blacklisted',
        code: 'ALREADY_BLACKLISTED',
      });
    }

    const result = await getPool().query(
      `INSERT INTO blacklist (address, type, reason) VALUES ($1, $2, $3) RETURNING id, created_at`,
      [address, type, reason]
    );

    res.status(201).json({
      success: true,
      data: {
        id: result.rows[0].id,
        address,
        type,
        reason,
        addedAt: result.rows[0].created_at,
      },
    });
  })
);

/**
 * DELETE /api/safety/blacklist/:id
 * Remove address from blacklist
 */
router.delete(
  '/blacklist/:id',
  asyncHandler(async (req: any, res: any) => {
    const { id } = req.params;

    const result = await getPool().query(
      `DELETE FROM blacklist WHERE id = $1 RETURNING id`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Blacklist entry not found',
        code: 'NOT_FOUND',
      });
    }

    res.json({
      success: true,
      message: 'Removed from blacklist',
    });
  })
);

export default router;
