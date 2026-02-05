import { Router } from 'express';
import { asyncHandler } from '../middleware';
import { botContextManager } from '../services/bot-context';

const router = Router();

/**
 * GET /api/market/regime
 * Get current market regime (FULL, CAUTIOUS, DEFENSIVE, PAUSE)
 */
router.get(
  '/regime',
  asyncHandler(async (req: any, res: any) => {
    const ctx = botContextManager.getContext();

    const regimeState = ctx.regimeDetector.getRegimeState();

    res.json({
      success: true,
      data: {
        regime: regimeState.regime,
        reason: regimeState.reason,
        solTrend: regimeState.solTrend,
        btcTrend: regimeState.btcTrend,
        solChange24h: regimeState.solChange24h,
        btcChange24h: regimeState.btcChange24h,
        lastUpdate: regimeState.lastUpdate,
      },
    });
  })
);

/**
 * GET /api/market/prices
 * Get current SOL and BTC prices with trends
 */
router.get(
  '/prices',
  asyncHandler(async (req: any, res: any) => {
    const ctx = botContextManager.getContext();

    const regimeState = ctx.regimeDetector.getRegimeState();

    // Determine trend based on 24h change
    const getSolTrend = (change: number) => {
      if (change > 3) return 'UP';
      if (change < -3) return 'DOWN';
      return 'STABLE';
    };

    const getBtcTrend = (change: number) => {
      if (change > 5) return 'UP';
      if (change < -5) return 'DOWN';
      return 'STABLE';
    };

    res.json({
      success: true,
      data: {
        sol: {
          trend: regimeState.solTrend.toUpperCase(),
          change24h: regimeState.solChange24h,
        },
        btc: {
          trend: regimeState.btcTrend.toUpperCase(),
          change24h: regimeState.btcChange24h,
        },
        lastUpdate: regimeState.lastUpdate,
      },
    });
  })
);

/**
 * GET /api/market/smart-wallets
 * Get tracked smart wallet statistics
 */
router.get(
  '/smart-wallets',
  asyncHandler(async (req: any, res: any) => {
    const ctx = botContextManager.getContext();

    const watchlist = ctx.walletManager.getWatchlist();

    // Group by tier
    const byTier = {
      tier1: watchlist.filter((w) => w.tier === 1).length,
      tier2: watchlist.filter((w) => w.tier === 2).length,
      tier3: watchlist.filter((w) => w.tier === 3).length,
    };

    // Calculate average score
    const avgScore =
      watchlist.length > 0
        ? watchlist.reduce((sum, w) => sum + w.score, 0) / watchlist.length
        : 0;

    // Calculate average win rate
    const avgWinRate =
      watchlist.length > 0
        ? watchlist.reduce((sum, w) => sum + w.winRate, 0) / watchlist.length
        : 0;

    res.json({
      success: true,
      data: {
        total: watchlist.length,
        byTier,
        avgScore: parseFloat(avgScore.toFixed(2)),
        avgWinRate: parseFloat(avgWinRate.toFixed(2)),
        topWallets: watchlist.slice(0, 10).map((w) => ({
          address: w.address,
          tier: w.tier,
          score: w.score,
          winRate: w.winRate,
          tokensEntered: w.tokensEntered,
          lastActive: w.lastActive,
        })),
      },
    });
  })
);

export default router;
