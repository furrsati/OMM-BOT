/**
 * Buy Executor
 *
 * Executes buy orders approved by Entry Decision Engine:
 * - Validates wallet balance
 * - Builds and sends buy transactions
 * - Implements retry logic with increasing priority fees
 * - Tracks transaction status until confirmation
 * - Returns execution results for position tracking
 */

import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { logger } from '../utils/logger';
import { TransactionBuilder, BuiltTransaction } from './transaction-builder';
import { AggregatedSignal } from '../conviction/signal-aggregator';
import { EntryDecision } from '../conviction/entry-decision';

export interface BuyExecutionResult {
  success: boolean;
  txSignature?: string;
  tokenAddress: string;
  amountSOL: number;
  tokensReceived?: number;
  entryPrice?: number;
  slippage?: number;
  priorityFee: number;
  attempts: number;
  executionLatencyMs?: number;
  error?: string;
  simulated?: boolean;
}

export class BuyExecutor {
  private connection: Connection;
  private transactionBuilder: TransactionBuilder;
  private walletKeypair?: Keypair;

  private readonly MAX_RETRIES = 2;
  private readonly RETRY_DELAY_MS = 2000;
  private readonly EXECUTION_TIMEOUT_MS = parseInt(process.env.EXECUTION_TIMEOUT_MS || '30000');

  constructor(
    connection: Connection,
    transactionBuilder: TransactionBuilder,
    walletKeypair?: Keypair
  ) {
    this.connection = connection;
    this.transactionBuilder = transactionBuilder;
    this.walletKeypair = walletKeypair;

    logger.info('Buy Executor initialized', {
      maxRetries: this.MAX_RETRIES,
      executionTimeout: this.EXECUTION_TIMEOUT_MS + 'ms'
    });
  }

  /**
   * Execute a buy order
   */
  async executeBuy(
    decision: EntryDecision,
    signal: AggregatedSignal
  ): Promise<BuyExecutionResult> {
    const startTime = Date.now();

    try {
      // Pre-execution validation
      const validationResult = await this.validateBuyExecution(decision, signal);
      if (!validationResult.valid) {
        return this.createFailureResult(
          signal.tokenAddress,
          0,
          0,
          validationResult.reason || 'Validation failed',
          Date.now() - startTime
        );
      }

      if (!this.walletKeypair) {
        throw new Error('Wallet keypair not configured');
      }

      // Calculate position size in SOL
      const walletBalance = validationResult.balance!;
      const positionSizeSOL = Math.floor((walletBalance * decision.positionSizePercent / 100) * 1e9); // Convert to lamports

      logger.info('🛒 Executing BUY order', {
        token: signal.tokenAddress.slice(0, 8),
        conviction: decision.convictionScore.toFixed(1),
        positionSizePercent: decision.positionSizePercent.toFixed(2) + '%',
        positionSizeSOL: (positionSizeSOL / 1e9).toFixed(4) + ' SOL'
      });

      // Get recommended slippage
      const slippage = this.transactionBuilder.getRecommendedSlippage('buy');

      // Try execution with retry logic
      for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
        try {
          logger.info(`Buy attempt ${attempt}/${this.MAX_RETRIES}`, {
            token: signal.tokenAddress.slice(0, 8)
          });

          // Build transaction
          const builtTx = await this.transactionBuilder.buildBuyTransaction(
            signal.tokenAddress,
            positionSizeSOL,
            slippage,
            this.walletKeypair,
            attempt
          );

          // Validate transaction
          const isValid = await this.transactionBuilder.validateTransaction(
            builtTx,
            this.walletKeypair.publicKey
          );

          if (!isValid) {
            if (attempt === this.MAX_RETRIES) {
              return this.createFailureResult(
                signal.tokenAddress,
                positionSizeSOL,
                attempt,
                'Transaction validation failed',
                Date.now() - startTime
              );
            }
            logger.warn('Transaction validation failed, retrying...');
            await this.delay(this.RETRY_DELAY_MS);
            continue;
          }

          // Check for paper trading mode - simulate instead of executing
          if (process.env.PAPER_TRADING_MODE === 'true') {
            const executionLatency = Date.now() - startTime;
            const entryPrice = builtTx.quote.inputAmount / builtTx.quote.outputAmount;

            logger.info('📋 SIMULATED BUY', {
              token: signal.tokenAddress.slice(0, 8),
              amountSOL: (positionSizeSOL / 1e9).toFixed(4),
              expectedTokens: builtTx.quote.outputAmount,
              expectedPrice: entryPrice.toExponential(4),
              priceImpact: builtTx.quote.priceImpact.toFixed(2) + '%',
              conviction: decision.convictionScore.toFixed(1),
              attempts: attempt,
              latencyMs: executionLatency
            });

            return {
              success: true,
              txSignature: `SIMULATED_${Date.now()}_${signal.tokenAddress.slice(0, 8)}`,
              tokenAddress: signal.tokenAddress,
              amountSOL: positionSizeSOL / 1e9,
              tokensReceived: builtTx.quote.outputAmount,
              entryPrice,
              slippage: builtTx.estimatedSlippage,
              priorityFee: builtTx.priorityFee,
              attempts: attempt,
              executionLatencyMs: executionLatency,
              simulated: true
            };
          }

          // Send transaction
          const txSignature = await this.sendTransaction(builtTx);

          // Track transaction status
          const confirmed = await this.trackTransactionStatus(txSignature, builtTx.lastValidBlockHeight);

          if (confirmed) {
            const executionLatency = Date.now() - startTime;

            logger.info('✅ BUY EXECUTED', {
              token: signal.tokenAddress.slice(0, 8),
              txSignature: txSignature.slice(0, 8),
              amountSOL: (positionSizeSOL / 1e9).toFixed(4),
              expectedTokens: builtTx.quote.outputAmount,
              priceImpact: builtTx.quote.priceImpact.toFixed(2) + '%',
              attempts: attempt,
              latencyMs: executionLatency
            });

            // Calculate entry price (SOL per token)
            const entryPrice = builtTx.quote.inputAmount / builtTx.quote.outputAmount;

            return {
              success: true,
              txSignature,
              tokenAddress: signal.tokenAddress,
              amountSOL: positionSizeSOL / 1e9,
              tokensReceived: builtTx.quote.outputAmount,
              entryPrice,
              slippage: builtTx.estimatedSlippage,
              priorityFee: builtTx.priorityFee,
              attempts: attempt,
              executionLatencyMs: executionLatency
            };
          }

          // Transaction failed to confirm, retry
          logger.warn('Transaction not confirmed, retrying...', { attempt });

          if (attempt === this.MAX_RETRIES) {
            return this.createFailureResult(
              signal.tokenAddress,
              positionSizeSOL,
              attempt,
              'Transaction confirmation timeout',
              Date.now() - startTime
            );
          }

          await this.delay(this.RETRY_DELAY_MS);

        } catch (error: any) {
          logger.error(`Buy attempt ${attempt} failed`, {
            token: signal.tokenAddress.slice(0, 8),
            error: error.message
          });

          if (attempt === this.MAX_RETRIES) {
            return this.createFailureResult(
              signal.tokenAddress,
              positionSizeSOL,
              attempt,
              error.message,
              Date.now() - startTime
            );
          }

          await this.delay(this.RETRY_DELAY_MS);
        }
      }

      // Should not reach here, but handle edge case
      return this.createFailureResult(
        signal.tokenAddress,
        positionSizeSOL,
        this.MAX_RETRIES,
        'Max retries exceeded',
        Date.now() - startTime
      );

    } catch (error: any) {
      logger.error('Buy execution failed', {
        token: signal.tokenAddress.slice(0, 8),
        error: error.message
      });

      return this.createFailureResult(
        signal.tokenAddress,
        0,
        0,
        error.message,
        Date.now() - startTime
      );
    }
  }

  /**
   * Validate buy execution preconditions
   */
  private async validateBuyExecution(
    decision: EntryDecision,
    signal: AggregatedSignal
  ): Promise<{ valid: boolean; reason?: string; balance?: number }> {
    try {
      // Check 1: Wallet configured
      if (!this.walletKeypair) {
        return { valid: false, reason: 'Wallet not configured' };
      }

      // Check 2: Trading enabled
      if (process.env.ENABLE_TRADING !== 'true') {
        return { valid: false, reason: 'Trading disabled (ENABLE_TRADING=false)' };
      }

      // Check 3: Decision approved
      if (!decision.approvedForExecution) {
        return { valid: false, reason: 'Trade not approved by decision engine' };
      }

      // Check 4: Wallet balance sufficient
      const balance = await this.connection.getBalance(this.walletKeypair.publicKey);
      const balanceSOL = balance / 1e9;

      if (balanceSOL < 0.01) {
        return { valid: false, reason: 'Insufficient SOL balance (< 0.01 SOL)' };
      }

      const positionSizeSOL = balanceSOL * decision.positionSizePercent / 100;

      if (positionSizeSOL < 0.001) {
        return { valid: false, reason: 'Position size too small (< 0.001 SOL)' };
      }

      // Check 5: Token address valid
      try {
        new PublicKey(signal.tokenAddress);
      } catch {
        return { valid: false, reason: 'Invalid token address' };
      }

      logger.debug('Buy execution validation passed', {
        balanceSOL: balanceSOL.toFixed(4),
        positionSizeSOL: positionSizeSOL.toFixed(4)
      });

      return { valid: true, balance };

    } catch (error: any) {
      logger.error('Buy validation error', { error: error.message });
      return { valid: false, reason: `Validation error: ${error.message}` };
    }
  }

  /**
   * Send transaction to the network
   */
  private async sendTransaction(builtTx: BuiltTransaction): Promise<string> {
    try {
      const signature = await this.connection.sendRawTransaction(
        builtTx.transaction.serialize(),
        {
          skipPreflight: false,
          maxRetries: 0, // We handle retries ourselves
        }
      );

      logger.info('Transaction sent', { signature: signature.slice(0, 8) });

      return signature;

    } catch (error: any) {
      logger.error('Failed to send transaction', { error: error.message });
      throw new Error(`Transaction send failed: ${error.message}`);
    }
  }

  /**
   * Track transaction status until confirmed or timeout
   */
  private async trackTransactionStatus(
    signature: string,
    lastValidBlockHeight: number
  ): Promise<boolean> {
    try {
      logger.debug('Tracking transaction status', {
        signature: signature.slice(0, 8),
        lastValidBlockHeight
      });

      const confirmation = await this.connection.confirmTransaction(
        {
          signature,
          lastValidBlockHeight,
          blockhash: (await this.connection.getLatestBlockhash()).blockhash
        },
        'confirmed'
      );

      if (confirmation.value.err) {
        logger.error('Transaction failed on-chain', {
          signature: signature.slice(0, 8),
          error: confirmation.value.err
        });
        return false;
      }

      logger.info('Transaction confirmed', { signature: signature.slice(0, 8) });
      return true;

    } catch (error: any) {
      logger.error('Transaction tracking error', {
        signature: signature.slice(0, 8),
        error: error.message
      });
      return false;
    }
  }

  /**
   * Create failure result
   */
  private createFailureResult(
    tokenAddress: string,
    amountSOL: number,
    attempts: number,
    error: string,
    latencyMs: number
  ): BuyExecutionResult {
    logger.error('❌ BUY FAILED', {
      token: tokenAddress.slice(0, 8),
      error,
      attempts
    });

    return {
      success: false,
      tokenAddress,
      amountSOL: amountSOL / 1e9,
      priorityFee: 0,
      attempts,
      executionLatencyMs: latencyMs,
      error
    };
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
