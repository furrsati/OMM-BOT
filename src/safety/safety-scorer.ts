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
import { logger } from '../utils/logger';
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
    logger.info(`🛡️  Running safety analysis for ${tokenAddress.slice(0, 8)}...`);

    try {
      // Step 1: Check blacklist first (fastest)
      const blacklistCheck = await this.blacklistManager.isBlacklisted(tokenAddress, true);
      if (blacklistCheck.isBlacklisted) {
        logger.warn(`Token ${tokenAddress.slice(0, 8)}... BLACKLISTED: ${blacklistCheck.reason}`);
        return this.createHardRejectAnalysis(
          tokenAddress,
          'BLACKLISTED',
          blacklistCheck.reason || 'Address is blacklisted'
        );
      }

      // Step 2: Check deployer blacklist if provided
      if (deployerAddress) {
        const deployerCheck = await this.blacklistManager.isBlacklisted(deployerAddress, true);
        if (deployerCheck.isBlacklisted) {
          logger.warn(`Deployer ${deployerAddress.slice(0, 8)}... BLACKLISTED: ${deployerCheck.reason}`);
          return this.createHardRejectAnalysis(
            tokenAddress,
            'BLACKLISTED_DEPLOYER',
            `Deployer is blacklisted: ${deployerCheck.reason}`
          );
        }
      }

      // Step 3: Contract analysis
      const contractAnalysis = await this.contractAnalyzer.analyze(tokenAddress);

      // Hard reject: Mint authority
      if (contractAnalysis.hasMintAuthority) {
        return this.createHardRejectAnalysis(
          tokenAddress,
          'MINT_AUTHORITY',
          'Token has active mint authority'
        );
      }

      // Hard reject: Freeze authority
      if (contractAnalysis.hasFreezeAuthority) {
        return this.createHardRejectAnalysis(
          tokenAddress,
          'FREEZE_AUTHORITY',
          'Token has active freeze authority'
        );
      }

      // Hard reject: Single holder > 30%
      if (contractAnalysis.topHolderPercent > 30) {
        return this.createHardRejectAnalysis(
          tokenAddress,
          'CONCENTRATED_HOLDINGS',
          `Single holder owns ${contractAnalysis.topHolderPercent.toFixed(1)}% (> 30%)`
        );
      }

      // Step 4: Honeypot detection
      const honeypotAnalysis = await this.honeypotDetector.detect(tokenAddress);

      // Hard reject: Honeypot
      if (honeypotAnalysis.isHoneypot) {
        return this.createHardRejectAnalysis(
          tokenAddress,
          'HONEYPOT',
          'Token cannot be sold (honeypot)'
        );
      }

      // Step 5: Calculate overall score
      const overallScore =
        contractAnalysis.authorityScore +
        contractAnalysis.distributionScore +
        honeypotAnalysis.score +
        contractAnalysis.liquidityScore;

      // Determine safety level
      const safetyLevel = this.determineSafetyLevel(overallScore);

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

      logger.info(`✅ Safety analysis complete`, {
        token: tokenAddress.slice(0, 8),
        score: overallScore,
        level: safetyLevel
      });

      return analysis;

    } catch (error: any) {
      logger.error('Error in safety analysis', {
        token: tokenAddress,
        error: error.message
      });

      // Return unsafe on error (fail closed)
      return this.createHardRejectAnalysis(
        tokenAddress,
        'ANALYSIS_ERROR',
        `Safety analysis failed: ${error.message}`
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

    } catch (error: any) {
      logger.debug('Quick safety check failed', { error: error.message });
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

    } catch (error: any) {
      logger.error('Error saving safety analysis', { error: error.message });
    }
  }
}
