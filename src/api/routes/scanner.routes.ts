import { Router } from 'express';
import { asyncHandler } from '../middleware';
import { botContextManager } from '../services/bot-context';
import { getPool } from '../../db/postgres';

const router = Router();

/**
 * GET /api/scanner
 * Get all tokens currently being analyzed/watched by the bot
 */
router.get(
  '/',
  asyncHandler(async (_req: any, res: any) => {
    // Get active opportunities (not expired)
    const result = await getPool().query(`
      SELECT
        id,
        token_address,
        token_name,
        token_symbol,
        deployer_address,
        discovered_at,
        discovered_via,
        smart_wallets_entered,
        smart_wallet_count,
        tier1_count,
        tier2_count,
        tier3_count,
        safety_score,
        safety_checks,
        is_honeypot,
        has_mint_authority,
        has_freeze_authority,
        current_price,
        market_cap,
        liquidity_usd,
        holder_count,
        volume_24h,
        price_change_1h,
        price_change_24h,
        dip_from_high,
        ath_price,
        token_age_minutes,
        hype_phase,
        conviction_score,
        conviction_breakdown,
        status,
        rejection_reason,
        decision_time,
        last_updated
      FROM token_opportunities
      WHERE expires_at > NOW()
      ORDER BY
        CASE status
          WHEN 'ANALYZING' THEN 1
          WHEN 'QUALIFIED' THEN 2
          WHEN 'REJECTED' THEN 3
          WHEN 'ENTERED' THEN 4
          ELSE 5
        END,
        conviction_score DESC,
        discovered_at DESC
      LIMIT 100
    `);

    const opportunities = result.rows.map((row) => ({
      id: row.id,
      tokenAddress: row.token_address,
      tokenName: row.token_name || 'Unknown',
      tokenSymbol: row.token_symbol || '???',
      deployerAddress: row.deployer_address,
      discoveredAt: row.discovered_at,
      discoveredVia: row.discovered_via,

      // Smart wallet data
      smartWallets: {
        addresses: row.smart_wallets_entered || [],
        total: row.smart_wallet_count || 0,
        tier1: row.tier1_count || 0,
        tier2: row.tier2_count || 0,
        tier3: row.tier3_count || 0,
      },

      // Safety analysis
      safety: {
        score: parseFloat(row.safety_score) || 0,
        checks: row.safety_checks || {},
        isHoneypot: row.is_honeypot || false,
        hasMintAuthority: row.has_mint_authority,
        hasFreezeAuthority: row.has_freeze_authority,
      },

      // Market data
      market: {
        price: parseFloat(row.current_price) || 0,
        marketCap: parseFloat(row.market_cap) || 0,
        liquidity: parseFloat(row.liquidity_usd) || 0,
        holders: row.holder_count || 0,
        volume24h: parseFloat(row.volume_24h) || 0,
        priceChange1h: parseFloat(row.price_change_1h) || 0,
        priceChange24h: parseFloat(row.price_change_24h) || 0,
      },

      // Entry analysis
      entry: {
        dipFromHigh: parseFloat(row.dip_from_high) || 0,
        athPrice: parseFloat(row.ath_price) || 0,
        tokenAgeMinutes: row.token_age_minutes || 0,
        hypePhase: row.hype_phase || 'UNKNOWN',
      },

      // Conviction
      conviction: {
        score: parseFloat(row.conviction_score) || 0,
        breakdown: row.conviction_breakdown || {},
      },

      // Decision
      status: row.status,
      rejectionReason: row.rejection_reason,
      decisionTime: row.decision_time,
      lastUpdated: row.last_updated,
    }));

    // Get summary stats
    const statsResult = await getPool().query(`
      SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN status = 'ANALYZING' THEN 1 END) as analyzing,
        COUNT(CASE WHEN status = 'QUALIFIED' THEN 1 END) as qualified,
        COUNT(CASE WHEN status = 'REJECTED' THEN 1 END) as rejected,
        COUNT(CASE WHEN status = 'ENTERED' THEN 1 END) as entered,
        AVG(conviction_score) FILTER (WHERE status = 'ANALYZING') as avg_conviction
      FROM token_opportunities
      WHERE expires_at > NOW()
    `);

    const stats = statsResult.rows[0];

    res.json({
      success: true,
      data: {
        opportunities,
        stats: {
          total: parseInt(stats.total) || 0,
          analyzing: parseInt(stats.analyzing) || 0,
          qualified: parseInt(stats.qualified) || 0,
          rejected: parseInt(stats.rejected) || 0,
          entered: parseInt(stats.entered) || 0,
          avgConviction: parseFloat(stats.avg_conviction) || 0,
        },
      },
    });
  })
);

/**
 * GET /api/scanner/:tokenAddress
 * Get detailed analysis for a specific token
 */
router.get(
  '/:tokenAddress',
  asyncHandler(async (req: any, res: any) => {
    const { tokenAddress } = req.params;

    const result = await getPool().query(
      `SELECT * FROM token_opportunities WHERE token_address = $1`,
      [tokenAddress]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Token not found in scanner',
        code: 'NOT_FOUND',
      });
    }

    const row = result.rows[0];

    res.json({
      success: true,
      data: {
        id: row.id,
        tokenAddress: row.token_address,
        tokenName: row.token_name,
        tokenSymbol: row.token_symbol,
        deployerAddress: row.deployer_address,
        discoveredAt: row.discovered_at,
        discoveredVia: row.discovered_via,
        smartWallets: {
          addresses: row.smart_wallets_entered || [],
          total: row.smart_wallet_count || 0,
          tier1: row.tier1_count || 0,
          tier2: row.tier2_count || 0,
          tier3: row.tier3_count || 0,
        },
        safety: {
          score: parseFloat(row.safety_score) || 0,
          checks: row.safety_checks || {},
          isHoneypot: row.is_honeypot || false,
          hasMintAuthority: row.has_mint_authority,
          hasFreezeAuthority: row.has_freeze_authority,
        },
        market: {
          price: parseFloat(row.current_price) || 0,
          marketCap: parseFloat(row.market_cap) || 0,
          liquidity: parseFloat(row.liquidity_usd) || 0,
          holders: row.holder_count || 0,
          volume24h: parseFloat(row.volume_24h) || 0,
          priceChange1h: parseFloat(row.price_change_1h) || 0,
          priceChange24h: parseFloat(row.price_change_24h) || 0,
        },
        entry: {
          dipFromHigh: parseFloat(row.dip_from_high) || 0,
          athPrice: parseFloat(row.ath_price) || 0,
          tokenAgeMinutes: row.token_age_minutes || 0,
          hypePhase: row.hype_phase || 'UNKNOWN',
        },
        conviction: {
          score: parseFloat(row.conviction_score) || 0,
          breakdown: row.conviction_breakdown || {},
        },
        status: row.status,
        rejectionReason: row.rejection_reason,
        decisionTime: row.decision_time,
        expiresAt: row.expires_at,
        lastUpdated: row.last_updated,
      },
    });
  })
);

/**
 * POST /api/scanner/analyze
 * Manually trigger analysis of a token
 */
router.post(
  '/analyze',
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

    // Check if already being analyzed
    const existing = await getPool().query(
      `SELECT id FROM token_opportunities WHERE token_address = $1 AND expires_at > NOW()`,
      [tokenAddress]
    );

    if (existing.rows.length > 0) {
      return res.json({
        success: true,
        message: 'Token already being analyzed',
        data: { id: existing.rows[0].id },
      });
    }

    // Run safety analysis
    let safetyScore = 0;
    let safetyChecks = {};
    let isHoneypot = false;
    let hasMintAuthority = false;
    let hasFreezeAuthority = false;

    try {
      const safetyResult = await ctx.safetyScorer.analyze(tokenAddress);
      if (safetyResult) {
        safetyScore = safetyResult.overallScore || 0;
        isHoneypot = safetyResult.honeypotAnalysis?.isHoneypot || false;
        hasMintAuthority = safetyResult.contractAnalysis?.hasMintAuthority || false;
        hasFreezeAuthority = safetyResult.contractAnalysis?.hasFreezeAuthority || false;
        safetyChecks = safetyResult;
      }
    } catch (error: any) {
      console.error('Safety analysis error:', error.message);
    }

    // Determine initial status
    let status = 'ANALYZING';
    let rejectionReason = null;

    if (isHoneypot) {
      status = 'REJECTED';
      rejectionReason = 'HONEYPOT DETECTED';
    } else if (hasMintAuthority) {
      status = 'REJECTED';
      rejectionReason = 'Mint authority active';
    }

    // Insert opportunity
    const result = await getPool().query(
      `INSERT INTO token_opportunities (
        token_address, discovered_via, safety_score, safety_checks,
        is_honeypot, has_mint_authority, has_freeze_authority,
        status, rejection_reason, conviction_score
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id`,
      [
        tokenAddress,
        'manual',
        safetyScore,
        JSON.stringify(safetyChecks),
        isHoneypot,
        hasMintAuthority,
        hasFreezeAuthority,
        status,
        rejectionReason,
        safetyScore, // Initial conviction = safety score
      ]
    );

    res.status(201).json({
      success: true,
      message: 'Token added to scanner',
      data: {
        id: result.rows[0].id,
        status,
        safetyScore,
        rejectionReason,
      },
    });
  })
);

/**
 * DELETE /api/scanner/:id
 * Remove a token from the scanner
 */
router.delete(
  '/:id',
  asyncHandler(async (req: any, res: any) => {
    const { id } = req.params;

    const result = await getPool().query(
      `DELETE FROM token_opportunities WHERE id = $1 RETURNING id`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Token not found',
        code: 'NOT_FOUND',
      });
    }

    res.json({
      success: true,
      message: 'Token removed from scanner',
    });
  })
);

/**
 * POST /api/scanner/clear-expired
 * Clear expired opportunities
 */
router.post(
  '/clear-expired',
  asyncHandler(async (_req: any, res: any) => {
    const result = await getPool().query(
      `DELETE FROM token_opportunities WHERE expires_at <= NOW() RETURNING id`
    );

    res.json({
      success: true,
      message: `Cleared ${result.rowCount} expired opportunities`,
    });
  })
);

/**
 * POST /api/scanner/cleanup-aggressive
 * Run aggressive cleanup to focus on high-quality tokens only
 * This removes all low-quality tokens immediately
 */
router.post(
  '/cleanup-aggressive',
  asyncHandler(async (_req: any, res: any) => {
    const pool = getPool();

    // 1. Mark tokens with low liquidity as DEAD
    const lowLiquidity = await pool.query(`
      UPDATE token_opportunities
      SET status = 'DEAD', rejection_reason = 'Low liquidity (<$5K)'
      WHERE status IN ('ANALYZING', 'WATCHING', 'QUALIFIED')
      AND (liquidity_usd IS NULL OR liquidity_usd < 5000)
    `);

    // 2. Mark tokens with low safety score as DEAD
    const lowSafety = await pool.query(`
      UPDATE token_opportunities
      SET status = 'DEAD', rejection_reason = 'Low safety score (<40)'
      WHERE status IN ('ANALYZING', 'WATCHING')
      AND safety_score IS NOT NULL AND safety_score < 40
    `);

    // 3. Mark tokens with low conviction as DEAD (only if older than 30 min)
    const lowConviction = await pool.query(`
      UPDATE token_opportunities
      SET status = 'DEAD', rejection_reason = 'Low conviction score (<30)'
      WHERE status IN ('ANALYZING', 'WATCHING')
      AND conviction_score IS NOT NULL AND conviction_score < 30
      AND discovered_at < NOW() - INTERVAL '30 minutes'
    `);

    // 4. Mark tokens with no smart wallet interest as DEAD
    const noWallets = await pool.query(`
      UPDATE token_opportunities
      SET status = 'DEAD', rejection_reason = 'No smart wallet interest'
      WHERE status IN ('ANALYZING', 'WATCHING')
      AND (smart_wallet_count IS NULL OR smart_wallet_count = 0)
      AND discovered_at < NOW() - INTERVAL '30 minutes'
    `);

    // 5. Mark tokens with price collapse as DEAD
    const priceCollapse = await pool.query(`
      UPDATE token_opportunities
      SET status = 'DEAD', rejection_reason = 'Price collapsed >80%'
      WHERE status IN ('ANALYZING', 'WATCHING', 'QUALIFIED')
      AND ath_price > 0 AND current_price > 0
      AND (current_price / ath_price) < 0.2
    `);

    // 6. Delete all REJECTED tokens
    const deletedRejected = await pool.query(`
      DELETE FROM token_opportunities WHERE status = 'REJECTED'
    `);

    // 7. Delete all DEAD tokens older than 1 hour
    const deletedDead = await pool.query(`
      DELETE FROM token_opportunities
      WHERE status = 'DEAD' AND discovered_at < NOW() - INTERVAL '1 hour'
    `);

    // 8. Delete all EXPIRED tokens older than 4 hours
    const deletedExpired = await pool.query(`
      DELETE FROM token_opportunities
      WHERE status = 'EXPIRED' AND discovered_at < NOW() - INTERVAL '4 hours'
    `);

    // Get remaining count
    const remaining = await pool.query(`
      SELECT COUNT(*) as count FROM token_opportunities
      WHERE status IN ('ANALYZING', 'WATCHING', 'QUALIFIED')
    `);

    const totalMarkedDead =
      (lowLiquidity.rowCount || 0) +
      (lowSafety.rowCount || 0) +
      (lowConviction.rowCount || 0) +
      (noWallets.rowCount || 0) +
      (priceCollapse.rowCount || 0);

    const totalDeleted =
      (deletedRejected.rowCount || 0) +
      (deletedDead.rowCount || 0) +
      (deletedExpired.rowCount || 0);

    res.json({
      success: true,
      message: `Aggressive cleanup complete`,
      stats: {
        markedDead: totalMarkedDead,
        deleted: totalDeleted,
        remaining: remaining.rows[0]?.count || 0,
        breakdown: {
          lowLiquidity: lowLiquidity.rowCount || 0,
          lowSafety: lowSafety.rowCount || 0,
          lowConviction: lowConviction.rowCount || 0,
          noWallets: noWallets.rowCount || 0,
          priceCollapse: priceCollapse.rowCount || 0,
          deletedRejected: deletedRejected.rowCount || 0,
          deletedDead: deletedDead.rowCount || 0,
          deletedExpired: deletedExpired.rowCount || 0
        }
      }
    });
  })
);

export default router;
