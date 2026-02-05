/**
 * Danger Signal Monitor
 *
 * Monitors for danger signals that require immediate exit:
 * - LP removal (>10% liquidity pulled → warning, >25% → emergency)
 * - Holder count drop (>15% in 5 min → exit)
 * - Smart wallet exits (50%+ of tracked wallets exit → exit)
 * - Dev wallet sells (>2% of holdings → exit)
 * - Contract parameter changes → instant exit
 * - Large whale dumps (>5% supply in one tx → tighten stop to 5%)
 * - Buy/sell ratio flip (80%+ sells for 3+ min → exit)
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { logger } from '../utils/logger';
import { PositionData } from './position-tracker';
import { WalletManager } from '../discovery/wallet-manager';
import { PriceFeed } from '../market/price-feed';

export interface DangerSignal {
  isDangerous: boolean;
  signalType?: 'lp_removal' | 'holder_drop' | 'smart_wallet_exit' | 'dev_sell' | 'contract_change' | 'whale_dump' | 'sell_pressure';
  severity: 'warning' | 'critical' | 'emergency';
  reason?: string;
  recommendation: 'monitor' | 'tighten_stop' | 'exit_immediately';
}

interface PositionMonitoringData {
  tokenAddress: string;
  initialLiquidity: number;
  initialHolderCount: number;
  holderHistory: { time: number; count: number }[];
  lastLPCheck: number;
  lastHolderCheck: number;
  sellPressureMinutes: number; // Consecutive minutes with >80% sells
}

export class DangerMonitor {
  private connection: Connection;
  private walletManager: WalletManager;
  private priceFeed: PriceFeed;
  private monitoringData: Map<string, PositionMonitoringData> = new Map();

  private readonly LP_WARNING_THRESHOLD = 0.10; // 10% liquidity removed
  private readonly LP_EMERGENCY_THRESHOLD = 0.25; // 25% liquidity removed
  private readonly HOLDER_DROP_THRESHOLD = 0.15; // 15% holder drop in 5 min
  private readonly SMART_WALLET_EXIT_THRESHOLD = 0.50; // 50% of smart wallets exit
  private readonly DEV_SELL_THRESHOLD = 0.02; // 2% of dev holdings
  private readonly WHALE_DUMP_THRESHOLD = 0.05; // 5% of supply
  private readonly SELL_PRESSURE_THRESHOLD = 0.80; // 80% sells
  private readonly SELL_PRESSURE_DURATION = 3; // 3 consecutive minutes

  constructor(connection: Connection, walletManager: WalletManager, priceFeed: PriceFeed) {
    this.connection = connection;
    this.walletManager = walletManager;
    this.priceFeed = priceFeed;
  }

  /**
   * Start monitoring a position for danger signals
   */
  async startMonitoring(position: PositionData, initialLiquidity: number, initialHolderCount: number): Promise<void> {
    this.monitoringData.set(position.tokenAddress, {
      tokenAddress: position.tokenAddress,
      initialLiquidity,
      initialHolderCount,
      holderHistory: [{ time: Date.now(), count: initialHolderCount }],
      lastLPCheck: Date.now(),
      lastHolderCheck: Date.now(),
      sellPressureMinutes: 0
    });

    logger.debug('Started danger monitoring', {
      token: position.tokenAddress.slice(0, 8),
      initialLP: initialLiquidity,
      initialHolders: initialHolderCount
    });
  }

  /**
   * Stop monitoring a position
   */
  stopMonitoring(tokenAddress: string): void {
    this.monitoringData.delete(tokenAddress);
  }

  /**
   * Check all danger signals for a position
   */
  async checkDangerSignals(position: PositionData): Promise<DangerSignal> {
    const data = this.monitoringData.get(position.tokenAddress);
    if (!data) {
      return { isDangerous: false, severity: 'warning', recommendation: 'monitor' };
    }

    // Check each danger signal (order by severity)

    // 1. Check for contract changes (CRITICAL)
    const contractCheck = await this.checkContractChanges(position);
    if (contractCheck.isDangerous) {
      return contractCheck;
    }

    // 2. Check liquidity removal (EMERGENCY)
    const lpCheck = await this.checkLiquidityRemoval(position, data);
    if (lpCheck.isDangerous) {
      return lpCheck;
    }

    // 3. Check smart wallet exits (CRITICAL)
    const smartWalletCheck = await this.checkSmartWalletExits(position);
    if (smartWalletCheck.isDangerous) {
      return smartWalletCheck;
    }

    // 4. Check holder count drop (CRITICAL)
    const holderCheck = await this.checkHolderDrop(position, data);
    if (holderCheck.isDangerous) {
      return holderCheck;
    }

    // 5. Check dev wallet sells (CRITICAL)
    const devCheck = await this.checkDevSells(position);
    if (devCheck.isDangerous) {
      return devCheck;
    }

    // 6. Check whale dumps (WARNING - tighten stop)
    const whaleCheck = await this.checkWhaleDumps(position);
    if (whaleCheck.isDangerous) {
      return whaleCheck;
    }

    // 7. Check sell pressure (WARNING)
    const sellPressureCheck = await this.checkSellPressure(position, data);
    if (sellPressureCheck.isDangerous) {
      return sellPressureCheck;
    }

    return { isDangerous: false, severity: 'warning', recommendation: 'monitor' };
  }

  /**
   * Check for contract parameter changes
   */
  private async checkContractChanges(position: PositionData): Promise<DangerSignal> {
    // STUB: In production, monitor contract state changes
    // For now, return safe
    return { isDangerous: false, severity: 'warning', recommendation: 'monitor' };
  }

  /**
   * Check for liquidity removal
   */
  private async checkLiquidityRemoval(position: PositionData, data: PositionMonitoringData): Promise<DangerSignal> {
    try {
      // Get current liquidity from price feed
      const priceData = await this.priceFeed.getPrice(position.tokenAddress);
      if (!priceData) {
        return { isDangerous: false, severity: 'warning', recommendation: 'monitor' };
      }

      const currentLiquidity = priceData.liquidityUSD;
      const liquidityRemoved = (data.initialLiquidity - currentLiquidity) / data.initialLiquidity;

      data.lastLPCheck = Date.now();

      // Emergency threshold
      if (liquidityRemoved >= this.LP_EMERGENCY_THRESHOLD) {
        logger.error('🚨 EMERGENCY: Major liquidity removal detected', {
          token: position.tokenAddress.slice(0, 8),
          symbol: position.tokenSymbol,
          removed: (liquidityRemoved * 100).toFixed(1) + '%',
          initialLP: data.initialLiquidity,
          currentLP: currentLiquidity
        });

        return {
          isDangerous: true,
          signalType: 'lp_removal',
          severity: 'emergency',
          reason: `${(liquidityRemoved * 100).toFixed(1)}% of liquidity removed`,
          recommendation: 'exit_immediately'
        };
      }

      // Warning threshold
      if (liquidityRemoved >= this.LP_WARNING_THRESHOLD) {
        logger.warn('⚠️ WARNING: Significant liquidity removal', {
          token: position.tokenAddress.slice(0, 8),
          symbol: position.tokenSymbol,
          removed: (liquidityRemoved * 100).toFixed(1) + '%'
        });

        return {
          isDangerous: true,
          signalType: 'lp_removal',
          severity: 'critical',
          reason: `${(liquidityRemoved * 100).toFixed(1)}% of liquidity removed`,
          recommendation: 'exit_immediately'
        };
      }

    } catch (error: any) {
      logger.error('Error checking liquidity', {
        token: position.tokenAddress.slice(0, 8),
        error: error.message
      });
    }

    return { isDangerous: false, severity: 'warning', recommendation: 'monitor' };
  }

  /**
   * Check for holder count drop
   */
  private async checkHolderDrop(position: PositionData, data: PositionMonitoringData): Promise<DangerSignal> {
    try {
      // STUB: In production, fetch current holder count from on-chain data
      // For now, simulate holder tracking
      const currentHolderCount = data.initialHolderCount; // Placeholder

      // Update holder history
      data.holderHistory.push({ time: Date.now(), count: currentHolderCount });

      // Keep only last 10 minutes of history
      const tenMinutesAgo = Date.now() - (10 * 60 * 1000);
      data.holderHistory = data.holderHistory.filter(h => h.time > tenMinutesAgo);

      data.lastHolderCheck = Date.now();

      // Check for 15% drop in last 5 minutes
      const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
      const recentHistory = data.holderHistory.filter(h => h.time > fiveMinutesAgo);

      if (recentHistory.length >= 2) {
        const oldestCount = recentHistory[0].count;
        const holderDrop = (oldestCount - currentHolderCount) / oldestCount;

        if (holderDrop >= this.HOLDER_DROP_THRESHOLD) {
          logger.error('🚨 Holder count dropped significantly', {
            token: position.tokenAddress.slice(0, 8),
            symbol: position.tokenSymbol,
            drop: (holderDrop * 100).toFixed(1) + '%',
            before: oldestCount,
            now: currentHolderCount
          });

          return {
            isDangerous: true,
            signalType: 'holder_drop',
            severity: 'critical',
            reason: `Holder count dropped ${(holderDrop * 100).toFixed(1)}% in 5 minutes`,
            recommendation: 'exit_immediately'
          };
        }
      }

    } catch (error: any) {
      logger.error('Error checking holder count', {
        token: position.tokenAddress.slice(0, 8),
        error: error.message
      });
    }

    return { isDangerous: false, severity: 'warning', recommendation: 'monitor' };
  }

  /**
   * Check for smart wallet exits
   */
  private async checkSmartWalletExits(position: PositionData): Promise<DangerSignal> {
    try {
      if (position.smartWalletsInPosition.length === 0) {
        return { isDangerous: false, severity: 'warning', recommendation: 'monitor' };
      }

      // STUB: In production, check which smart wallets still hold the token
      // For now, assume all still holding
      const stillHolding = position.smartWalletsInPosition.length;
      const totalTracked = position.smartWalletsInPosition.length;
      const exitPercent = (totalTracked - stillHolding) / totalTracked;

      if (exitPercent >= this.SMART_WALLET_EXIT_THRESHOLD) {
        logger.error('🚨 Smart wallets exiting position', {
          token: position.tokenAddress.slice(0, 8),
          symbol: position.tokenSymbol,
          exited: (exitPercent * 100).toFixed(0) + '%'
        });

        return {
          isDangerous: true,
          signalType: 'smart_wallet_exit',
          severity: 'critical',
          reason: `${(exitPercent * 100).toFixed(0)}% of tracked smart wallets exited`,
          recommendation: 'exit_immediately'
        };
      }

    } catch (error: any) {
      logger.error('Error checking smart wallet exits', {
        token: position.tokenAddress.slice(0, 8),
        error: error.message
      });
    }

    return { isDangerous: false, severity: 'warning', recommendation: 'monitor' };
  }

  /**
   * Check for dev wallet sells
   */
  private async checkDevSells(position: PositionData): Promise<DangerSignal> {
    // STUB: In production, monitor dev wallet transactions
    // For now, return safe
    return { isDangerous: false, severity: 'warning', recommendation: 'monitor' };
  }

  /**
   * Check for whale dumps
   */
  private async checkWhaleDumps(position: PositionData): Promise<DangerSignal> {
    // STUB: In production, monitor large sell transactions
    // If detected, return warning to tighten stop
    return { isDangerous: false, severity: 'warning', recommendation: 'monitor' };
  }

  /**
   * Check for sustained sell pressure
   */
  private async checkSellPressure(position: PositionData, data: PositionMonitoringData): Promise<DangerSignal> {
    // STUB: In production, track buy/sell ratio from DEX transactions
    // Increment sellPressureMinutes if >80% sells
    // If >= 3 minutes, trigger exit
    return { isDangerous: false, severity: 'warning', recommendation: 'monitor' };
  }

  /**
   * Get monitoring stats for a position
   */
  getMonitoringStats(tokenAddress: string) {
    const data = this.monitoringData.get(tokenAddress);
    if (!data) {
      return null;
    }

    return {
      tokenAddress,
      initialLiquidity: data.initialLiquidity,
      initialHolderCount: data.initialHolderCount,
      holderHistorySize: data.holderHistory.length,
      sellPressureMinutes: data.sellPressureMinutes,
      lastLPCheck: data.lastLPCheck,
      lastHolderCheck: data.lastHolderCheck
    };
  }
}
