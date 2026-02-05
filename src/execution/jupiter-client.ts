/**
 * Jupiter Aggregator V6 Client
 *
 * Interfaces with Jupiter Aggregator V6 API to:
 * - Get optimal swap routes (quote)
 * - Retrieve serialized swap transactions
 * - Support both direct and multi-hop swaps
 *
 * Jupiter V6 API Documentation: https://station.jup.ag/docs/apis/swap-api
 */

import axios, { AxiosInstance } from 'axios';
import { PublicKey, VersionedTransaction } from '@solana/web3.js';
import { logger } from '../utils/logger';

export interface JupiterQuoteRequest {
  inputMint: string;
  outputMint: string;
  amount: string; // in smallest unit (lamports for SOL)
  slippageBps: number; // basis points (500 = 5%)
  onlyDirectRoutes?: boolean;
  asLegacyTransaction?: boolean;
}

export interface JupiterQuoteResponse {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  platformFee: null | any;
  priceImpactPct: string;
  routePlan: any[];
  contextSlot?: number;
  timeTaken?: number;
}

export interface JupiterSwapRequest {
  quoteResponse: JupiterQuoteResponse;
  userPublicKey: string;
  wrapAndUnwrapSol?: boolean;
  computeUnitPriceMicroLamports?: number;
  asLegacyTransaction?: boolean;
}

export interface JupiterSwapResponse {
  swapTransaction: string; // base64 encoded transaction
  lastValidBlockHeight: number;
}

export interface SwapQuote {
  inputAmount: number;
  outputAmount: number;
  priceImpact: number;
  slippage: number;
  route: string;
  quoteResponse: JupiterQuoteResponse;
}

export class JupiterClient {
  private client: AxiosInstance;
  private baseUrl: string;
  private quoteCache: Map<string, { quote: SwapQuote; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 5000; // 5 seconds

  constructor() {
    this.baseUrl = process.env.JUPITER_API_URL || 'https://quote-api.jup.ag/v6';

    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    logger.info('Jupiter V6 Client initialized', { baseUrl: this.baseUrl });
  }

  /**
   * Get swap quote from Jupiter
   */
  async getQuote(
    inputMint: string,
    outputMint: string,
    amount: number,
    slippageBps: number = 500,
    onlyDirectRoutes: boolean = false
  ): Promise<SwapQuote> {
    try {
      // Check cache first
      const cacheKey = `${inputMint}-${outputMint}-${amount}-${slippageBps}`;
      const cached = this.quoteCache.get(cacheKey);

      if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
        logger.debug('Using cached Jupiter quote', { cacheKey });
        return cached.quote;
      }

      logger.debug('Fetching Jupiter quote', {
        inputMint: inputMint.slice(0, 8),
        outputMint: outputMint.slice(0, 8),
        amount,
        slippageBps
      });

      const request: JupiterQuoteRequest = {
        inputMint,
        outputMint,
        amount: amount.toString(),
        slippageBps,
        onlyDirectRoutes,
      };

      const response = await this.client.get<JupiterQuoteResponse>('/quote', {
        params: request,
      });

      const quoteData = response.data;

      // Parse quote into our format
      const quote: SwapQuote = {
        inputAmount: parseInt(quoteData.inAmount),
        outputAmount: parseInt(quoteData.outAmount),
        priceImpact: parseFloat(quoteData.priceImpactPct),
        slippage: slippageBps / 100, // Convert bps to percent
        route: this.formatRoute(quoteData.routePlan),
        quoteResponse: quoteData,
      };

      // Cache the quote
      this.quoteCache.set(cacheKey, { quote, timestamp: Date.now() });

      logger.info('Jupiter quote received', {
        inputAmount: quote.inputAmount,
        outputAmount: quote.outputAmount,
        priceImpact: quote.priceImpact.toFixed(2) + '%',
        route: quote.route
      });

      return quote;

    } catch (error: any) {
      logger.error('Failed to get Jupiter quote', {
        error: error.message,
        inputMint: inputMint.slice(0, 8),
        outputMint: outputMint.slice(0, 8),
        response: error.response?.data
      });
      throw new Error(`Jupiter quote failed: ${error.message}`);
    }
  }

  /**
   * Get serialized swap transaction from Jupiter
   */
  async getSwapTransaction(
    quoteResponse: JupiterQuoteResponse,
    userPublicKey: PublicKey,
    priorityFeeMicroLamports?: number
  ): Promise<JupiterSwapResponse> {
    try {
      logger.debug('Fetching Jupiter swap transaction', {
        user: userPublicKey.toString().slice(0, 8),
        priorityFee: priorityFeeMicroLamports
      });

      const request: JupiterSwapRequest = {
        quoteResponse,
        userPublicKey: userPublicKey.toString(),
        wrapAndUnwrapSol: true,
        computeUnitPriceMicroLamports: priorityFeeMicroLamports,
        asLegacyTransaction: false, // Use versioned transactions
      };

      const response = await this.client.post<JupiterSwapResponse>('/swap', request);

      logger.info('Jupiter swap transaction received', {
        lastValidBlockHeight: response.data.lastValidBlockHeight
      });

      return response.data;

    } catch (error: any) {
      logger.error('Failed to get Jupiter swap transaction', {
        error: error.message,
        response: error.response?.data
      });
      throw new Error(`Jupiter swap transaction failed: ${error.message}`);
    }
  }

  /**
   * Deserialize base64 transaction to VersionedTransaction
   */
  deserializeTransaction(base64Transaction: string): VersionedTransaction {
    try {
      const buffer = Buffer.from(base64Transaction, 'base64');
      const transaction = VersionedTransaction.deserialize(buffer);
      return transaction;
    } catch (error: any) {
      logger.error('Failed to deserialize transaction', { error: error.message });
      throw new Error(`Transaction deserialization failed: ${error.message}`);
    }
  }

  /**
   * Get token price from Jupiter (simple price check)
   */
  async getPrice(tokenMint: string, vsTokenMint: string = 'So11111111111111111111111111111111111111112'): Promise<number> {
    try {
      // Use a small amount to get price ratio
      const quote = await this.getQuote(
        vsTokenMint, // Input: SOL
        tokenMint,   // Output: Token
        1_000_000,   // 0.001 SOL
        50           // 0.5% slippage for price check
      );

      // Price = output / input (in lamports)
      const price = quote.outputAmount / quote.inputAmount;

      return price;

    } catch (error: any) {
      logger.error('Failed to get token price from Jupiter', {
        token: tokenMint.slice(0, 8),
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Format route plan for logging
   */
  private formatRoute(routePlan: any[]): string {
    if (!routePlan || routePlan.length === 0) {
      return 'direct';
    }

    const hops = routePlan.map(step => {
      const dex = step.swapInfo?.label || 'unknown';
      return dex;
    });

    return hops.join(' -> ');
  }

  /**
   * Clear quote cache
   */
  clearCache(): void {
    this.quoteCache.clear();
    logger.debug('Jupiter quote cache cleared');
  }

  /**
   * Health check - verify Jupiter API is reachable
   */
  async healthCheck(): Promise<boolean> {
    try {
      const SOL_MINT = 'So11111111111111111111111111111111111111112';
      const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

      // Try to get a simple quote
      await this.getQuote(SOL_MINT, USDC_MINT, 1_000_000, 50);

      logger.info('Jupiter API health check passed');
      return true;

    } catch (error: any) {
      logger.error('Jupiter API health check failed', { error: error.message });
      return false;
    }
  }
}
