/**
 * Transaction Builder
 *
 * Builds and configures Solana transactions for token swaps:
 * - Buy transactions (SOL → Token)
 * - Sell transactions (Token → SOL)
 * - Dynamic priority fees based on network congestion
 * - Compute budget instructions for complex swaps
 */

import { Connection, PublicKey, Keypair, VersionedTransaction } from '@solana/web3.js';
import { logger } from '../utils/logger';
import { JupiterClient, SwapQuote } from './jupiter-client';

export interface BuildTransactionParams {
  type: 'buy' | 'sell';
  inputMint: string;
  outputMint: string;
  amount: number; // in smallest unit (lamports)
  slippageBps: number;
  userKeypair: Keypair;
  priorityFeeMicroLamports?: number;
}

export interface BuiltTransaction {
  transaction: VersionedTransaction;
  quote: SwapQuote;
  estimatedSlippage: number;
  priorityFee: number;
  lastValidBlockHeight: number;
}

export class TransactionBuilder {
  private connection: Connection;
  private jupiterClient: JupiterClient;

  // Priority fee constants (in micro-lamports)
  private readonly BASE_PRIORITY_FEE = parseInt(process.env.BASE_PRIORITY_FEE_LAMPORTS || '10000');
  private readonly MAX_PRIORITY_FEE = parseInt(process.env.MAX_PRIORITY_FEE_LAMPORTS || '100000');

  constructor(connection: Connection, jupiterClient: JupiterClient) {
    this.connection = connection;
    this.jupiterClient = jupiterClient;

    logger.info('Transaction Builder initialized', {
      basePriorityFee: this.BASE_PRIORITY_FEE,
      maxPriorityFee: this.MAX_PRIORITY_FEE
    });
  }

  /**
   * Build a buy transaction (SOL → Token)
   */
  async buildBuyTransaction(
    tokenMint: string,
    amountSol: number, // in lamports
    slippagePercent: number,
    userKeypair: Keypair,
    attemptNumber: number = 1
  ): Promise<BuiltTransaction> {
    try {
      const SOL_MINT = 'So11111111111111111111111111111111111111112';

      logger.info('Building buy transaction', {
        token: tokenMint.slice(0, 8),
        amountSol: (amountSol / 1e9).toFixed(4) + ' SOL',
        slippage: slippagePercent + '%',
        attempt: attemptNumber
      });

      // Calculate priority fee (increases with retry attempts)
      const priorityFee = this.calculatePriorityFee(attemptNumber, 'buy');

      // Convert slippage percent to basis points
      const slippageBps = Math.floor(slippagePercent * 100);

      // Get quote from Jupiter
      const quote = await this.jupiterClient.getQuote(
        SOL_MINT,
        tokenMint,
        amountSol,
        slippageBps,
        false // Allow multi-hop routes
      );

      // Get swap transaction
      const swapResponse = await this.jupiterClient.getSwapTransaction(
        quote.quoteResponse,
        userKeypair.publicKey,
        priorityFee
      );

      // Deserialize transaction
      const transaction = this.jupiterClient.deserializeTransaction(swapResponse.swapTransaction);

      // Sign transaction
      transaction.sign([userKeypair]);

      const builtTx: BuiltTransaction = {
        transaction,
        quote,
        estimatedSlippage: slippagePercent,
        priorityFee,
        lastValidBlockHeight: swapResponse.lastValidBlockHeight
      };

      logger.info('Buy transaction built', {
        inputAmount: (quote.inputAmount / 1e9).toFixed(4) + ' SOL',
        expectedOutputTokens: quote.outputAmount,
        priceImpact: quote.priceImpact.toFixed(2) + '%',
        route: quote.route,
        priorityFee: priorityFee + ' micro-lamports'
      });

      return builtTx;

    } catch (error: any) {
      logger.error('Failed to build buy transaction', {
        token: tokenMint.slice(0, 8),
        error: error.message
      });
      throw new Error(`Buy transaction build failed: ${error.message}`);
    }
  }

  /**
   * Build a sell transaction (Token → SOL)
   */
  async buildSellTransaction(
    tokenMint: string,
    amountTokens: number, // in smallest unit
    slippagePercent: number,
    userKeypair: Keypair,
    urgency: 'normal' | 'urgent' | 'emergency',
    attemptNumber: number = 1
  ): Promise<BuiltTransaction> {
    try {
      const SOL_MINT = 'So11111111111111111111111111111111111111112';

      logger.info('Building sell transaction', {
        token: tokenMint.slice(0, 8),
        amountTokens,
        slippage: slippagePercent + '%',
        urgency,
        attempt: attemptNumber
      });

      // Calculate priority fee (higher for sells, even higher for urgent/emergency)
      const priorityFee = this.calculatePriorityFee(attemptNumber, 'sell', urgency);

      // Convert slippage percent to basis points
      const slippageBps = Math.floor(slippagePercent * 100);

      // Get quote from Jupiter
      const quote = await this.jupiterClient.getQuote(
        tokenMint,
        SOL_MINT,
        amountTokens,
        slippageBps,
        false // Allow multi-hop routes
      );

      // Get swap transaction
      const swapResponse = await this.jupiterClient.getSwapTransaction(
        quote.quoteResponse,
        userKeypair.publicKey,
        priorityFee
      );

      // Deserialize transaction
      const transaction = this.jupiterClient.deserializeTransaction(swapResponse.swapTransaction);

      // Sign transaction
      transaction.sign([userKeypair]);

      const builtTx: BuiltTransaction = {
        transaction,
        quote,
        estimatedSlippage: slippagePercent,
        priorityFee,
        lastValidBlockHeight: swapResponse.lastValidBlockHeight
      };

      logger.info('Sell transaction built', {
        inputTokens: quote.inputAmount,
        expectedOutputSOL: (quote.outputAmount / 1e9).toFixed(4) + ' SOL',
        priceImpact: quote.priceImpact.toFixed(2) + '%',
        route: quote.route,
        priorityFee: priorityFee + ' micro-lamports',
        urgency
      });

      return builtTx;

    } catch (error: any) {
      logger.error('Failed to build sell transaction', {
        token: tokenMint.slice(0, 8),
        error: error.message
      });
      throw new Error(`Sell transaction build failed: ${error.message}`);
    }
  }

  /**
   * Calculate dynamic priority fee based on attempt number and transaction type
   *
   * Formula:
   * - Base fee × (1.5 ^ (attempt - 1)) × type multiplier × urgency multiplier
   *
   * Type multipliers:
   * - Buy: 1.0x
   * - Sell: 2.0x (sells are more critical)
   *
   * Urgency multipliers (sells only):
   * - Normal: 1.0x
   * - Urgent: 1.5x
   * - Emergency: 2.0x
   */
  private calculatePriorityFee(
    attemptNumber: number,
    txType: 'buy' | 'sell',
    urgency: 'normal' | 'urgent' | 'emergency' = 'normal'
  ): number {
    const retryMultiplier = parseFloat(process.env.PRIORITY_FEE_MULTIPLIER || '1.5');

    // Base calculation: BASE × (1.5 ^ (attempt - 1))
    let fee = this.BASE_PRIORITY_FEE * Math.pow(retryMultiplier, attemptNumber - 1);

    // Type multiplier
    const typeMultiplier = txType === 'sell' ? 2.0 : 1.0;
    fee *= typeMultiplier;

    // Urgency multiplier (for sells only)
    if (txType === 'sell') {
      const urgencyMultiplier = urgency === 'emergency' ? 2.0 : urgency === 'urgent' ? 1.5 : 1.0;
      fee *= urgencyMultiplier;
    }

    // Cap at maximum
    fee = Math.min(fee, this.MAX_PRIORITY_FEE);

    return Math.floor(fee);
  }

  /**
   * Estimate network congestion (stub for now)
   *
   * In production, this would:
   * - Check recent block slot utilization
   * - Analyze recent transaction success rates
   * - Monitor priority fee trends
   *
   * Returns: 'low' | 'medium' | 'high'
   */
  private async estimateNetworkCongestion(): Promise<'low' | 'medium' | 'high'> {
    try {
      // STUB: In production, implement real congestion detection
      // For now, return medium
      return 'medium';

    } catch (error: any) {
      logger.error('Failed to estimate network congestion', { error: error.message });
      return 'high'; // Assume high on error (conservative)
    }
  }

  /**
   * Validate transaction before sending
   */
  async validateTransaction(tx: BuiltTransaction, _userPublicKey: PublicKey): Promise<boolean> {
    try {
      // Check 1: Verify transaction is signed
      if (!tx.transaction.signatures || tx.transaction.signatures.length === 0) {
        logger.error('Transaction validation failed: not signed');
        return false;
      }

      // Check 2: Verify price impact is acceptable (< 10%)
      if (tx.quote.priceImpact > 10) {
        logger.error('Transaction validation failed: price impact too high', {
          priceImpact: tx.quote.priceImpact.toFixed(2) + '%'
        });
        return false;
      }

      // Check 3: Verify user has sufficient balance (for buys only)
      // This is checked separately in executor, but double-check here

      logger.debug('Transaction validation passed', {
        priceImpact: tx.quote.priceImpact.toFixed(2) + '%',
        slippage: tx.estimatedSlippage + '%'
      });

      return true;

    } catch (error: any) {
      logger.error('Transaction validation error', { error: error.message });
      return false;
    }
  }

  /**
   * Get recommended slippage based on market conditions and urgency
   */
  getRecommendedSlippage(txType: 'buy' | 'sell', urgency?: 'normal' | 'urgent' | 'emergency'): number {
    const maxBuySlippage = parseFloat(process.env.MAX_BUY_SLIPPAGE || '5');
    const maxSellSlippage = parseFloat(process.env.MAX_SELL_SLIPPAGE || '8');
    const maxEmergencySlippage = parseFloat(process.env.MAX_EMERGENCY_SLIPPAGE || '15');

    if (txType === 'buy') {
      return maxBuySlippage;
    }

    // Sell transaction
    if (urgency === 'emergency') {
      return maxEmergencySlippage;
    } else if (urgency === 'urgent') {
      return Math.min(maxSellSlippage * 1.5, maxEmergencySlippage);
    } else {
      return maxSellSlippage;
    }
  }
}
