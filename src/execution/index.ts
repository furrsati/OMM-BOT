/**
 * Execution Engine - Barrel Exports
 *
 * Phase 5: Trade execution infrastructure for Solana memecoin bot
 */

export { JupiterClient } from './jupiter-client';
export type {
  JupiterQuoteRequest,
  JupiterQuoteResponse,
  JupiterSwapRequest,
  JupiterSwapResponse,
  SwapQuote
} from './jupiter-client';

export { TransactionBuilder } from './transaction-builder';
export type {
  BuildTransactionParams,
  BuiltTransaction
} from './transaction-builder';

export { BuyExecutor } from './buy-executor';
export type { BuyExecutionResult } from './buy-executor';

export { SellExecutor } from './sell-executor';
export type {
  SellExecutionResult,
  SellReason,
  SellUrgency,
  SellOrder
} from './sell-executor';

export { ExecutionManager } from './execution-manager';
