import { Router } from 'express';
import { asyncHandler } from '../middleware';
import { getPool } from '../../db/postgres';

const router = Router();

/**
 * GET /api/logs
 * Get bot logs with filtering
 */
router.get(
  '/',
  asyncHandler(async (req: any, res: any) => {
    const { level, category, search, limit = 200, offset = 0 } = req.query;

    let query = `
      SELECT id, level, category, message, data, created_at
      FROM bot_logs
    `;
    const conditions: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (level && level !== 'all') {
      conditions.push(`level = $${paramIndex++}`);
      values.push(level);
    }

    if (category && category !== 'all') {
      conditions.push(`category = $${paramIndex++}`);
      values.push(category);
    }

    if (search) {
      conditions.push(`message ILIKE $${paramIndex++}`);
      values.push(`%${search}%`);
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
    values.push(parseInt(limit as string, 10));
    values.push(parseInt(offset as string, 10));

    const result = await getPool().query(query, values);

    const logs = result.rows.map((row) => ({
      id: row.id,
      level: row.level,
      category: row.category || 'general',
      message: row.message,
      data: row.data || {},
      timestamp: row.created_at,
    }));

    res.json({
      success: true,
      data: logs,
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
 * Get all unique log categories
 */
router.get(
  '/categories',
  asyncHandler(async (_req: any, res: any) => {
    const result = await getPool().query(
      `SELECT DISTINCT category FROM bot_logs WHERE category IS NOT NULL ORDER BY category`
    );

    res.json({
      success: true,
      data: result.rows.map((r) => r.category),
    });
  })
);

export default router;
