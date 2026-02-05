/**
 * Sell Executor
 *
 * Executes sell orders for take-profit, stop-loss, or emergency exits:
 * - Takes priority over buy orders (capital protection first)
 * - Adjusts slippage and priority fees based on urgency
 * - Implements aggressive retry logic for critical exits
 * - Tracks transaction status until confirmation
 * - Returns execution results for position management
 */

import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { logger } from '../utils/logger';
import { TransactionBuilder, BuiltTransaction } from './transaction-builder';
import { Position } from '../types';

export interface SellExecutionResult {
  success: boolean;
  txSignature?: string;
  tokenAddress: string;
  tokensSold: number;
  solReceived?: number;
  exitPrice?: number;
  slippage?: number;
  priorityFee: number;
  attempts: number;
  reason: string;
  executionLatencyMs?: number;
  error?: string;
}

export type SellReason = 'take_profit' | 'stop_loss' | 'trailing_stop' | 'time_stop' | 'danger_signal' | 'manual';
export type SellUrgency = 'normal' | 'urgent' | 'emergency';

export interface SellOrder {
  position: Position;
  reason: SellReason;
  percentToSell: number; // 0-100
  urgency: SellUrgency;
}

export class SellExecutor {
  private connection: Connection;
  private transactionBuilder: TransactionBuilder;
  private walletKeypair?: Keypair;

  private readonly MAX_RETRIES = 2;
  private readonly RETRY_DELAY_MS = 1500; // Faster retries for sells (1.5s vs 2s for buys)
  private readonly EXECUTION_TIMEOUT_MS = parseInt(process.env.EXECUTION_TIMEOUT_MS || '30000');

  constructor(
    connection: Connection,
    transactionBuilder: TransactionBuilder,
    walletKeypair?: Keypair
  ) {
    this.connection = connection;
    this.transactionBuilder = transactionBuilder;
    this.walletKeypair = walletKeypair;

    logger.info('Sell Executor initialized', {
      maxRetries: this.MAX_RETRIES,
      executionTimeout: this.EXECUTION_TIMEOUT_MS + 'ms'
    });
  }

  /**
   * Execute a sell order
   */
  async executeSell(sellOrder: SellOrder): Promise<SellExecutionResult> {
    const startTime = Date.now();
    const { position, reason, percentToSell, urgency } = sellOrder;

    try {
      // Pre-execution validation
      const validationResult = await this.validateSellExecution(sellOrder);
      if (!validationResult.valid) {
        return this.createFailureResult(
          position.tokenAddress,
          0,
          0,
          reason,
          validationResult.reason || 'Validation failed',
          Date.now() - startTime
        );
      }

      if (!this.walletKeypair) {
        throw new Error('Wallet keypair not configured');
      }

      // Calculate tokens to sell
      const tokensToSell = Math.floor(position.amount * percentToSell / 100);

      logger.info(`💸 Executing SELL order`, {
        token: position.tokenAddress.slice(0, 8),
        reason,
        urgency,
        percentToSell: percentToSell.toFixed(1) + '%',
        tokensToSell
      });

      // Get slippage based on urgency
      const slippage = this.transactionBuilder.getRecommendedSlippage('sell', urgency);

      // Try execution with retry logic
      for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
        try {
          logger.info(`Sell attempt ${attempt}/${this.MAX_RETRIES}`, {
            token: position.tokenAddress.slice(0, 8),
            urgency
          });

          // Build transaction
          const builtTx = await this.transactionBuilder.buildSellTransaction(
            position.tokenAddress,
            tokensToSell,
            slippage,
            this.walletKeypair,
            urgency,
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
                position.tokenAddress,
                tokensToSell,
                attempt,
                reason,
                'Transaction validation failed',
                Date.now() - startTime
              );
            }
            logger.warn('Transaction validation failed, retrying...');
            await this.delay(this.RETRY_DELAY_MS);
            continue;
          }

          // Send transaction
          const txSignature = await this.sendTransaction(builtTx);

          // Track transaction status
          const confirmed = await this.trackTransactionStatus(txSignature, builtTx.lastValidBlockHeight);

          if (confirmed) {
            const executionLatency = Date.now() - startTime;

            logger.info('✅ SELL EXECUTED', {
              token: position.tokenAddress.slice(0, 8),
              txSignature: txSignature.slice(0, 8),
              tokensSold: tokensToSell,
              expectedSOL: (builtTx.quote.outputAmount / 1e9).toFixed(4),
              reason,
              urgency,
              priceImpact: builtTx.quote.priceImpact.toFixed(2) + '%',
              attempts: attempt,
              latencyMs: executionLatency
            });

            // Calculate exit price (SOL per token)
            const exitPrice = builtTx.quote.outputAmount / builtTx.quote.inputAmount;

            return {
              success: true,
              txSignature,
              tokenAddress: position.tokenAddress,
              tokensSold: tokensToSell,
              solReceived: builtTx.quote.outputAmount / 1e9,
              exitPrice,
              slippage: builtTx.estimatedSlippage,
              priorityFee: builtTx.priorityFee,
              attempts: attempt,
              reason,
              executionLatencyMs: executionLatency
            };
          }

          // Transaction failed to confirm, retry
          logger.warn('Transaction not confirmed, retrying...', { attempt, urgency });

          if (attempt === this.MAX_RETRIES) {
            return this.createFailureResult(
              position.tokenAddress,
              tokensToSell,
              attempt,
              reason,
              'Transaction confirmation timeout',
              Date.now() - startTime
            );
          }

          await this.delay(this.RETRY_DELAY_MS);

        } catch (error: any) {
          logger.error(`Sell attempt ${attempt} failed`, {
            token: position.tokenAddress.slice(0, 8),
            error: error.message,
            urgency
          });

          if (attempt === this.MAX_RETRIES) {
            return this.createFailureResult(
              position.tokenAddress,
              tokensToSell,
              attempt,
              reason,
              error.message,
              Date.now() - startTime
            );
          }

          await this.delay(this.RETRY_DELAY_MS);
        }
      }

      // Should not reach here, but handle edge case
      return this.createFailureResult(
        position.tokenAddress,
        tokensToSell,
        this.MAX_RETRIES,
        reason,
        'Max retries exceeded',
        Date.now() - startTime
      );

    } catch (error: any) {
      logger.error('Sell execution failed', {
        token: position.tokenAddress.slice(0, 8),
        error: error.message
      });

      return this.createFailureResult(
        position.tokenAddress,
        0,
        0,
        reason,
        error.message,
        Date.now() - startTime
      );
    }
  }

  /**
   * Validate sell execution preconditions
   */
  private async validateSellExecution(sellOrder: SellOrder): Promise<{ valid: boolean; reason?: string }> {
    try {
      const { position, percentToSell } = sellOrder;

      // Check 1: Wallet configured
      if (!this.walletKeypair) {
        return { valid: false, reason: 'Wallet not configured' };
      }

      // Check 2: Trading enabled (even for emergency exits, we need wallet access)
      if (process.env.ENABLE_TRADING !== 'true') {
        return { valid: false, reason: 'Trading disabled (ENABLE_TRADING=false)' };
      }

      // Check 3: Valid percent to sell
      if (percentToSell <= 0 || percentToSell > 100) {
        return { valid: false, reason: 'Invalid percentToSell (must be 1-100)' };
      }

      // Check 4: Position has tokens to sell
      if (position.amount <= 0) {
        return { valid: false, reason: 'Position has no tokens to sell' };
      }

      // Check 5: Token address valid
      try {
        new PublicKey(position.tokenAddress);
      } catch {
        return { valid: false, reason: 'Invalid token address' };
      }

      const tokensToSell = Math.floor(position.amount * percentToSell / 100);

      if (tokensToSell <= 0) {
        return { valid: false, reason: 'Calculated tokens to sell is zero' };
      }

      logger.debug('Sell execution validation passed', {
        token: position.tokenAddress.slice(0, 8),
        tokensToSell,
        percentToSell: percentToSell.toFixed(1) + '%'
      });

      return { valid: true };

    } catch (error: any) {
      logger.error('Sell validation error', { error: error.message });
      return { valid: false, reason: `Validation error: ${error.message}` };
    }
  }

  /**
   * Send transaction to the network (higher priority than buys)
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

      logger.info('Sell transaction sent', { signature: signature.slice(0, 8) });

      return signature;

    } catch (error: any) {
      logger.error('Failed to send sell transaction', { error: error.message });
      throw new Error(`Sell transaction send failed: ${error.message}`);
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
      logger.debug('Tracking sell transaction status', {
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
        logger.error('Sell transaction failed on-chain', {
          signature: signature.slice(0, 8),
          error: confirmation.value.err
        });
        return false;
      }

      logger.info('Sell transaction confirmed', { signature: signature.slice(0, 8) });
      return true;

    } catch (error: any) {
      logger.error('Sell transaction tracking error', {
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
    tokensSold: number,
    attempts: number,
    reason: string,
    error: string,
    latencyMs: number
  ): SellExecutionResult {
    logger.error('❌ SELL FAILED', {
      token: tokenAddress.slice(0, 8),
      reason,
      error,
      attempts
    });

    return {
      success: false,
      tokenAddress,
      tokensSold,
      priorityFee: 0,
      attempts,
      reason,
      executionLatencyMs: latencyMs,
      error
    };
  }

  /**
   * Delay helper (shorter for sells - more aggressive)
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Map sell reason to urgency (helper for external callers)
   */
  static getUrgencyFromReason(reason: SellReason): SellUrgency {
    switch (reason) {
      case 'danger_signal':
        return 'emergency';
      case 'stop_loss':
        return 'urgent';
      case 'trailing_stop':
        return 'urgent';
      case 'time_stop':
        return 'normal';
      case 'take_profit':
        return 'normal';
      case 'manual':
        return 'normal';
      default:
        return 'normal';
    }
  }
}
