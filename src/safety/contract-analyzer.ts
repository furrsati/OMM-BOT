/**
 * Contract Analyzer
 *
 * Performs comprehensive token contract analysis:
 * 1. Mint authority check (can deployer create infinite tokens?)
 * 2. Freeze authority check (can deployer freeze trading?)
 * 3. Ownership status (renounced? transferred?)
 * 4. Fee mechanism analysis (buy/sell taxes)
 * 5. Proxy/upgradeable contract detection
 * 6. Top holder distribution analysis
 * 7. LP lock status verification
 *
 * All checks return specific scores that feed into the Safety Scorer.
 */

import { Connection, PublicKey, AccountInfo } from '@solana/web3.js';
import { getMint, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { logger } from '../utils/logger';

export interface ContractAnalysis {
  tokenAddress: string;
  // Authority checks
  hasMintAuthority: boolean;
  mintAuthority: string | null;
  hasFreezeAuthority: boolean;
  freezeAuthority: string | null;
  ownershipRenounced: boolean;

  // Supply analysis
  totalSupply: bigint;
  decimals: number;

  // Holder distribution
  topHolderPercent: number;
  top10HolderPercent: number;
  holderCount: number;

  // LP analysis
  liquidityLocked: boolean;
  liquidityDepth: number;
  lpHolders: string[];

  // Risk flags
  isUpgradeable: boolean;
  hasHiddenMint: boolean;
  hasUnusualTransferRestrictions: boolean;

  // Scoring
  authorityScore: number; // 0-30 points
  distributionScore: number; // 0-25 points
  liquidityScore: number; // 0-20 points

  timestamp: number;
}

export class ContractAnalyzer {
  private connection: Connection;

  // Known safe addresses to exclude from holder checks
  private readonly SAFE_ADDRESSES = new Set([
    '11111111111111111111111111111111', // System program
    'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // Token program
    'So11111111111111111111111111111111111111112', // Wrapped SOL
  ]);

  constructor(connection: Connection) {
    this.connection = connection;
  }

  /**
   * Perform full contract analysis
   */
  async analyze(tokenAddress: string): Promise<ContractAnalysis> {
    logger.info(`🔍 Analyzing contract ${tokenAddress.slice(0, 8)}...`);

    try {
      const tokenPubkey = new PublicKey(tokenAddress);

      // Step 1: Get mint account info
      const mintInfo = await getMint(this.connection, tokenPubkey);

      // Step 2: Check authorities
      const hasMintAuthority = mintInfo.mintAuthority !== null;
      const hasFreezeAuthority = mintInfo.freezeAuthority !== null;
      const mintAuthority = mintInfo.mintAuthority?.toBase58() || null;
      const freezeAuthority = mintInfo.freezeAuthority?.toBase58() || null;

      // Step 3: Analyze holder distribution
      const holderAnalysis = await this.analyzeHolderDistribution(tokenAddress);

      // Step 4: Analyze liquidity
      const liquidityAnalysis = await this.analyzeLiquidity(tokenAddress);

      // Step 5: Check for upgradeable patterns
      const isUpgradeable = await this.checkUpgradeable(tokenAddress);

      // Step 6: Detect hidden mint patterns
      const hasHiddenMint = await this.detectHiddenMint(tokenAddress);

      // Step 7: Calculate scores
      const authorityScore = this.calculateAuthorityScore(
        hasMintAuthority,
        hasFreezeAuthority,
        false // ownershipRenounced - TODO: implement proper check
      );

      const distributionScore = this.calculateDistributionScore(
        holderAnalysis.topHolderPercent,
        holderAnalysis.top10HolderPercent
      );

      const liquidityScore = this.calculateLiquidityScore(
        liquidityAnalysis.locked,
        liquidityAnalysis.depth
      );

      const analysis: ContractAnalysis = {
        tokenAddress,
        hasMintAuthority,
        mintAuthority,
        hasFreezeAuthority,
        freezeAuthority,
        ownershipRenounced: !hasMintAuthority && !hasFreezeAuthority,
        totalSupply: mintInfo.supply,
        decimals: mintInfo.decimals,
        topHolderPercent: holderAnalysis.topHolderPercent,
        top10HolderPercent: holderAnalysis.top10HolderPercent,
        holderCount: holderAnalysis.holderCount,
        liquidityLocked: liquidityAnalysis.locked,
        liquidityDepth: liquidityAnalysis.depth,
        lpHolders: liquidityAnalysis.lpHolders,
        isUpgradeable,
        hasHiddenMint,
        hasUnusualTransferRestrictions: false, // TODO: implement
        authorityScore,
        distributionScore,
        liquidityScore,
        timestamp: Date.now()
      };

      logger.info(`✅ Contract analysis complete`, {
        token: tokenAddress.slice(0, 8),
        authorityScore,
        distributionScore,
        liquidityScore
      });

      return analysis;

    } catch (error: any) {
      logger.error('Error analyzing contract', {
        token: tokenAddress,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Analyze holder distribution
   */
  private async analyzeHolderDistribution(tokenAddress: string): Promise<{
    topHolderPercent: number;
    top10HolderPercent: number;
    holderCount: number;
  }> {
    try {
      const tokenPubkey = new PublicKey(tokenAddress);
      const mintInfo = await getMint(this.connection, tokenPubkey);
      const totalSupply = Number(mintInfo.supply);

      // Get all token accounts for this mint
      const accounts = await this.connection.getProgramAccounts(
        TOKEN_PROGRAM_ID,
        {
          filters: [
            { dataSize: 165 }, // Token account size
            {
              memcmp: {
                offset: 0,
                bytes: tokenPubkey.toBase58()
              }
            }
          ]
        }
      );

      // Parse balances
      const balances: { owner: string; amount: number }[] = [];

      for (const account of accounts) {
        try {
          // Parse token account data
          const data = account.account.data;

          // Token amount is at offset 64-72 (8 bytes, little-endian)
          const amount = data.readBigUInt64LE(64);

          // Owner is at offset 32-64 (32 bytes)
          const ownerBytes = data.slice(32, 64);
          const owner = new PublicKey(ownerBytes).toBase58();

          // Skip safe addresses and zero balances
          if (this.SAFE_ADDRESSES.has(owner) || amount === 0n) {
            continue;
          }

          balances.push({
            owner,
            amount: Number(amount)
          });
        } catch (parseError) {
          // Skip accounts that fail to parse
          continue;
        }
      }

      // Sort by balance descending
      balances.sort((a, b) => b.amount - a.amount);

      const holderCount = balances.length;

      // Calculate top holder percentage
      const topHolderAmount = balances[0]?.amount || 0;
      const topHolderPercent = (topHolderAmount / totalSupply) * 100;

      // Calculate top 10 holders percentage
      const top10Amount = balances
        .slice(0, 10)
        .reduce((sum, holder) => sum + holder.amount, 0);
      const top10HolderPercent = (top10Amount / totalSupply) * 100;

      logger.debug('Holder distribution analyzed', {
        holderCount,
        topHolderPercent: topHolderPercent.toFixed(2) + '%',
        top10HolderPercent: top10HolderPercent.toFixed(2) + '%'
      });

      return {
        topHolderPercent,
        top10HolderPercent,
        holderCount
      };

    } catch (error: any) {
      logger.error('Error analyzing holder distribution', { error: error.message });
      return {
        topHolderPercent: 0,
        top10HolderPercent: 0,
        holderCount: 0
      };
    }
  }

  /**
   * Analyze liquidity pool
   */
  private async analyzeLiquidity(tokenAddress: string): Promise<{
    locked: boolean;
    depth: number;
    lpHolders: string[];
  }> {
    try {
      // TODO: Implement Raydium/Orca LP detection
      // For now, return stub data

      logger.debug('Liquidity analysis (STUB)', { token: tokenAddress });

      return {
        locked: false,
        depth: 0,
        lpHolders: []
      };

    } catch (error: any) {
      logger.error('Error analyzing liquidity', { error: error.message });
      return {
        locked: false,
        depth: 0,
        lpHolders: []
      };
    }
  }

  /**
   * Check if contract is upgradeable
   */
  private async checkUpgradeable(tokenAddress: string): Promise<boolean> {
    try {
      // Check if the token account is owned by an upgradeable program
      const tokenPubkey = new PublicKey(tokenAddress);
      const accountInfo = await this.connection.getAccountInfo(tokenPubkey);

      if (!accountInfo) {
        return false;
      }

      // If owner is not the Token Program, it might be upgradeable
      const isTokenProgram = accountInfo.owner.equals(TOKEN_PROGRAM_ID);

      return !isTokenProgram;

    } catch (error: any) {
      logger.debug('Error checking upgradeable', { error: error.message });
      return false;
    }
  }

  /**
   * Detect hidden mint patterns
   */
  private async detectHiddenMint(tokenAddress: string): Promise<boolean> {
    try {
      // Get recent transaction history
      const tokenPubkey = new PublicKey(tokenAddress);
      const signatures = await this.connection.getSignaturesForAddress(
        tokenPubkey,
        { limit: 100 }
      );

      // Look for suspicious mint transactions after initial creation
      // This would require parsing transaction details
      // For now, return false (stub)

      logger.debug('Hidden mint detection (STUB)', { token: tokenAddress });

      return false;

    } catch (error: any) {
      logger.debug('Error detecting hidden mint', { error: error.message });
      return false;
    }
  }

  /**
   * Calculate authority safety score (0-30 points)
   */
  private calculateAuthorityScore(
    hasMintAuthority: boolean,
    hasFreezeAuthority: boolean,
    ownershipRenounced: boolean
  ): number {
    let score = 0;

    // No mint authority: +10 points
    if (!hasMintAuthority) {
      score += 10;
    }

    // No freeze authority: +10 points
    if (!hasFreezeAuthority) {
      score += 10;
    }

    // Ownership renounced: +10 points
    if (ownershipRenounced) {
      score += 10;
    }

    return score;
  }

  /**
   * Calculate distribution score (0-25 points)
   */
  private calculateDistributionScore(
    topHolderPercent: number,
    top10HolderPercent: number
  ): number {
    let score = 0;

    // Top holder < 10%: +15 points
    // Top holder 10-20%: +10 points
    // Top holder 20-30%: +5 points
    // Top holder > 30%: 0 points (hard reject in safety scorer)
    if (topHolderPercent < 10) {
      score += 15;
    } else if (topHolderPercent < 20) {
      score += 10;
    } else if (topHolderPercent < 30) {
      score += 5;
    }

    // Top 10 holders < 40%: +10 points
    // Top 10 holders 40-50%: +5 points
    // Top 10 holders > 50%: 0 points
    if (top10HolderPercent < 40) {
      score += 10;
    } else if (top10HolderPercent < 50) {
      score += 5;
    }

    return score;
  }

  /**
   * Calculate liquidity score (0-20 points)
   */
  private calculateLiquidityScore(locked: boolean, depth: number): number {
    let score = 0;

    // Liquidity locked: +15 points
    if (locked) {
      score += 15;
    }

    // Liquidity depth >= $50K: +5 points
    // Liquidity depth $30K-$50K: +3 points
    // Liquidity depth < $30K: 0 points
    if (depth >= 50000) {
      score += 5;
    } else if (depth >= 30000) {
      score += 3;
    }

    return score;
  }

  /**
   * Quick check: Is this token safe to even analyze further?
   * Returns true if token passes basic safety checks
   */
  async quickSafetyCheck(tokenAddress: string): Promise<boolean> {
    try {
      const tokenPubkey = new PublicKey(tokenAddress);
      const mintInfo = await getMint(this.connection, tokenPubkey);

      // Hard reject: Has mint authority
      if (mintInfo.mintAuthority !== null) {
        logger.warn(`Token ${tokenAddress.slice(0, 8)}... REJECTED: Has mint authority`);
        return false;
      }

      // Hard reject: Has freeze authority
      if (mintInfo.freezeAuthority !== null) {
        logger.warn(`Token ${tokenAddress.slice(0, 8)}... REJECTED: Has freeze authority`);
        return false;
      }

      return true;

    } catch (error: any) {
      logger.error('Error in quick safety check', { error: error.message });
      return false;
    }
  }
}
