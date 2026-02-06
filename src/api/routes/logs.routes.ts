import { Router } from 'express';
import { asyncHandler } from '../middleware';
import { getPool } from '../../db/postgres';
import { logThinking, logStep, logCheckpoint, logScoring, logDecision, logAnalysis, logCalculation } from '../../utils/logger';

const router = Router();

/**
 * GET /api/logs
 * Get bot logs with filtering - combines bot_logs and audit_log tables
 */
router.get(
  '/',
  asyncHandler(async (req: any, res: any) => {
    const { level, category, search, limit = 200, offset = 0 } = req.query;
    const parsedLimit = parseInt(limit as string, 10);
    const parsedOffset = parseInt(offset as string, 10);

    // Query both bot_logs and audit_log tables and combine them
    // bot_logs has: id, level, category, message, data, created_at
    // audit_log has: id, action, details (JSONB), checksum, created_at

    let botLogsQuery = `
      SELECT
        id::text,
        level,
        category,
        message,
        data,
        created_at,
        'bot' as source
      FROM bot_logs
    `;

    let auditLogsQuery = `
      SELECT
        id::text,
        'info' as level,
        'audit' as category,
        action as message,
        details as data,
        created_at,
        'audit' as source
      FROM audit_log
    `;

    const botConditions: string[] = [];
    const auditConditions: string[] = [];
    const botValues: any[] = [];
    const auditValues: any[] = [];
    let botParamIndex = 1;
    let auditParamIndex = 1;

    // Apply filters to bot_logs
    if (level && level !== 'all') {
      botConditions.push(`level = $${botParamIndex++}`);
      botValues.push(level);
    }

    if (category && category !== 'all') {
      if (category === 'audit') {
        // Only show audit logs
        botConditions.push('1 = 0'); // Exclude bot_logs
      } else {
        botConditions.push(`category = $${botParamIndex++}`);
        botValues.push(category);
        auditConditions.push('1 = 0'); // Exclude audit_log for non-audit categories
      }
    }

    if (search) {
      botConditions.push(`message ILIKE $${botParamIndex++}`);
      botValues.push(`%${search}%`);
      auditConditions.push(`action ILIKE $${auditParamIndex++}`);
      auditValues.push(`%${search}%`);
    }

    if (botConditions.length > 0) {
      botLogsQuery += ` WHERE ${botConditions.join(' AND ')}`;
    }
    if (auditConditions.length > 0) {
      auditLogsQuery += ` WHERE ${auditConditions.join(' AND ')}`;
    }

    // Combine with UNION ALL and order by created_at
    const combinedQuery = `
      SELECT * FROM (
        (${botLogsQuery})
        UNION ALL
        (${auditLogsQuery})
      ) combined
      ORDER BY created_at DESC
      LIMIT $1 OFFSET $2
    `;

    // Execute queries
    const allValues = [...botValues, ...auditValues, parsedLimit, parsedOffset];

    // We need to handle the parameterization differently for UNION
    // Execute each query separately and combine in JS
    const [botResult, auditResult] = await Promise.all([
      getPool().query(
        botConditions.length > 0
          ? `${botLogsQuery} ORDER BY created_at DESC`
          : `${botLogsQuery} ORDER BY created_at DESC`,
        botValues
      ),
      getPool().query(
        auditConditions.length > 0
          ? `${auditLogsQuery} ORDER BY created_at DESC`
          : `${auditLogsQuery} ORDER BY created_at DESC`,
        auditValues
      ),
    ]);

    // Combine and sort
    const allLogs = [
      ...botResult.rows.map((row) => ({
        id: row.id,
        level: row.level,
        category: row.category || 'general',
        message: row.message,
        data: row.data || {},
        timestamp: row.created_at,
        source: 'bot',
      })),
      ...auditResult.rows.map((row) => ({
        id: row.id,
        level: 'info',
        category: 'audit',
        message: row.message, // action
        data: typeof row.data === 'string' ? JSON.parse(row.data) : row.data || {},
        timestamp: row.created_at,
        source: 'audit',
      })),
    ];

    // Sort by timestamp descending
    allLogs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    // Apply pagination
    const paginatedLogs = allLogs.slice(parsedOffset, parsedOffset + parsedLimit);

    res.json({
      success: true,
      data: paginatedLogs,
    });
  })
);

/**
 * POST /api/logs
 * Add a log entry (internal use)
 */
router.post(
  '/',
  asyncHandler(async (req: any, res: any) => {
    const { level = 'info', category, message, data } = req.body;

    if (!message) {
      return res.status(400).json({
        success: false,
        error: 'Message is required',
        code: 'MESSAGE_REQUIRED',
      });
    }

    const result = await getPool().query(
      `INSERT INTO bot_logs (level, category, message, data)
       VALUES ($1, $2, $3, $4)
       RETURNING id, created_at`,
      [level, category || 'general', message, data || {}]
    );

    res.status(201).json({
      success: true,
      data: {
        id: result.rows[0].id,
        timestamp: result.rows[0].created_at,
      },
    });
  })
);

/**
 * DELETE /api/logs/clear
 * Clear all logs (or logs older than X days)
 */
router.delete(
  '/clear',
  asyncHandler(async (req: any, res: any) => {
    const { olderThanDays } = req.query;

    if (olderThanDays) {
      await getPool().query(
        `DELETE FROM bot_logs WHERE created_at < NOW() - INTERVAL '${parseInt(olderThanDays as string, 10)} days'`
      );
    } else {
      await getPool().query(`DELETE FROM bot_logs`);
    }

    res.json({
      success: true,
      message: 'Logs cleared',
    });
  })
);

/**
 * GET /api/logs/categories
 * Get all unique log categories (includes 'audit' for audit_log entries)
 */
router.get(
  '/categories',
  asyncHandler(async (_req: any, res: any) => {
    const result = await getPool().query(
      `SELECT DISTINCT category FROM bot_logs WHERE category IS NOT NULL ORDER BY category`
    );

    // Add 'audit' as a category for audit_log entries
    const categories = result.rows.map((r) => r.category);
    if (!categories.includes('audit')) {
      categories.push('audit');
    }
    categories.sort();

    res.json({
      success: true,
      data: categories,
    });
  })
);

/**
 * POST /api/logs/test
 * Generate test logs to verify logging system is working
 * This simulates what the bot logs during token analysis
 */
router.post(
  '/test',
  asyncHandler(async (_req: any, res: any) => {
    const testToken = 'TEST' + Math.random().toString(36).substring(2, 8).toUpperCase();

    // Simulate a complete token analysis flow with detailed logging
    logStep(1, 5, `[TEST] Starting safety analysis for ${testToken}...`);
    logThinking('SAFETY', `[TEST] Analyzing token ${testToken} for honeypots, authorities, and holder concentration`);

    await new Promise(r => setTimeout(r, 100));

    logCheckpoint('Blacklist Check', 'PASS', '[TEST] Token not on blacklist');
    logCheckpoint('Mint Authority', 'PASS', '[TEST] No mint authority or revoked');
    logCheckpoint('Freeze Authority', 'PASS', '[TEST] No freeze authority or revoked');
    logCheckpoint('Holder Concentration', 'PASS', '[TEST] Top holder owns 8.5% (< 30%)');
    logCheckpoint('Honeypot Detection', 'PASS', '[TEST] Sell simulation successful (tax: 2.5%)');

    await new Promise(r => setTimeout(r, 100));

    logStep(2, 5, `[TEST] Calculating safety scores...`);
    logScoring('Contract/Authority', 28, 30, '[TEST] MintAuth: NO, FreezeAuth: NO');
    logScoring('Holder Distribution', 22, 25, '[TEST] TopHolder: 8.5%, Top10: 35.2%');
    logScoring('Honeypot Safety', 23, 25, '[TEST] CanSell: YES, SellTax: 2.5%, BuyTax: 1.0%');
    logScoring('Liquidity', 18, 20, '[TEST] Depth: $125,000, Locked: YES');

    await new Promise(r => setTimeout(r, 100));

    logStep(3, 5, `[TEST] Calculating conviction score...`);
    logThinking('WEIGHTS', '[TEST] Loading category weights from Learning Engine', {
      smartWallet: '30%',
      tokenSafety: '25%',
      marketConditions: '15%',
      socialSignals: '10%',
      entryQuality: '20%'
    });

    logScoring('Smart Wallet', 75, 100, '[TEST] Tier1: 2, Tier2: 3, Tier3: 1, AvgScore: 72');
    logScoring('Token Safety', 91, 100, '[TEST] HardRejected: false, Level: SAFE');
    logScoring('Market Conditions', 85, 100, '[TEST] Regime: FULL, SOL 24h: +3.5%, PeakHours: true');
    logScoring('Social Signals', 60, 100, '[TEST] Twitter: true, Telegram: true, Followers: 5200');
    logScoring('Entry Quality', 78, 100, '[TEST] DipDepth: 25%, FromATH: 32%, Phase: DISCOVERY');

    await new Promise(r => setTimeout(r, 100));

    logCalculation('[TEST] Weighted Contributions', {
      smartWallet: '75 × 0.30 = 22.5',
      safety: '91 × 0.25 = 22.75',
      market: '85 × 0.15 = 12.75',
      social: '60 × 0.10 = 6.0',
      entry: '78 × 0.20 = 15.6'
    }, '79.6');

    logThinking('BASE_SCORE', '[TEST] Sum of weighted contributions = 79.6');
    logThinking('PATTERN_MATCH', '[TEST] Pattern matching adjustment: +3 (based on similar past trades)');
    logThinking('REGIME_ADJ', '[TEST] Market regime adjustment: 0 (regime: FULL)');

    logCalculation('[TEST] Final Score', {
      baseScore: '79.6',
      patternAdj: '+3',
      regimeAdj: '0'
    }, '82.6');

    await new Promise(r => setTimeout(r, 100));

    logStep(4, 5, `[TEST] Making entry decision...`);
    logCheckpoint('Hard Reject Rules', 'PASS', '[TEST] No hard rejects triggered');
    logCheckpoint('Daily Loss Limit', 'PASS', '[TEST] Daily P&L 2.5% > -8%');
    logCheckpoint('Max Positions', 'PASS', '[TEST] 2 < 5 positions');
    logCheckpoint('Cooldown Period', 'PASS', '[TEST] No cooldown active');
    logCheckpoint('Conviction Threshold', 'PASS', '[TEST] Score 82.6 meets MEDIUM threshold (70+)');
    logCheckpoint('Portfolio Exposure', 'PASS', '[TEST] 8% <= 20%');

    await new Promise(r => setTimeout(r, 100));

    logStep(5, 5, `[TEST] Final decision...`);
    logDecision('APPROVED FOR ENTRY', '[TEST] All checks passed', {
      token: testToken,
      conviction: '82.6',
      level: 'MEDIUM',
      positionSize: '2.5%'
    });

    logThinking('SUMMARY', `[TEST] Entry approved: ${testToken} | Conviction: 82.6 (MEDIUM) | Position: 2.5%`);

    logAnalysis('COMPLETE', `[TEST] Token ${testToken} analysis complete - QUALIFIED`, {
      safetyScore: 91,
      convictionScore: 82.6,
      decision: 'APPROVED',
      positionSize: '2.5%'
    });

    res.json({
      success: true,
      message: 'Test logs generated successfully. Check the Activity Logs page to see them.',
      data: {
        testToken,
        logsGenerated: 25,
        categories: ['step', 'thinking', 'checkpoint', 'scoring', 'calculation', 'decision', 'analysis']
      }
    });
  })
);

export default router;
