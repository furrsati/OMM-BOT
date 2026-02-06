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
import { getMint, getAccount, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { logger } from '../utils/logger';
import { rateLimitedRPC } from '../utils/rate-limiter';
import { PositionData } from './position-tracker';
import { WalletManager } from '../discovery/wallet-manager';
import { PriceFeed } from '../market/price-feed';
import { query } from '../db/postgres';

// Pump.fun bonding curve program ID
const PUMP_FUN_PROGRAM = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');

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
  // Contract state snapshot for change detection
  contractSnapshot?: {
    mintAuthority: string | null;
    freezeAuthority: string | null;
    supply: bigint;
    decimals: number;
  };
  // Dev wallet tracking
  devWallet?: string;
  initialDevBalance?: number;
  // Recent transactions for whale/sell pressure detection
  recentSellVolume: number;
  recentBuyVolume: number;
  lastVolumeCheck: number;
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
   * Check if token is a pump.fun bonding curve token
   * These tokens are owned by the pump.fun program, not the SPL Token Program
   */
  private async isPumpFunToken(tokenAddress: string): Promise<boolean> {
    try {
      const tokenPubkey = new PublicKey(tokenAddress);
      const accountInfo = await rateLimitedRPC(
        () => this.connection.getAccountInfo(tokenPubkey),
        5 // medium priority
      );
      if (!accountInfo) return false;
      return accountInfo.owner.equals(PUMP_FUN_PROGRAM);
    } catch {
      return false;
    }
  }

  /**
   * Start monitoring a position for danger signals
   */
  async startMonitoring(position: PositionData, initialLiquidity: number, initialHolderCount: number): Promise<void> {
    const monitoringData: PositionMonitoringData = {
      tokenAddress: position.tokenAddress,
      initialLiquidity,
      initialHolderCount,
      holderHistory: [{ time: Date.now(), count: initialHolderCount }],
      lastLPCheck: Date.now(),
      lastHolderCheck: Date.now(),
      sellPressureMinutes: 0,
      recentSellVolume: 0,
      recentBuyVolume: 0,
      lastVolumeCheck: Date.now()
    };

    // Capture contract state snapshot for change detection
    try {
      const mintPubkey = new PublicKey(position.tokenAddress);

      // Check if pump.fun token - use safe defaults if so
      if (await this.isPumpFunToken(position.tokenAddress)) {
        // Pump.fun bonding curve tokens have no mint/freeze authority by design
        monitoringData.contractSnapshot = {
          mintAuthority: null,
          freezeAuthority: null,
          supply: BigInt(0),
          decimals: 6
        };
        logger.debug('Pump.fun token - using safe defaults for contract snapshot', {
          token: position.tokenAddress.slice(0, 8)
        });
      } else {
        // Standard SPL token
        const mintInfo = await rateLimitedRPC(
          () => getMint(this.connection, mintPubkey),
          6 // higher priority for monitoring
        );

        monitoringData.contractSnapshot = {
          mintAuthority: mintInfo.mintAuthority?.toBase58() || null,
          freezeAuthority: mintInfo.freezeAuthority?.toBase58() || null,
          supply: mintInfo.supply,
          decimals: mintInfo.decimals
        };

        logger.debug('Captured contract snapshot', {
          token: position.tokenAddress.slice(0, 8),
          mintAuthority: monitoringData.contractSnapshot.mintAuthority ? 'present' : 'none',
          freezeAuthority: monitoringData.contractSnapshot.freezeAuthority ? 'present' : 'none',
          supply: mintInfo.supply.toString()
        });
      }
    } catch (error: any) {
      logger.warn('Could not capture contract snapshot', {
        token: position.tokenAddress.slice(0, 8),
        error: error.message
      });
    }

    // Try to identify dev wallet from database (token deployer)
    try {
      const tokenResult = await query<{ deployer: string }>(
        `SELECT deployer FROM tokens WHERE contract_address = $1 LIMIT 1`,
        [position.tokenAddress]
      );

      if (tokenResult.rows.length > 0 && tokenResult.rows[0].deployer) {
        monitoringData.devWallet = tokenResult.rows[0].deployer;

        // Get dev's initial token balance
        const devBalance = await this.getWalletTokenBalance(
          monitoringData.devWallet,
          position.tokenAddress
        );
        monitoringData.initialDevBalance = devBalance;

        logger.debug('Tracking dev wallet', {
          token: position.tokenAddress.slice(0, 8),
          devWallet: monitoringData.devWallet.slice(0, 8),
          initialBalance: devBalance
        });
      }
    } catch (error: any) {
      logger.debug('Could not identify dev wallet', { error: error.message });
    }

    this.monitoringData.set(position.tokenAddress, monitoringData);

    logger.debug('Started danger monitoring', {
      token: position.tokenAddress.slice(0, 8),
      initialLP: initialLiquidity,
      initialHolders: initialHolderCount
    });
  }

  /**
   * Get token balance for a wallet
   */
  private async getWalletTokenBalance(walletAddress: string, tokenAddress: string): Promise<number> {
    try {
      const walletPubkey = new PublicKey(walletAddress);
      const mintPubkey = new PublicKey(tokenAddress);

      // Find associated token account
      const tokenAccounts = await this.connection.getTokenAccountsByOwner(walletPubkey, {
        mint: mintPubkey
      });

      if (tokenAccounts.value.length === 0) {
        return 0;
      }

      // Get balance from the first token account
      const accountInfo = await getAccount(this.connection, tokenAccounts.value[0].pubkey);
      return Number(accountInfo.amount);
    } catch (error: any) {
      logger.debug('Error getting wallet token balance', { error: error.message });
      return 0;
    }
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
    const data = this.monitoringData.get(position.tokenAddress);
    if (!data?.contractSnapshot) {
      return { isDangerous: false, severity: 'warning', recommendation: 'monitor' };
    }

    try {
      // Skip contract change monitoring for pump.fun tokens (immutable bonding curve)
      if (await this.isPumpFunToken(position.tokenAddress)) {
        return { isDangerous: false, severity: 'warning', recommendation: 'monitor' };
      }

      const mintPubkey = new PublicKey(position.tokenAddress);
      const currentMintInfo = await rateLimitedRPC(
        () => getMint(this.connection, mintPubkey),
        6 // higher priority for danger monitoring
      );

      const snapshot = data.contractSnapshot;

      // Check if mint authority was added (stealth capability added)
      const currentMintAuth = currentMintInfo.mintAuthority?.toBase58() || null;
      if (snapshot.mintAuthority === null && currentMintAuth !== null) {
        logger.error('🚨 CRITICAL: Mint authority added to contract!', {
          token: position.tokenAddress.slice(0, 8),
          symbol: position.tokenSymbol,
          newMintAuthority: currentMintAuth
        });

        return {
          isDangerous: true,
          signalType: 'contract_change',
          severity: 'emergency',
          reason: 'Mint authority was added to contract - possible stealth mint setup',
          recommendation: 'exit_immediately'
        };
      }

      // Check if freeze authority was added
      const currentFreezeAuth = currentMintInfo.freezeAuthority?.toBase58() || null;
      if (snapshot.freezeAuthority === null && currentFreezeAuth !== null) {
        logger.error('🚨 CRITICAL: Freeze authority added to contract!', {
          token: position.tokenAddress.slice(0, 8),
          symbol: position.tokenSymbol,
          newFreezeAuthority: currentFreezeAuth
        });

        return {
          isDangerous: true,
          signalType: 'contract_change',
          severity: 'emergency',
          reason: 'Freeze authority was added - trading could be paused',
          recommendation: 'exit_immediately'
        };
      }

      // Check for unexpected supply increase (stealth mint occurred)
      const supplyIncrease = Number(currentMintInfo.supply - snapshot.supply);
      const supplyIncreasePercent = supplyIncrease / Number(snapshot.supply);

      if (supplyIncreasePercent > 0.01) { // More than 1% supply increase
        logger.error('🚨 CRITICAL: Token supply increased (stealth mint detected)!', {
          token: position.tokenAddress.slice(0, 8),
          symbol: position.tokenSymbol,
          originalSupply: snapshot.supply.toString(),
          currentSupply: currentMintInfo.supply.toString(),
          increase: (supplyIncreasePercent * 100).toFixed(2) + '%'
        });

        return {
          isDangerous: true,
          signalType: 'contract_change',
          severity: 'emergency',
          reason: `Token supply increased by ${(supplyIncreasePercent * 100).toFixed(2)}% - stealth mint detected`,
          recommendation: 'exit_immediately'
        };
      }

    } catch (error: any) {
      logger.debug('Error checking contract changes', {
        token: position.tokenAddress.slice(0, 8),
        error: error.message
      });
    }

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
      // Fetch actual holder count from on-chain
      const currentHolderCount = await this.getHolderCount(position.tokenAddress);

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
   * Get current holder count for a token
   */
  private async getHolderCount(tokenAddress: string): Promise<number> {
    try {
      const mintPubkey = new PublicKey(tokenAddress);

      // Get all token accounts for this mint
      const tokenAccounts = await rateLimitedRPC(
        () => this.connection.getProgramAccounts(
          TOKEN_PROGRAM_ID,
          {
            filters: [
              { dataSize: 165 }, // Token account size
              {
                memcmp: {
                  offset: 0, // Mint is at offset 0
                  bytes: mintPubkey.toBase58()
                }
              }
            ]
          }
        ),
        5 // medium-high priority - danger monitoring is important
      );

      // Count accounts with non-zero balance
      let holderCount = 0;
      for (const account of tokenAccounts) {
        // Balance is at offset 64, 8 bytes little-endian
        const balance = account.account.data.readBigUInt64LE(64);
        if (balance > 0n) {
          holderCount++;
        }
      }

      return holderCount;
    } catch (error: any) {
      logger.debug('Error fetching holder count', { error: error.message });
      // Return a safe fallback to avoid false triggers
      const data = this.monitoringData.get(tokenAddress);
      return data?.initialHolderCount || 0;
    }
  }

  /**
   * Check for smart wallet exits
   */
  private async checkSmartWalletExits(position: PositionData): Promise<DangerSignal> {
    try {
      if (position.smartWalletsInPosition.length === 0) {
        return { isDangerous: false, severity: 'warning', recommendation: 'monitor' };
      }

      const totalTracked = position.smartWalletsInPosition.length;
      let stillHolding = 0;
      const exitedWallets: string[] = [];

      // Check each smart wallet's current balance
      for (const walletAddress of position.smartWalletsInPosition) {
        try {
          const balance = await this.getWalletTokenBalance(walletAddress, position.tokenAddress);

          if (balance > 0) {
            stillHolding++;
          } else {
            exitedWallets.push(walletAddress.slice(0, 8));
          }
        } catch (error: any) {
          // If we can't check, assume still holding to avoid false triggers
          stillHolding++;
        }
      }

      const exitPercent = (totalTracked - stillHolding) / totalTracked;

      if (exitPercent >= this.SMART_WALLET_EXIT_THRESHOLD) {
        logger.error('🚨 Smart wallets exiting position', {
          token: position.tokenAddress.slice(0, 8),
          symbol: position.tokenSymbol,
          exited: (exitPercent * 100).toFixed(0) + '%',
          exitedWallets,
          stillHolding,
          total: totalTracked
        });

        return {
          isDangerous: true,
          signalType: 'smart_wallet_exit',
          severity: 'critical',
          reason: `${(exitPercent * 100).toFixed(0)}% of tracked smart wallets exited (${totalTracked - stillHolding}/${totalTracked})`,
          recommendation: 'exit_immediately'
        };
      }

      // Log if any smart wallets exited but not enough for danger
      if (exitedWallets.length > 0) {
        logger.warn('⚠️ Some smart wallets exited', {
          token: position.tokenAddress.slice(0, 8),
          exitedWallets,
          exitPercent: (exitPercent * 100).toFixed(0) + '%'
        });
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
    const data = this.monitoringData.get(position.tokenAddress);
    if (!data?.devWallet || data.initialDevBalance === undefined) {
      return { isDangerous: false, severity: 'warning', recommendation: 'monitor' };
    }

    try {
      // Get current dev balance
      const currentBalance = await this.getWalletTokenBalance(
        data.devWallet,
        position.tokenAddress
      );

      // Calculate how much dev sold
      const balanceDecrease = data.initialDevBalance - currentBalance;

      if (balanceDecrease <= 0) {
        return { isDangerous: false, severity: 'warning', recommendation: 'monitor' };
      }

      // Get total supply to calculate percentage
      // Skip precise dev sell % calculation for pump.fun tokens (can't get supply from bonding curve)
      if (await this.isPumpFunToken(position.tokenAddress)) {
        return { isDangerous: false, severity: 'warning', recommendation: 'monitor' };
      }

      const mintPubkey = new PublicKey(position.tokenAddress);
      const mintInfo = await rateLimitedRPC(
        () => getMint(this.connection, mintPubkey),
        6
      );
      const totalSupply = Number(mintInfo.supply);

      const sellPercentage = balanceDecrease / totalSupply;

      if (sellPercentage >= this.DEV_SELL_THRESHOLD) {
        logger.error('🚨 Dev wallet selling tokens!', {
          token: position.tokenAddress.slice(0, 8),
          symbol: position.tokenSymbol,
          devWallet: data.devWallet.slice(0, 8),
          sold: (sellPercentage * 100).toFixed(2) + '% of supply',
          initialBalance: data.initialDevBalance,
          currentBalance
        });

        return {
          isDangerous: true,
          signalType: 'dev_sell',
          severity: 'critical',
          reason: `Dev wallet sold ${(sellPercentage * 100).toFixed(2)}% of total supply`,
          recommendation: 'exit_immediately'
        };
      }

      // Warn if dev sold any significant amount
      if (sellPercentage >= 0.005) { // 0.5%
        logger.warn('⚠️ Dev wallet selling (minor)', {
          token: position.tokenAddress.slice(0, 8),
          sold: (sellPercentage * 100).toFixed(2) + '% of supply'
        });
      }

    } catch (error: any) {
      logger.debug('Error checking dev sells', {
        token: position.tokenAddress.slice(0, 8),
        error: error.message
      });
    }

    return { isDangerous: false, severity: 'warning', recommendation: 'monitor' };
  }

  /**
   * Check for whale dumps
   */
  private async checkWhaleDumps(position: PositionData): Promise<DangerSignal> {
    try {
      // Skip whale dump percentage calculation for pump.fun tokens (can't get supply)
      if (await this.isPumpFunToken(position.tokenAddress)) {
        return { isDangerous: false, severity: 'warning', recommendation: 'monitor' };
      }

      const mintPubkey = new PublicKey(position.tokenAddress);

      // Get recent signatures for the token mint
      const signatures = await rateLimitedRPC(
        () => this.connection.getSignaturesForAddress(mintPubkey, { limit: 20 }),
        5
      );

      if (signatures.length === 0) {
        return { isDangerous: false, severity: 'warning', recommendation: 'monitor' };
      }

      // Get token supply for percentage calculation
      const mintInfo = await rateLimitedRPC(
        () => getMint(this.connection, mintPubkey),
        6
      );
      const totalSupply = Number(mintInfo.supply);

      // Check recent transactions for large sells
      for (const sig of signatures.slice(0, 10)) {
        // Only check recent transactions (last 5 minutes)
        if (sig.blockTime && Date.now() / 1000 - sig.blockTime > 300) {
          continue;
        }

        try {
          const tx = await rateLimitedRPC(
            () => this.connection.getParsedTransaction(sig.signature, {
              maxSupportedTransactionVersion: 0
            }),
            4
          );

          if (!tx?.meta?.postTokenBalances || !tx?.meta?.preTokenBalances) {
            continue;
          }

          // Find large token transfers (sells)
          for (let i = 0; i < tx.meta.postTokenBalances.length; i++) {
            const post = tx.meta.postTokenBalances[i];
            const pre = tx.meta.preTokenBalances.find(
              p => p.accountIndex === post.accountIndex
            );

            if (!pre || post.mint !== position.tokenAddress) {
              continue;
            }

            const preAmount = parseInt(pre.uiTokenAmount?.amount || '0');
            const postAmount = parseInt(post.uiTokenAmount?.amount || '0');
            const transferred = preAmount - postAmount;

            // Check if this is a significant sell (>5% of supply)
            const transferPercent = transferred / totalSupply;

            if (transferred > 0 && transferPercent >= this.WHALE_DUMP_THRESHOLD) {
              logger.warn('🐋 Whale dump detected!', {
                token: position.tokenAddress.slice(0, 8),
                symbol: position.tokenSymbol,
                amount: (transferPercent * 100).toFixed(2) + '% of supply',
                txSignature: sig.signature.slice(0, 16)
              });

              return {
                isDangerous: true,
                signalType: 'whale_dump',
                severity: 'warning',
                reason: `Whale dumped ${(transferPercent * 100).toFixed(2)}% of supply in one transaction`,
                recommendation: 'tighten_stop'
              };
            }
          }
        } catch (txError: any) {
          // Skip failed transaction fetches
          continue;
        }
      }

    } catch (error: any) {
      logger.debug('Error checking whale dumps', {
        token: position.tokenAddress.slice(0, 8),
        error: error.message
      });
    }

    return { isDangerous: false, severity: 'warning', recommendation: 'monitor' };
  }

  /**
   * Check for sustained sell pressure
   */
  private async checkSellPressure(position: PositionData, data: PositionMonitoringData): Promise<DangerSignal> {
    try {
      const mintPubkey = new PublicKey(position.tokenAddress);

      // Get recent signatures
      const signatures = await rateLimitedRPC(
        () => this.connection.getSignaturesForAddress(mintPubkey, { limit: 30 }),
        5
      );

      // Filter to last minute only
      const oneMinuteAgo = Date.now() / 1000 - 60;
      const recentSigs = signatures.filter(s => s.blockTime && s.blockTime > oneMinuteAgo);

      if (recentSigs.length < 5) {
        // Not enough activity to determine pressure
        data.sellPressureMinutes = 0;
        return { isDangerous: false, severity: 'warning', recommendation: 'monitor' };
      }

      let buyCount = 0;
      let sellCount = 0;

      // Analyze recent transactions
      for (const sig of recentSigs.slice(0, 15)) {
        try {
          const tx = await rateLimitedRPC(
            () => this.connection.getParsedTransaction(sig.signature, {
              maxSupportedTransactionVersion: 0
            }),
            3
          );

          if (!tx?.meta?.postTokenBalances || !tx?.meta?.preTokenBalances) {
            continue;
          }

          // Look at token balance changes to determine buy vs sell
          for (let i = 0; i < tx.meta.postTokenBalances.length; i++) {
            const post = tx.meta.postTokenBalances[i];
            const pre = tx.meta.preTokenBalances.find(
              p => p.accountIndex === post.accountIndex
            );

            if (!pre || post.mint !== position.tokenAddress) {
              continue;
            }

            const preAmount = parseInt(pre.uiTokenAmount?.amount || '0');
            const postAmount = parseInt(post.uiTokenAmount?.amount || '0');

            if (postAmount > preAmount) {
              buyCount++;
            } else if (preAmount > postAmount) {
              sellCount++;
            }
          }
        } catch (txError: any) {
          continue;
        }
      }

      const totalTrades = buyCount + sellCount;
      if (totalTrades < 3) {
        data.sellPressureMinutes = 0;
        return { isDangerous: false, severity: 'warning', recommendation: 'monitor' };
      }

      const sellRatio = sellCount / totalTrades;

      // Check if > 80% sells
      if (sellRatio >= this.SELL_PRESSURE_THRESHOLD) {
        data.sellPressureMinutes++;

        logger.warn('📉 High sell pressure detected', {
          token: position.tokenAddress.slice(0, 8),
          symbol: position.tokenSymbol,
          sellRatio: (sellRatio * 100).toFixed(0) + '%',
          consecutiveMinutes: data.sellPressureMinutes
        });

        // Check if sustained for 3+ minutes
        if (data.sellPressureMinutes >= this.SELL_PRESSURE_DURATION) {
          logger.error('🚨 Sustained sell pressure - exiting!', {
            token: position.tokenAddress.slice(0, 8),
            symbol: position.tokenSymbol,
            duration: data.sellPressureMinutes + ' minutes'
          });

          return {
            isDangerous: true,
            signalType: 'sell_pressure',
            severity: 'critical',
            reason: `${(sellRatio * 100).toFixed(0)}% sell pressure for ${data.sellPressureMinutes} consecutive minutes`,
            recommendation: 'exit_immediately'
          };
        }
      } else {
        // Reset counter if pressure subsides
        data.sellPressureMinutes = 0;
      }

      data.recentBuyVolume = buyCount;
      data.recentSellVolume = sellCount;
      data.lastVolumeCheck = Date.now();

    } catch (error: any) {
      logger.debug('Error checking sell pressure', {
        token: position.tokenAddress.slice(0, 8),
        error: error.message
      });
    }

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
