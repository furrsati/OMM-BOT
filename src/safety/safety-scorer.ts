/**
 * Safety Scorer
 *
 * Aggregates all safety checks and generates final safety score (0-100):
 * - Contract Analysis: 0-30 points (authorities)
 * - Holder Distribution: 0-25 points (concentration)
 * - Honeypot Detection: 0-25 points (can sell?)
 * - Liquidity Analysis: 0-20 points (locked? depth?)
 *
 * Hard Reject Rules (instant fail, no score):
 * - Honeypot detected (can't sell)
 * - Blacklisted deployer or contract
 * - Mint authority active
 * - Freeze authority active
 * - Single holder > 30%
 * - Pause trading capability
 *
 * Safety Levels:
 * - 85-100: SAFE (green light)
 * - 70-84: CAUTION (proceed with reduced size)
 * - 50-69: RISKY (only if other signals are very strong)
 * - 0-49: UNSAFE (reject)
 */

import { Connection } from '@solana/web3.js';
import { logger, logThinking, logCheckpoint, logStep, logAnalysis, logScoring } from '../utils/logger';
import { getErrorMessage } from '../utils/errors';
import { ContractAnalyzer, ContractAnalysis } from './contract-analyzer';
import { HoneypotDetector, HoneypotAnalysis } from './honeypot-detector';
import { BlacklistManager, BlacklistCheckResult } from './blacklist-manager';

export interface SafetyAnalysis {
  tokenAddress: string;
  overallScore: number; // 0-100
  safetyLevel: 'SAFE' | 'CAUTION' | 'RISKY' | 'UNSAFE';

  // Component scores
  contractScore: number; // 0-30
  distributionScore: number; // 0-25
  honeypotScore: number; // 0-25
  liquidityScore: number; // 0-20

  // Hard reject flags
  isHardRejected: boolean;
  rejectReason: string | null;

  // Detailed analysis
  contractAnalysis: ContractAnalysis | null;
  honeypotAnalysis: HoneypotAnalysis | null;
  blacklistCheck: BlacklistCheckResult | null;

  timestamp: number;
}

export class SafetyScorer {
  private connection: Connection;
  private contractAnalyzer: ContractAnalyzer;
  private honeypotDetector: HoneypotDetector;
  private blacklistManager: BlacklistManager;

  constructor(connection: Connection) {
    this.connection = connection;
    this.contractAnalyzer = new ContractAnalyzer(connection);
    this.honeypotDetector = new HoneypotDetector(connection);
    this.blacklistManager = new BlacklistManager(connection);
  }

  /**
   * Initialize safety scorer
   */
  async initialize(): Promise<void> {
    await this.blacklistManager.initialize();
  }

  /**
   * Perform complete safety analysis
   */
  async analyze(tokenAddress: string, deployerAddress?: string): Promise<SafetyAnalysis> {
    const tokenShort = tokenAddress.slice(0, 8);
    logStep(1, 5, `Starting safety analysis for ${tokenShort}...`);
    logThinking('SAFETY', `Analyzing token ${tokenShort} for honeypots, authorities, and holder concentration`);

    try {
      // Step 1: Check blacklist first (fastest)
      logStep(1, 5, `Checking blacklist database...`);
      const blacklistCheck = await this.blacklistManager.isBlacklisted(tokenAddress, true);
      if (blacklistCheck.isBlacklisted) {
        logCheckpoint('Blacklist Check', 'FAIL', `Token is blacklisted: ${blacklistCheck.reason}`);
        logAnalysis('BLACKLIST', `HARD REJECT - ${blacklistCheck.reason}`, { token: tokenShort });
        return this.createHardRejectAnalysis(
          tokenAddress,
          'BLACKLISTED',
          blacklistCheck.reason || 'Address is blacklisted'
        );
      }
      logCheckpoint('Blacklist Check', 'PASS', 'Token not on blacklist');

      // Step 2: Check deployer blacklist if provided
      if (deployerAddress) {
        logThinking('SAFETY', `Checking deployer ${deployerAddress.slice(0, 8)} against blacklist...`);
        const deployerCheck = await this.blacklistManager.isBlacklisted(deployerAddress, true);
        if (deployerCheck.isBlacklisted) {
          logCheckpoint('Deployer Blacklist', 'FAIL', `Deployer is blacklisted: ${deployerCheck.reason}`);
          logAnalysis('BLACKLIST', `HARD REJECT - Deployer blacklisted`, { deployer: deployerAddress.slice(0, 8) });
          return this.createHardRejectAnalysis(
            tokenAddress,
            'BLACKLISTED_DEPLOYER',
            `Deployer is blacklisted: ${deployerCheck.reason}`
          );
        }
        logCheckpoint('Deployer Blacklist', 'PASS', 'Deployer not on blacklist');
      }

      // Step 3: Contract analysis
      logStep(2, 5, `Analyzing contract authorities and holder distribution...`);
      const contractAnalysis = await this.contractAnalyzer.analyze(tokenAddress);

      // Hard reject: Mint authority
      logThinking('SAFETY', `Checking mint authority...`);
      if (contractAnalysis.hasMintAuthority) {
        logCheckpoint('Mint Authority', 'FAIL', 'Token has active mint authority - devs can print tokens');
        logAnalysis('CONTRACT', `HARD REJECT - Active mint authority`, { token: tokenShort });
        return this.createHardRejectAnalysis(
          tokenAddress,
          'MINT_AUTHORITY',
          'Token has active mint authority'
        );
      }
      logCheckpoint('Mint Authority', 'PASS', 'No mint authority or revoked');

      // Hard reject: Freeze authority
      logThinking('SAFETY', `Checking freeze authority...`);
      if (contractAnalysis.hasFreezeAuthority) {
        logCheckpoint('Freeze Authority', 'FAIL', 'Token has active freeze authority - devs can freeze wallets');
        logAnalysis('CONTRACT', `HARD REJECT - Active freeze authority`, { token: tokenShort });
        return this.createHardRejectAnalysis(
          tokenAddress,
          'FREEZE_AUTHORITY',
          'Token has active freeze authority'
        );
      }
      logCheckpoint('Freeze Authority', 'PASS', 'No freeze authority or revoked');

      // Hard reject: Single holder > 30%
      logThinking('SAFETY', `Checking holder concentration (top holder: ${contractAnalysis.topHolderPercent?.toFixed(1) || 0}%)...`);
      if (contractAnalysis.topHolderPercent > 30) {
        logCheckpoint('Holder Concentration', 'FAIL', `Top holder owns ${contractAnalysis.topHolderPercent.toFixed(1)}% (> 30% limit)`);
        logAnalysis('DISTRIBUTION', `HARD REJECT - Single holder owns ${contractAnalysis.topHolderPercent.toFixed(1)}%`, { token: tokenShort });
        return this.createHardRejectAnalysis(
          tokenAddress,
          'CONCENTRATED_HOLDINGS',
          `Single holder owns ${contractAnalysis.topHolderPercent.toFixed(1)}% (> 30%)`
        );
      }
      logCheckpoint('Holder Concentration', 'PASS', `Top holder owns ${contractAnalysis.topHolderPercent?.toFixed(1) || 0}% (< 30%)`);

      // Step 4: Honeypot detection
      logStep(3, 5, `Running honeypot detection (simulating sell)...`);
      const honeypotAnalysis = await this.honeypotDetector.detect(tokenAddress);

      // Hard reject: Honeypot
      if (honeypotAnalysis.isHoneypot) {
        logCheckpoint('Honeypot Detection', 'FAIL', 'Token cannot be sold - confirmed honeypot');
        logAnalysis('HONEYPOT', `HARD REJECT - Cannot sell token`, { token: tokenShort, error: honeypotAnalysis.simulationError });
        return this.createHardRejectAnalysis(
          tokenAddress,
          'HONEYPOT',
          'Token cannot be sold (honeypot)'
        );
      }
      logCheckpoint('Honeypot Detection', 'PASS', `Sell simulation successful (tax: ${honeypotAnalysis.sellTaxPercent?.toFixed(1) || 0}%)`);

      // Step 5: Calculate overall score
      logStep(4, 5, `Calculating safety scores...`);

      logScoring('Contract/Authority', contractAnalysis.authorityScore, 30,
        `MintAuth: ${contractAnalysis.hasMintAuthority ? 'YES' : 'NO'}, FreezeAuth: ${contractAnalysis.hasFreezeAuthority ? 'YES' : 'NO'}`);

      logScoring('Holder Distribution', contractAnalysis.distributionScore, 25,
        `TopHolder: ${contractAnalysis.topHolderPercent?.toFixed(1) || 0}%, Top10: ${contractAnalysis.top10HolderPercent?.toFixed(1) || 0}%`);

      logScoring('Honeypot Safety', honeypotAnalysis.score, 25,
        `CanSell: YES, SellTax: ${honeypotAnalysis.sellTaxPercent?.toFixed(1) || 0}%, BuyTax: ${honeypotAnalysis.buyTaxPercent?.toFixed(1) || 0}%`);

      logScoring('Liquidity', contractAnalysis.liquidityScore, 20,
        `Depth: ${contractAnalysis.liquidityDepth?.toLocaleString() || 0}, Locked: ${contractAnalysis.liquidityLocked ? 'YES' : 'NO'}`);

      const overallScore =
        contractAnalysis.authorityScore +
        contractAnalysis.distributionScore +
        honeypotAnalysis.score +
        contractAnalysis.liquidityScore;

      // Determine safety level
      const safetyLevel = this.determineSafetyLevel(overallScore);

      logStep(5, 5, `Finalizing safety analysis...`);
      logThinking('SAFETY', `Final safety score: ${overallScore}/100 (${safetyLevel})`, {
        contractScore: contractAnalysis.authorityScore,
        distributionScore: contractAnalysis.distributionScore,
        honeypotScore: honeypotAnalysis.score,
        liquidityScore: contractAnalysis.liquidityScore
      });

      const analysis: SafetyAnalysis = {
        tokenAddress,
        overallScore,
        safetyLevel,
        contractScore: contractAnalysis.authorityScore,
        distributionScore: contractAnalysis.distributionScore,
        honeypotScore: honeypotAnalysis.score,
        liquidityScore: contractAnalysis.liquidityScore,
        isHardRejected: false,
        rejectReason: null,
        contractAnalysis,
        honeypotAnalysis,
        blacklistCheck,
        timestamp: Date.now()
      };

      logAnalysis('COMPLETE', `Safety: ${overallScore}/100 (${safetyLevel})`, {
        token: tokenShort,
        score: overallScore,
        level: safetyLevel,
        hardRejected: false
      });

      return analysis;

    } catch (error: unknown) {
      const errorMsg = getErrorMessage(error);
      logger.error('Error in safety analysis', {
        token: tokenAddress,
        error: errorMsg
      });

      logAnalysis('ERROR', `Safety analysis failed: ${errorMsg}`, { token: tokenShort });

      // Return unsafe on error (fail closed)
      return this.createHardRejectAnalysis(
        tokenAddress,
        'ANALYSIS_ERROR',
        `Safety analysis failed: ${errorMsg}`
      );
    }
  }

  /**
   * Quick safety check (fast, less thorough)
   * Returns true if token passes basic checks
   */
  async quickCheck(tokenAddress: string): Promise<boolean> {
    try {
      // 1. Check blacklist
      const blacklistCheck = await this.blacklistManager.isBlacklisted(tokenAddress, false);
      if (blacklistCheck.isBlacklisted) {
        return false;
      }

      // 2. Quick contract check (authorities only)
      const isSafe = await this.contractAnalyzer.quickSafetyCheck(tokenAddress);
      if (!isSafe) {
        return false;
      }

      // 3. Quick honeypot check
      const canSell = await this.honeypotDetector.quickCheck(tokenAddress);
      if (!canSell) {
        return false;
      }

      return true;

    } catch (error: unknown) {
      const errorMsg = getErrorMessage(error);
      logger.debug('Quick safety check failed', { error: errorMsg });
      return false;
    }
  }

  /**
   * Batch safety check for multiple tokens
   */
  async batchCheck(tokenAddresses: string[]): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();

    const checks = tokenAddresses.map(async (address) => {
      const isSafe = await this.quickCheck(address);
      results.set(address, isSafe);
    });

    await Promise.allSettled(checks);

    return results;
  }

  /**
   * Get blacklist manager instance
   */
  getBlacklistManager(): BlacklistManager {
    return this.blacklistManager;
  }

  /**
   * Create hard reject analysis
   */
  private createHardRejectAnalysis(
    tokenAddress: string,
    rejectCode: string,
    rejectReason: string
  ): SafetyAnalysis {
    return {
      tokenAddress,
      overallScore: 0,
      safetyLevel: 'UNSAFE',
      contractScore: 0,
      distributionScore: 0,
      honeypotScore: 0,
      liquidityScore: 0,
      isHardRejected: true,
      rejectReason: `[${rejectCode}] ${rejectReason}`,
      contractAnalysis: null,
      honeypotAnalysis: null,
      blacklistCheck: null,
      timestamp: Date.now()
    };
  }

  /**
   * Determine safety level from score
   */
  private determineSafetyLevel(score: number): 'SAFE' | 'CAUTION' | 'RISKY' | 'UNSAFE' {
    if (score >= 85) return 'SAFE';
    if (score >= 70) return 'CAUTION';
    if (score >= 50) return 'RISKY';
    return 'UNSAFE';
  }

  /**
   * Save safety analysis to database
   */
  async saveAnalysis(analysis: SafetyAnalysis): Promise<void> {
    try {
      // TODO: Save to database for tracking and learning
      logger.debug('Safety analysis saved (STUB)', {
        token: analysis.tokenAddress.slice(0, 8),
        score: analysis.overallScore
      });

    } catch (error: unknown) {
      const errorMsg = getErrorMessage(error);
      logger.error('Error saving safety analysis', { error: errorMsg });
    }
  }
}
