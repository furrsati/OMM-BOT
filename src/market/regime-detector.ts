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
  private manualOverride: MarketRegime | null = null;

  // In-memory cache for price data
  private priceCache: Map<string, AssetPrice> = new Map();
  private priceCacheTTL: number = 120000; // 2 minutes
  private lastRateLimitHit: number = 0;
  private rateLimitBackoffMs: number = 300000; // 5 minute backoff on rate limit

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
    // Manual override takes precedence
    if (this.manualOverride) {
      return this.manualOverride;
    }
    return this.currentRegime.regime;
  }

  /**
   * Get full regime state
   */
  getRegimeState(): RegimeState {
    // If manual override is set, return modified state
    if (this.manualOverride) {
      return {
        ...this.currentRegime,
        regime: this.manualOverride,
        reason: `Manual override: ${this.manualOverride}`
      };
    }
    return this.currentRegime;
  }

  /**
   * Set manual regime override (from dashboard)
   */
  setManualOverride(regime: MarketRegime | null): void {
    this.manualOverride = regime;
    logger.info(`Market regime override ${regime ? `set to: ${regime}` : 'cleared'}`);
  }

  /**
   * Clear manual override (return to automatic detection)
   */
  clearManualOverride(): void {
    this.manualOverride = null;
    logger.info('Market regime override cleared, returning to automatic detection');
  }

  /**
   * Check if manual override is active
   */
  isOverrideActive(): boolean {
    return this.manualOverride !== null;
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
      // Fetch all prices in a single batched request
      const prices = await this.fetchAllPrices();
      const sol = prices.get('SOL');
      const btc = prices.get('BTC');
      const eth = prices.get('ETH');

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
   * Fetch all asset prices with fallback sources
   * Primary: CoinGecko, Fallback: Binance public API
   */
  private async fetchAllPrices(): Promise<Map<string, AssetPrice>> {
    const symbols = ['SOL', 'BTC', 'ETH'];
    const result = new Map<string, AssetPrice>();
    const now = Date.now();

    // Check if all prices are in cache and still valid
    let allCached = true;
    for (const symbol of symbols) {
      const cached = this.priceCache.get(symbol);
      if (!cached || now - cached.timestamp > this.priceCacheTTL) {
        allCached = false;
        break;
      }
    }

    if (allCached) {
      for (const symbol of symbols) {
        result.set(symbol, this.priceCache.get(symbol)!);
      }
      return result;
    }

    // Check if we're in rate limit backoff period for CoinGecko
    const useCoingecko = !(this.lastRateLimitHit > 0 && now - this.lastRateLimitHit < this.rateLimitBackoffMs);

    // Try CoinGecko first (if not rate limited)
    if (useCoingecko) {
      const coingeckoResult = await this.fetchFromCoinGecko(symbols, now);
      if (coingeckoResult.size === symbols.length) {
        return coingeckoResult;
      }
    }

    // Fallback to Binance API (no rate limit issues for basic price data)
    const binanceResult = await this.fetchFromBinance(symbols, now);
    if (binanceResult.size > 0) {
      for (const [symbol, price] of binanceResult) {
        if (!result.has(symbol)) {
          result.set(symbol, price);
        }
      }
    }

    // If we have results, return them
    if (result.size > 0) {
      return result;
    }

    // Last resort: return cached data even if stale
    for (const symbol of symbols) {
      const cached = this.priceCache.get(symbol);
      if (cached) {
        result.set(symbol, cached);
      }
    }

    return result;
  }

  /**
   * Fetch prices from CoinGecko
   */
  private async fetchFromCoinGecko(symbols: string[], now: number): Promise<Map<string, AssetPrice>> {
    const result = new Map<string, AssetPrice>();

    try {
      const idMap: Record<string, string> = {
        SOL: 'solana',
        BTC: 'bitcoin',
        ETH: 'ethereum'
      };

      const coinIds = symbols.map(s => idMap[s]).join(',');

      const response = await axios.get(
        `https://api.coingecko.com/api/v3/simple/price`,
        {
          params: {
            ids: coinIds,
            vs_currencies: 'usd',
            include_24hr_change: true,
            include_7d_change: true
          },
          timeout: 5000
        }
      );

      for (const symbol of symbols) {
        const coinId = idMap[symbol];
        const data = response.data[coinId];

        if (data) {
          const assetPrice: AssetPrice = {
            symbol,
            priceUSD: data.usd,
            change24h: data.usd_24h_change || 0,
            change7d: data.usd_7d_change || 0,
            timestamp: now
          };
          this.priceCache.set(symbol, assetPrice);
          result.set(symbol, assetPrice);
        }
      }

      // Clear rate limit flag on success
      this.lastRateLimitHit = 0;

    } catch (error: any) {
      if (error.response?.status === 429) {
        logger.warn('CoinGecko rate limit hit, switching to Binance fallback');
        this.lastRateLimitHit = now;
      } else {
        logger.debug('Error fetching from CoinGecko', { error: error.message });
      }
    }

    return result;
  }

  /**
   * Fallback: Fetch prices from Binance public API (no API key needed)
   */
  private async fetchFromBinance(symbols: string[], now: number): Promise<Map<string, AssetPrice>> {
    const result = new Map<string, AssetPrice>();

    try {
      const binanceSymbols: Record<string, string> = {
        SOL: 'SOLUSDT',
        BTC: 'BTCUSDT',
        ETH: 'ETHUSDT'
      };

      // Fetch 24h ticker data for all symbols
      const symbolsList = symbols.map(s => binanceSymbols[s]).filter(Boolean);

      const response = await axios.get(
        'https://api.binance.com/api/v3/ticker/24hr',
        {
          params: {
            symbols: JSON.stringify(symbolsList)
          },
          timeout: 5000
        }
      );

      const tickerData = Array.isArray(response.data) ? response.data : [response.data];

      for (const ticker of tickerData) {
        // Find which symbol this is
        const symbol = symbols.find(s => binanceSymbols[s] === ticker.symbol);
        if (!symbol) continue;

        const assetPrice: AssetPrice = {
          symbol,
          priceUSD: parseFloat(ticker.lastPrice) || 0,
          change24h: parseFloat(ticker.priceChangePercent) || 0,
          change7d: 0, // Binance doesn't provide 7d change in this endpoint
          timestamp: now
        };

        this.priceCache.set(symbol, assetPrice);
        result.set(symbol, assetPrice);
      }

      if (result.size > 0) {
        logger.debug('Using Binance fallback for price data');
      }

    } catch (error: any) {
      logger.debug('Error fetching from Binance', { error: error.message });
    }

    return result;
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
