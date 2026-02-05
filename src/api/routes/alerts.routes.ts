import { Router } from 'express';
import { asyncHandler } from '../middleware';
import { getPool } from '../../db/postgres';

const router = Router();

/**
 * GET /api/alerts
 * Get all alerts with optional filtering
 */
router.get(
  '/',
  asyncHandler(async (req: any, res: any) => {
    const { level, acknowledged, limit = 100 } = req.query;

    let query = `
      SELECT id, level, type, title, message, category, data, acknowledged, created_at
      FROM alerts
    `;
    const conditions: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (level) {
      conditions.push(`level = $${paramIndex++}`);
      values.push(level.toUpperCase());
    }

    if (acknowledged !== undefined) {
      conditions.push(`acknowledged = $${paramIndex++}`);
      values.push(acknowledged === 'true');
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramIndex}`;
    values.push(parseInt(limit as string, 10));

    const result = await getPool().query(query, values);

    const alerts = result.rows.map((row) => ({
      id: row.id,
      level: row.level?.toLowerCase() || 'info',
      type: row.type,
      title: row.title || row.type,
      message: row.message,
      category: row.category || 'system',
      data: row.data || {},
      acknowledged: row.acknowledged,
      timestamp: row.created_at,
    }));

    res.json({
      success: true,
      data: alerts,
    });
  })
);

/**
 * POST /api/alerts
 * Create a new alert
 */
router.post(
  '/',
  asyncHandler(async (req: any, res: any) => {
    const { level = 'info', type, title, message, category, data } = req.body;

    if (!message) {
      return res.status(400).json({
        success: false,
        error: 'Message is required',
        code: 'MESSAGE_REQUIRED',
      });
    }

    const result = await getPool().query(
      `INSERT INTO alerts (level, type, title, message, category, data)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, created_at`,
      [level.toUpperCase(), type || 'GENERAL', title, message, category || 'system', data || {}]
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
 * POST /api/alerts/:id/acknowledge
 * Mark an alert as acknowledged
 */
router.post(
  '/:id/acknowledge',
  asyncHandler(async (req: any, res: any) => {
    const { id } = req.params;

    const result = await getPool().query(
      `UPDATE alerts SET acknowledged = true WHERE id = $1 RETURNING id`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Alert not found',
        code: 'ALERT_NOT_FOUND',
      });
    }

    res.json({
      success: true,
      message: 'Alert acknowledged',
    });
  })
);

/**
 * POST /api/alerts/acknowledge-all
 * Mark all alerts as acknowledged
 */
router.post(
  '/acknowledge-all',
  asyncHandler(async (_req: any, res: any) => {
    await getPool().query(`UPDATE alerts SET acknowledged = true`);

    res.json({
      success: true,
      message: 'All alerts acknowledged',
    });
  })
);

/**
 * DELETE /api/alerts/:id
 * Delete a specific alert
 */
router.delete(
  '/:id',
  asyncHandler(async (req: any, res: any) => {
    const { id } = req.params;

    const result = await getPool().query(
      `DELETE FROM alerts WHERE id = $1 RETURNING id`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Alert not found',
        code: 'ALERT_NOT_FOUND',
      });
    }

    res.json({
      success: true,
      message: 'Alert deleted',
    });
  })
);

/**
 * DELETE /api/alerts/clear
 * Clear all alerts
 */
router.delete(
  '/clear',
  asyncHandler(async (_req: any, res: any) => {
    await getPool().query(`DELETE FROM alerts`);

    res.json({
      success: true,
      message: 'All alerts cleared',
    });
  })
);

export default router;
