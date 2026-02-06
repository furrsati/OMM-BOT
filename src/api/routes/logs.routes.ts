import { Router } from 'express';
import { asyncHandler } from '../middleware';
import { getPool } from '../../db/postgres';

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

export default router;
