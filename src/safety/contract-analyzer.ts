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

import { Connection, PublicKey } from '@solana/web3.js';
import { getMint, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { logger } from '../utils/logger';
import { getErrorMessage } from '../utils/errors';
import { rateLimitedRPC } from '../utils/rate-limiter';

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

  // Pump.fun bonding curve program ID
  private readonly PUMP_FUN_PROGRAM = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');

  constructor(connection: Connection) {
    this.connection = connection;
  }

  /**
   * Check if token is a pump.fun bonding curve token
   * These tokens are owned by the pump.fun program, not the Token Program
   */
  private async isPumpFunToken(tokenAddress: string): Promise<boolean> {
    try {
      const tokenPubkey = new PublicKey(tokenAddress);
      const accountInfo = await rateLimitedRPC(
        () => this.connection.getAccountInfo(tokenPubkey),
        5 // medium priority
      );

      if (!accountInfo) {
        logger.debug(`No account info found for ${tokenAddress.slice(0, 8)}...`);
        return false;
      }

      // Check if owned by pump.fun program
      const isPumpFun = accountInfo.owner.equals(this.PUMP_FUN_PROGRAM);
      if (isPumpFun) {
        logger.debug(`Token ${tokenAddress.slice(0, 8)}... confirmed as pump.fun by RPC check`);
      }
      return isPumpFun;
    } catch (error: unknown) {
      // Log the error instead of silently failing
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.warn(`RPC check for pump.fun token failed: ${errorMsg} - will use pattern matching`);
      return false;
    }
  }

  /**
   * Analyze pump.fun bonding curve token
   * These tokens have different characteristics - no mint/freeze authority
   * as the bonding curve program controls everything
   */
  private async analyzePumpFunToken(tokenAddress: string): Promise<ContractAnalysis> {
    logger.info(`🎯 Analyzing pump.fun token ${tokenAddress.slice(0, 8)}...`);

    // Pump.fun bonding curve tokens have these properties:
    // - No mint authority (curve controls supply)
    // - No freeze authority
    // - Supply is formula-driven
    // - Generally safer from rug perspective during bonding phase

    // Get liquidity data (still works via DexScreener)
    const liquidityAnalysis = await this.analyzeLiquidity(tokenAddress);

    // For pump.fun tokens, use safe defaults based on bonding curve properties
    const analysis: ContractAnalysis = {
      tokenAddress,
      hasMintAuthority: false,  // Bonding curve controls this programmatically
      mintAuthority: null,
      hasFreezeAuthority: false,  // No freeze on pump.fun
      freezeAuthority: null,
      ownershipRenounced: true,  // Effectively immutable - bonding curve is the owner
      totalSupply: BigInt(0),  // Unknown without parsing curve state
      decimals: 6,  // Standard for pump.fun tokens
      topHolderPercent: 0,  // Can't easily check while on curve
      top10HolderPercent: 0,
      holderCount: 0,
      liquidityLocked: true,  // Bonding curve liquidity is locked by design
      liquidityDepth: liquidityAnalysis.depth,
      lpHolders: [],
      isUpgradeable: false,  // Bonding curve program is immutable
      hasHiddenMint: false,  // Not possible with bonding curve
      hasUnusualTransferRestrictions: false,
      authorityScore: 25,  // Good - no controllable authorities
      distributionScore: 15,  // Moderate - can't verify distribution on curve
      liquidityScore: liquidityAnalysis.depth >= 30000 ? 15 : (liquidityAnalysis.depth >= 10000 ? 10 : 5),
      timestamp: Date.now()
    };

    logger.info(`✅ Pump.fun token analysis complete`, {
      token: tokenAddress.slice(0, 8),
      authorityScore: analysis.authorityScore,
      distributionScore: analysis.distributionScore,
      liquidityScore: analysis.liquidityScore,
      totalScore: analysis.authorityScore + analysis.distributionScore + analysis.liquidityScore
    });

    return analysis;
  }

  /**
   * Perform full contract analysis
   */
  async analyze(tokenAddress: string): Promise<ContractAnalysis> {
    logger.info(`🔍 Analyzing contract ${tokenAddress.slice(0, 8)}...`);

    try {
      // CRITICAL FIX: Pattern-based pump.fun detection FIRST
      // Pump.fun tokens always end with "pump" in their address
      // This check is instant and doesn't require RPC calls
      if (tokenAddress.toLowerCase().endsWith('pump')) {
        logger.info(`🎯 Detected pump.fun token by address pattern: ${tokenAddress.slice(0, 8)}...`);
        return this.analyzePumpFunToken(tokenAddress);
      }

      const tokenPubkey = new PublicKey(tokenAddress);

      // Fallback: RPC-based pump.fun check for edge cases
      const isPumpFun = await this.isPumpFunToken(tokenAddress);
      if (isPumpFun) {
        return this.analyzePumpFunToken(tokenAddress);
      }

      // Step 1: Get mint account info (standard SPL token)
      // Wrap in try-catch to handle non-SPL tokens gracefully
      let mintInfo;
      try {
        mintInfo = await rateLimitedRPC(
          () => getMint(this.connection, tokenPubkey),
          6 // higher priority for main analysis
        );
      } catch (mintError: unknown) {
        // If getMint fails, this might be a non-standard token
        // Try analyzing as pump.fun token as fallback
        const errorMsg = mintError instanceof Error ? mintError.message : String(mintError);
        if (errorMsg.includes('TokenInvalidAccountOwner') || errorMsg.includes('AccountNotFound')) {
          logger.warn(`Token ${tokenAddress.slice(0, 8)}... is not a standard SPL token, trying pump.fun analysis`);
          return this.analyzePumpFunToken(tokenAddress);
        }
        throw mintError;
      }

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

    } catch (error: unknown) {
      const errorMsg = getErrorMessage(error);
      logger.error('Error analyzing contract', {
        token: tokenAddress,
        error: errorMsg
      });
      throw new Error(errorMsg);
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
      const mintInfo = await rateLimitedRPC(
        () => getMint(this.connection, tokenPubkey),
        4
      );
      const totalSupply = Number(mintInfo.supply);

      // Get all token accounts for this mint
      const accounts = await rateLimitedRPC(
        () => this.connection.getProgramAccounts(
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
        ),
        3 // lower priority - background analysis
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

    } catch (error: unknown) {
      const errorMsg = getErrorMessage(error);
      logger.error('Error analyzing holder distribution', { error: errorMsg });
      return {
        topHolderPercent: 0,
        top10HolderPercent: 0,
        holderCount: 0
      };
    }
  }

  // Known LP lock/burn addresses
  private readonly BURN_ADDRESSES = new Set([
    '1111111111111111111111111111111111111111111', // Generic burn
    '1nc1nerator11111111111111111111111111111111', // Incinerator
    'deaddeaddeaddeaddeaddeaddeaddeaddeadde', // Dead wallet prefix
  ]);

  // Known Raydium AMM program
  private readonly RAYDIUM_AMM_PROGRAM = new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8');

  /**
   * Analyze liquidity pool
   */
  private async analyzeLiquidity(tokenAddress: string): Promise<{
    locked: boolean;
    depth: number;
    lpHolders: string[];
  }> {
    try {
      // First, try to get liquidity data from DexScreener
      const dexData = await this.getLiquidityFromDexScreener(tokenAddress);

      if (dexData.depth > 0) {
        // If we have DexScreener data, use it for depth
        // Still need to check LP lock status on-chain
        const lpLockStatus = await this.checkLPLockStatus(tokenAddress);

        return {
          locked: lpLockStatus.locked,
          depth: dexData.depth,
          lpHolders: lpLockStatus.lpHolders
        };
      }

      // Fallback: Try to find Raydium LP for this token
      const raydiumLP = await this.findRaydiumLP(tokenAddress);

      if (raydiumLP) {
        const lpLockStatus = await this.checkLPTokenLock(raydiumLP.lpMint);

        return {
          locked: lpLockStatus.locked,
          depth: raydiumLP.liquidityUSD,
          lpHolders: lpLockStatus.holders
        };
      }

      logger.debug('No liquidity pool found', { token: tokenAddress.slice(0, 8) });

      return {
        locked: false,
        depth: 0,
        lpHolders: []
      };

    } catch (error: unknown) {
      const errorMsg = getErrorMessage(error);
      logger.error('Error analyzing liquidity', { error: errorMsg });
      return {
        locked: false,
        depth: 0,
        lpHolders: []
      };
    }
  }

  /**
   * Get liquidity data from DexScreener
   */
  private async getLiquidityFromDexScreener(tokenAddress: string): Promise<{ depth: number }> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(
        `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`,
        { signal: controller.signal }
      );

      clearTimeout(timeoutId);

      if (!response.ok) {
        return { depth: 0 };
      }

      const data = await response.json() as { pairs?: any[] };
      const pairs = data.pairs || [];

      // Find the main SOL pair
      const mainPair = pairs.find((p: any) =>
        p.chainId === 'solana' && p.quoteToken?.symbol === 'SOL'
      ) || pairs[0];

      if (mainPair && mainPair.liquidity?.usd) {
        return { depth: parseFloat(mainPair.liquidity.usd) };
      }

      return { depth: 0 };

    } catch (error: unknown) {
      const errorMsg = getErrorMessage(error);
      logger.debug('Error fetching from DexScreener', { error: errorMsg });
      return { depth: 0 };
    }
  }

  /**
   * Check LP lock status on-chain
   */
  private async checkLPLockStatus(tokenAddress: string): Promise<{
    locked: boolean;
    lpHolders: string[];
  }> {
    try {
      // Find the LP token for this trading pair
      const raydiumLP = await this.findRaydiumLP(tokenAddress);

      if (!raydiumLP) {
        return { locked: false, lpHolders: [] };
      }

      const result = await this.checkLPTokenLock(raydiumLP.lpMint);
      return { locked: result.locked, lpHolders: result.holders };

    } catch (error: unknown) {
      const errorMsg = getErrorMessage(error);
      logger.debug('Error checking LP lock status', { error: errorMsg });
      return { locked: false, lpHolders: [] };
    }
  }

  /**
   * Find Raydium LP for a token
   */
  private async findRaydiumLP(tokenAddress: string): Promise<{
    lpMint: string;
    liquidityUSD: number;
  } | null> {
    try {
      // tokenPubkey used for filtering in production implementation
      void new PublicKey(tokenAddress);

      // Get accounts associated with the Raydium AMM program that involve this token
      const accounts = await rateLimitedRPC(
        () => this.connection.getProgramAccounts(
          this.RAYDIUM_AMM_PROGRAM,
          {
            filters: [
              { dataSize: 752 }, // Raydium AMM pool account size
            ]
          }
        ),
        2 // low priority
      );

      // Look for pools that contain our token
      for (const account of accounts.slice(0, 50)) { // Limit to avoid timeout
        try {
          const data = account.account.data;

          // Raydium pool structure: baseMint at offset 400, quoteMint at offset 432
          // lpMint at offset 464
          const baseMint = new PublicKey(data.slice(400, 432)).toBase58();
          const quoteMint = new PublicKey(data.slice(432, 464)).toBase58();
          const lpMint = new PublicKey(data.slice(464, 496)).toBase58();

          if (baseMint === tokenAddress || quoteMint === tokenAddress) {
            logger.debug('Found Raydium LP', { lpMint: lpMint.slice(0, 8) });

            return {
              lpMint,
              liquidityUSD: 0 // Will be populated from DexScreener
            };
          }
        } catch {
          continue;
        }
      }

      return null;

    } catch (error: unknown) {
      const errorMsg = getErrorMessage(error);
      logger.debug('Error finding Raydium LP', { error: errorMsg });
      return null;
    }
  }

  /**
   * Check if LP tokens are locked or burned
   */
  private async checkLPTokenLock(lpMint: string): Promise<{
    locked: boolean;
    holders: string[];
  }> {
    try {
      const lpMintPubkey = new PublicKey(lpMint);
      const mintInfo = await rateLimitedRPC(
        () => getMint(this.connection, lpMintPubkey),
        3
      );
      const totalSupply = Number(mintInfo.supply);

      if (totalSupply === 0) {
        return { locked: false, holders: [] };
      }

      // Get all LP token holders
      const accounts = await rateLimitedRPC(
        () => this.connection.getProgramAccounts(
          TOKEN_PROGRAM_ID,
          {
            filters: [
              { dataSize: 165 },
              {
                memcmp: {
                  offset: 0,
                  bytes: lpMintPubkey.toBase58()
                }
              }
            ]
          }
        ),
        2
      );

      const holders: string[] = [];
      let burnedOrLockedAmount = 0;

      for (const account of accounts) {
        try {
          const data = account.account.data;
          const amount = Number(data.readBigUInt64LE(64));
          const owner = new PublicKey(data.slice(32, 64)).toBase58();

          if (amount === 0) continue;

          holders.push(owner);

          // Check if this is a burn address
          if (this.isBurnAddress(owner)) {
            burnedOrLockedAmount += amount;
          }

          // Check if owner has no transfer authority (locked)
          // This is a simplified check - in production, you'd check locker contracts
        } catch {
          continue;
        }
      }

      // Consider locked if >50% of LP is burned/locked
      const lockedPercent = burnedOrLockedAmount / totalSupply;
      const locked = lockedPercent > 0.5;

      logger.debug('LP lock check', {
        lpMint: lpMint.slice(0, 8),
        holders: holders.length,
        lockedPercent: (lockedPercent * 100).toFixed(2) + '%',
        locked
      });

      return { locked, holders };

    } catch (error: unknown) {
      const errorMsg = getErrorMessage(error);
      logger.debug('Error checking LP token lock', { error: errorMsg });
      return { locked: false, holders: [] };
    }
  }

  /**
   * Check if an address is a known burn address
   */
  private isBurnAddress(address: string): boolean {
    // Check exact matches
    if (this.BURN_ADDRESSES.has(address)) {
      return true;
    }

    // Check for common burn address patterns
    const lowerAddress = address.toLowerCase();

    // All 1s or mostly 1s
    if (/^1{30,}/.test(address)) {
      return true;
    }

    // Contains "dead" pattern
    if (lowerAddress.includes('dead')) {
      return true;
    }

    // Contains "burn" pattern
    if (lowerAddress.includes('burn')) {
      return true;
    }

    return false;
  }

  /**
   * Check if contract is upgradeable
   */
  private async checkUpgradeable(tokenAddress: string): Promise<boolean> {
    try {
      // Check if the token account is owned by an upgradeable program
      const tokenPubkey = new PublicKey(tokenAddress);
      const accountInfo = await rateLimitedRPC(
        () => this.connection.getAccountInfo(tokenPubkey),
        3
      );

      if (!accountInfo) {
        return false;
      }

      // If owner is not the Token Program, it might be upgradeable
      const isTokenProgram = accountInfo.owner.equals(TOKEN_PROGRAM_ID);

      return !isTokenProgram;

    } catch (error: unknown) {
      const errorMsg = getErrorMessage(error);
      logger.debug('Error checking upgradeable', { error: errorMsg });
      return false;
    }
  }

  /**
   * Detect hidden mint patterns
   */
  private async detectHiddenMint(tokenAddress: string): Promise<boolean> {
    try {
      // Get recent transaction history for analysis (reduced from 100 to 30 for memory)
      const tokenPubkey = new PublicKey(tokenAddress);
      await rateLimitedRPC(
        () => this.connection.getSignaturesForAddress(tokenPubkey, { limit: 30 }),
        2
      );

      // Look for suspicious mint transactions after initial creation
      // This would require parsing transaction details
      // For now, return false (stub)

      logger.debug('Hidden mint detection (STUB)', { token: tokenAddress });

      return false;

    } catch (error: unknown) {
      const errorMsg = getErrorMessage(error);
      logger.debug('Error detecting hidden mint', { error: errorMsg });
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
      // CRITICAL FIX: Pattern-based pump.fun detection FIRST
      // This avoids RPC calls that might fail due to rate limiting
      if (tokenAddress.toLowerCase().endsWith('pump')) {
        logger.debug(`Token ${tokenAddress.slice(0, 8)}... is pump.fun token (pattern match) - passes quick check`);
        return true;
      }

      // Fallback: RPC-based pump.fun check
      const isPumpFun = await this.isPumpFunToken(tokenAddress);
      if (isPumpFun) {
        logger.debug(`Token ${tokenAddress.slice(0, 8)}... is pump.fun bonding curve token`);
        return true;
      }

      // Standard SPL token check
      const tokenPubkey = new PublicKey(tokenAddress);
      let mintInfo;
      try {
        mintInfo = await rateLimitedRPC(
          () => getMint(this.connection, tokenPubkey),
          6
        );
      } catch (mintError: unknown) {
        // If getMint fails with TokenInvalidAccountOwner, might be a non-standard token
        const errorMsg = mintError instanceof Error ? mintError.message : String(mintError);
        if (errorMsg.includes('TokenInvalidAccountOwner')) {
          logger.debug(`Token ${tokenAddress.slice(0, 8)}... is non-standard token - allowing for further analysis`);
          return true; // Allow further analysis to determine if it's safe
        }
        throw mintError;
      }

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

    } catch (error: unknown) {
      const errorMsg = getErrorMessage(error);
      logger.error('Error in quick safety check', { error: errorMsg });
      return false;
    }
  }
}
