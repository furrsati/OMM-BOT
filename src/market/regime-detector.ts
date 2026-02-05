/**
 * Market Regime Detector
 *
 * Tracks macro market conditions and determines trading regime:
 * - FULL: Normal trading (SOL/BTC stable or up)
 * - CAUTIOUS: Reduce sizes (SOL down 3-7% or BTC down 5%+)
 * - DEFENSIVE: Only high conviction (SOL down 7-15%)
 * - PAUSE: Stop trading (SOL down 15%+)
 *
 * Monitors:
 * - SOL price trend (24h, 7d)
 * - BTC price trend (24h)
 * - ETH/SOL ratio (capital flow)
 * - Overall crypto market cap
 */

import axios from 'axios';
import { logger } from '../utils/logger';
import { MarketRegime } from '../types';

interface AssetPrice {
  symbol: string;
  priceUSD: number;
  change24h: number;
  change7d: number;
  timestamp: number;
}

interface RegimeState {
  regime: MarketRegime;
  solTrend: 'up' | 'stable' | 'down';
  btcTrend: 'up' | 'stable' | 'down';
  ethSolRatio: number;
  solChange24h: number;
  btcChange24h: number;
  lastUpdate: number;
  reason: string;
}

export class RegimeDetector {
  private currentRegime: RegimeState;
  private isRunning: boolean = false;
  private updateIntervalMs: number = 60000; // 1 minute

  constructor() {
    this.currentRegime = {
      regime: 'FULL',
      solTrend: 'stable',
      btcTrend: 'stable',
      ethSolRatio: 0,
      solChange24h: 0,
      btcChange24h: 0,
      lastUpdate: Date.now(),
      reason: 'Initializing...'
    };
  }

  /**
   * Start regime monitoring
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Regime detector already running');
      return;
    }

    this.isRunning = true;
    logger.info('🌍 Starting market regime detector...');

    // Initial update
    await this.updateRegime();

    // Start update loop
    this.updateLoop();
  }

  /**
   * Stop regime monitoring
   */
  stop(): void {
    this.isRunning = false;
    logger.info('Regime detector stopped');
  }

  /**
   * Get current market regime
   */
  getRegime(): MarketRegime {
    return this.currentRegime.regime;
  }

  /**
   * Get full regime state
   */
  getRegimeState(): RegimeState {
    return this.currentRegime;
  }

  /**
   * Check if trading is allowed in current regime
   */
  isTradingAllowed(): boolean {
    return this.currentRegime.regime !== 'PAUSE';
  }

  /**
   * Get position size multiplier for current regime
   */
  getPositionSizeMultiplier(): number {
    switch (this.currentRegime.regime) {
      case 'FULL':
        return 1.0;
      case 'CAUTIOUS':
        return 0.5;
      case 'DEFENSIVE':
        return 0.25;
      case 'PAUSE':
        return 0;
      default:
        return 1.0;
    }
  }

  /**
   * Get conviction threshold adjustment for current regime
   */
  getConvictionThresholdAdjustment(): number {
    switch (this.currentRegime.regime) {
      case 'FULL':
        return 0;
      case 'CAUTIOUS':
        return 10; // +10 points required
      case 'DEFENSIVE':
        return 20; // +20 points required
      case 'PAUSE':
        return 100; // Impossible threshold
      default:
        return 0;
    }
  }

  /**
   * Update loop
   */
  private async updateLoop(): Promise<void> {
    while (this.isRunning) {
      try {
        await this.updateRegime();
        await this.sleep(this.updateIntervalMs);
      } catch (error: any) {
        logger.error('Error in regime update loop', { error: error.message });
        await this.sleep(5000);
      }
    }
  }

  /**
   * Update market regime
   */
  private async updateRegime(): Promise<void> {
    try {
      // Fetch price data
      const sol = await this.fetchAssetPrice('SOL');
      const btc = await this.fetchAssetPrice('BTC');
      const eth = await this.fetchAssetPrice('ETH');

      if (!sol || !btc) {
        logger.warn('Could not fetch SOL/BTC prices, keeping current regime');
        return;
      }

      // Determine trends
      const solTrend = this.determineTrend(sol.change24h);
      const btcTrend = this.determineTrend(btc.change24h);

      // Calculate ETH/SOL ratio (capital flow indicator)
      const ethSolRatio = eth && sol ? eth.priceUSD / sol.priceUSD : 0;

      // Determine regime based on rules
      const newRegime = this.determineRegime(sol.change24h, btc.change24h);

      // Check if regime changed
      if (newRegime.regime !== this.currentRegime.regime) {
        logger.warn(`🌍 MARKET REGIME CHANGED: ${this.currentRegime.regime} → ${newRegime.regime}`, {
          reason: newRegime.reason,
          solChange: sol.change24h.toFixed(2) + '%',
          btcChange: btc.change24h.toFixed(2) + '%'
        });
      }

      // Update state
      this.currentRegime = {
        regime: newRegime.regime,
        solTrend,
        btcTrend,
        ethSolRatio,
        solChange24h: sol.change24h,
        btcChange24h: btc.change24h,
        lastUpdate: Date.now(),
        reason: newRegime.reason
      };

      // Cache regime
      await this.cacheRegime();

    } catch (error: any) {
      logger.error('Error updating regime', { error: error.message });
    }
  }

  /**
   * Determine market regime based on rules
   */
  private determineRegime(solChange24h: number, btcChange24h: number): { regime: MarketRegime; reason: string } {
    // Rule 1: SOL down 15%+ → PAUSE
    if (solChange24h <= -15) {
      return {
        regime: 'PAUSE',
        reason: `SOL down ${Math.abs(solChange24h).toFixed(1)}% (> 15%)`
      };
    }

    // Rule 2: SOL down 7-15% → DEFENSIVE
    if (solChange24h <= -7) {
      return {
        regime: 'DEFENSIVE',
        reason: `SOL down ${Math.abs(solChange24h).toFixed(1)}% (7-15%)`
      };
    }

    // Rule 3: BTC down 10%+ → DEFENSIVE (regardless of SOL)
    if (btcChange24h <= -10) {
      return {
        regime: 'DEFENSIVE',
        reason: `BTC down ${Math.abs(btcChange24h).toFixed(1)}% (> 10%)`
      };
    }

    // Rule 4: SOL down 3-7% OR BTC down 5-10% → CAUTIOUS
    if (solChange24h <= -3 || btcChange24h <= -5) {
      return {
        regime: 'CAUTIOUS',
        reason: solChange24h <= -3
          ? `SOL down ${Math.abs(solChange24h).toFixed(1)}% (3-7%)`
          : `BTC down ${Math.abs(btcChange24h).toFixed(1)}% (5-10%)`
      };
    }

    // Rule 5: All clear → FULL
    return {
      regime: 'FULL',
      reason: 'SOL/BTC stable or up'
    };
  }

  /**
   * Determine trend from 24h change
   */
  private determineTrend(change24h: number): 'up' | 'stable' | 'down' {
    if (change24h > 2) return 'up';
    if (change24h < -2) return 'down';
    return 'stable';
  }

  /**
   * Fetch asset price from CoinGecko
   */
  private async fetchAssetPrice(symbol: string): Promise<AssetPrice | null> {
    try {
      // Map symbols to CoinGecko IDs
      const idMap: Record<string, string> = {
        SOL: 'solana',
        BTC: 'bitcoin',
        ETH: 'ethereum'
      };

      const coinId = idMap[symbol];
      if (!coinId) {
        logger.warn(`Unknown symbol: ${symbol}`);
        return null;
      }

      // REDIS REMOVED - caching disabled
      // Try cache first
      // const cacheKey = `asset_price:${symbol}`;
      // const cached = await this.redis.get(cacheKey);
      // if (cached) {
      //   const data = JSON.parse(cached);
      //   // If cache is less than 1 minute old, use it
      //   if (Date.now() - data.timestamp < 60000) {
      //     return data;
      //   }
      // }

      // Fetch from CoinGecko
      const response = await axios.get(
        `https://api.coingecko.com/api/v3/simple/price`,
        {
          params: {
            ids: coinId,
            vs_currencies: 'usd',
            include_24hr_change: true,
            include_7d_change: true
          },
          timeout: 5000
        }
      );

      const data = response.data[coinId];
      if (!data) {
        logger.warn(`No price data for ${symbol}`);
        return null;
      }

      const assetPrice: AssetPrice = {
        symbol,
        priceUSD: data.usd,
        change24h: data.usd_24h_change || 0,
        change7d: data.usd_7d_change || 0,
        timestamp: Date.now()
      };

      // REDIS REMOVED - caching disabled
      // Cache for 1 minute
      // await this.redis.setEx(cacheKey, 60, JSON.stringify(assetPrice));

      return assetPrice;

    } catch (error: any) {
      // Check if it's a rate limit error
      if (error.response?.status === 429) {
        logger.warn('CoinGecko rate limit hit, using cache');
      } else {
        logger.debug(`Error fetching ${symbol} price`, { error: error.message });
      }
      return null;
    }
  }

  /**
   * Cache regime state
   */
  private async cacheRegime(): Promise<void> {
    try {
      // REDIS REMOVED - caching disabled
      // await this.redis.setEx(
      //   'market_regime',
      //   300, // 5 minutes
      //   JSON.stringify(this.currentRegime)
      // );
    } catch (error: any) {
      logger.debug('Error caching regime', { error: error.message });
    }
  }

  /**
   * Load regime from cache
   */
  async loadRegime(): Promise<void> {
    try {
      // REDIS REMOVED - caching disabled
      // const cached = await this.redis.get('market_regime');
      // if (cached) {
      //   this.currentRegime = JSON.parse(cached);
      //   logger.info(`Loaded cached regime: ${this.currentRegime.regime}`);
      // }
    } catch (error: any) {
      logger.debug('Error loading cached regime', { error: error.message });
    }
  }

  /**
   * Helper: Sleep
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
