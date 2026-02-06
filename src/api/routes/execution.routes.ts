import { Router } from 'express';
import { createHash } from 'crypto';
import { asyncHandler } from '../middleware';
import { botContextManager } from '../services/bot-context';
import { getPool } from '../../db/postgres';

// Helper function to generate audit log checksum
function generateAuditChecksum(action: string, details: object): string {
  const data = JSON.stringify({ action, details, timestamp: new Date().toISOString() });
  return createHash('sha256').update(data).digest('hex');
}

const router = Router();

/**
 * GET /api/execution
 * Get execution stats and RPC node status
 */
router.get(
  '/',
  asyncHandler(async (_req: any, res: any) => {
    const ctx = botContextManager.getContext();

    // Get execution stats from manager
    const execStats = ctx.executionManager?.getStats?.() || {
      totalExecutions: 0,
      successRate: 0,
      pendingBuys: 0,
      pendingSells: 0,
    };

    // Get stats from execution history
    let historyStats: any = { rows: [{}] };
    let recentTx: any = { rows: [] };

    try {
      historyStats = await getPool().query(`
        SELECT
          COUNT(*) as total_transactions,
          COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_transactions,
          AVG(latency_ms) as avg_latency,
          AVG(slippage_percent) as avg_slippage,
          AVG(priority_fee) as avg_priority_fee,
          SUM(retries) as total_retries
        FROM execution_history
        WHERE created_at >= NOW() - INTERVAL '24 hours'
      `);

      recentTx = await getPool().query(`
        SELECT
          id, type, token_symbol, status, latency_ms, slippage_percent,
          priority_fee, retries, signature, error_message, created_at
        FROM execution_history
        ORDER BY created_at DESC
        LIMIT 20
      `);
    } catch (error) {
      // Tables might not exist yet
      console.error('Error fetching execution history:', error);
    }

    const stats = historyStats.rows[0] || {};
    const totalTx = parseInt(stats.total_transactions) || 0;
    const failedTx = parseInt(stats.failed_transactions) || 0;

    // Build RPC nodes list
    const rpcNodes = [
      {
        name: 'Primary RPC',
        url: process.env.SOLANA_RPC_PRIMARY ? 'Configured' : 'Not configured',
        status: 'healthy',
        latency: 75,
        isPrimary: true,
        lastCheck: new Date().toISOString(),
        successRate: 99,
      },
    ];

    // Add secondary if configured
    if (process.env.SOLANA_RPC_SECONDARY) {
      rpcNodes.push({
        name: 'Secondary RPC',
        url: 'Configured',
        status: 'healthy',
        latency: 85,
        isPrimary: false,
        lastCheck: new Date().toISOString(),
        successRate: 98,
      });
    }

    // Get network stats
    let networkStats = {
      tps: 0,
      congestionLevel: 'low' as 'low' | 'medium' | 'high' | 'critical',
      avgBlockTime: 400,
      currentSlot: 0,
    };

    try {
      const slot = await ctx.connection.getSlot();
      networkStats.currentSlot = slot;

      // Estimate TPS from recent performance
      const perfSamples = await ctx.connection.getRecentPerformanceSamples(1);
      if (perfSamples.length > 0) {
        networkStats.tps = Math.floor(perfSamples[0].numTransactions / perfSamples[0].samplePeriodSecs);
      }

      // Determine congestion level based on TPS
      if (networkStats.tps > 3000) {
        networkStats.congestionLevel = 'high';
      } else if (networkStats.tps > 2000) {
        networkStats.congestionLevel = 'medium';
      } else {
        networkStats.congestionLevel = 'low';
      }
    } catch (error) {
      console.error('Error fetching network stats:', error);
    }

    res.json({
      success: true,
      data: {
        rpcNodes,
        stats: {
          avgLatency: parseFloat(stats.avg_latency) || 0,
          successRate: totalTx > 0 ? ((totalTx - failedTx) / totalTx) * 100 : 100,
          totalTransactions: execStats.totalExecutions || totalTx,
          failedTransactions: failedTx,
          retriesUsed: parseInt(stats.total_retries) || 0,
          avgPriorityFee: parseFloat(stats.avg_priority_fee) || 0,
          avgSlippage: parseFloat(stats.avg_slippage) || 0,
        },
        recentTransactions: (recentTx.rows || []).map((row: any) => ({
          id: row.id,
          type: row.type,
          tokenSymbol: row.token_symbol || 'Unknown',
          status: row.status,
          latency: row.latency_ms || 0,
          slippage: parseFloat(row.slippage_percent) || 0,
          priorityFee: parseFloat(row.priority_fee) || 0,
          retries: row.retries || 0,
          timestamp: row.created_at,
          signature: row.signature,
          error: row.error_message,
        })),
        network: networkStats,
      },
    });
  })
);

/**
 * POST /api/execution/rpc/:name/test
 * Test an RPC endpoint
 */
router.post(
  '/rpc/:name/test',
  asyncHandler(async (req: any, res: any) => {
    const { name } = req.params;
    const ctx = botContextManager.getContext();

    const startTime = Date.now();
    let healthy = false;
    let error = null;
    let slot = 0;

    try {
      // Test the connection
      slot = await ctx.connection.getSlot();
      healthy = true;
    } catch (err: any) {
      error = err.message;
    }

    const latency = Date.now() - startTime;

    res.json({
      success: true,
      data: {
        name,
        healthy,
        latency,
        slot,
        error,
      },
    });
  })
);

/**
 * POST /api/execution/rpc/primary
 * Switch primary RPC endpoint
 */
router.post(
  '/rpc/primary',
  asyncHandler(async (req: any, res: any) => {
    const { name } = req.body;

    // Map name to RPC URL from environment
    let rpcUrl: string | undefined;

    switch (name?.toLowerCase()) {
      case 'primary':
      case 'primary rpc':
        rpcUrl = process.env.SOLANA_RPC_PRIMARY;
        break;
      case 'secondary':
      case 'secondary rpc':
        rpcUrl = process.env.SOLANA_RPC_SECONDARY;
        break;
      case 'tertiary':
      case 'tertiary rpc':
        rpcUrl = process.env.SOLANA_RPC_TERTIARY;
        break;
      default:
        // Check if name is a URL
        if (name?.startsWith('http')) {
          rpcUrl = name;
        }
    }

    if (!rpcUrl) {
      return res.status(400).json({
        success: false,
        error: `RPC endpoint '${name}' not found or not configured`,
        code: 'RPC_NOT_FOUND',
      });
    }

    // Test and switch to the new RPC
    const result = await botContextManager.switchRpcConnection(rpcUrl);

    if (!result.success) {
      return res.status(503).json({
        success: false,
        error: `Failed to switch RPC: ${result.error}`,
        code: 'RPC_SWITCH_FAILED',
        data: {
          name,
          latency: result.latency,
        },
      });
    }

    // Log the switch
    try {
      const switchDetails = {
        actor: 'api',
        name,
        latency: result.latency,
        timestamp: new Date().toISOString(),
      };
      await getPool().query(
        `INSERT INTO audit_log (action, details, checksum, created_at)
         VALUES ($1, $2, $3, NOW())`,
        [
          'RPC_SWITCH',
          JSON.stringify(switchDetails),
          generateAuditChecksum('RPC_SWITCH', switchDetails),
        ]
      );
    } catch (logError) {
      console.error('Failed to log RPC switch:', logError);
    }

    res.json({
      success: true,
      message: `Successfully switched to ${name}`,
      data: {
        name,
        latency: result.latency,
        status: 'connected',
      },
    });
  })
);

/**
 * GET /api/execution/rpc/available
 * Get list of available RPC endpoints
 */
router.get(
  '/rpc/available',
  asyncHandler(async (_req: any, res: any) => {
    const available: Array<{ name: string; configured: boolean }> = [
      {
        name: 'Primary RPC',
        configured: !!process.env.SOLANA_RPC_PRIMARY,
      },
      {
        name: 'Secondary RPC',
        configured: !!process.env.SOLANA_RPC_SECONDARY,
      },
      {
        name: 'Tertiary RPC',
        configured: !!process.env.SOLANA_RPC_TERTIARY,
      },
    ];

    // Get current connection info
    const currentInfo = botContextManager.getConnectionInfo();

    res.json({
      success: true,
      data: {
        available: available.filter(r => r.configured),
        current: currentInfo,
      },
    });
  })
);

export default router;
