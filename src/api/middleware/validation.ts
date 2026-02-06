import { Request, Response, NextFunction } from 'express';
import { z, ZodSchema, ZodError } from 'zod';

/**
 * Input Validation Middleware
 *
 * Provides request validation using Zod schemas to prevent
 * invalid input, injection attacks, and type coercion issues.
 */

/**
 * Solana address validation regex
 * Base58 encoded, 32-44 characters
 */
const SOLANA_ADDRESS_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * Common validation schemas
 */
export const schemas = {
  // Solana address validation
  solanaAddress: z.string().regex(SOLANA_ADDRESS_REGEX, 'Invalid Solana address format'),

  // Positive number with optional bounds
  positiveNumber: (min?: number, max?: number) => {
    let schema = z.number().positive('Must be a positive number');
    if (min !== undefined) schema = schema.min(min);
    if (max !== undefined) schema = schema.max(max);
    return schema;
  },

  // Pagination parameters
  pagination: z.object({
    limit: z.coerce.number().int().min(1).max(1000).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  }),

  // Wallet sweep request
  walletSweep: z.object({
    amount: z.number()
      .positive('Amount must be positive')
      .max(1000000, 'Amount too large'),
    destinationAddress: z.string()
      .regex(SOLANA_ADDRESS_REGEX, 'Invalid destination address'),
  }),

  // Smart wallet creation
  smartWalletCreate: z.object({
    address: z.string().regex(SOLANA_ADDRESS_REGEX, 'Invalid wallet address'),
    tier: z.number().int().min(1).max(3).default(3),
    notes: z.string().max(500).optional().nullable(),
  }),

  // Smart wallet update
  smartWalletUpdate: z.object({
    tier: z.number().int().min(1).max(3).optional(),
    notes: z.string().max(500).optional().nullable(),
    isCrowded: z.boolean().optional(),
    isActive: z.boolean().optional(),
  }),

  // Smart wallet bulk import
  smartWalletImport: z.object({
    wallets: z.array(
      z.object({
        address: z.string().regex(SOLANA_ADDRESS_REGEX, 'Invalid wallet address'),
        tier: z.number().int().min(1).max(3).default(2),
        notes: z.string().max(500).optional().nullable(),
        score: z.number().min(0).max(100).optional(),
        winRate: z.number().min(0).max(1).optional(),
      })
    ).min(1, 'At least one wallet required').max(100, 'Maximum 100 wallets per import'),
  }),

  // Blacklist entry creation
  blacklistCreate: z.object({
    address: z.string().regex(SOLANA_ADDRESS_REGEX, 'Invalid address'),
    type: z.enum(['wallet', 'contract', 'deployer']).default('wallet'),
    reason: z.string().min(5, 'Reason too short').max(500, 'Reason too long'),
  }),

  // Token address for safety check
  tokenCheck: z.object({
    tokenAddress: z.string().regex(SOLANA_ADDRESS_REGEX, 'Invalid token address'),
  }),

  // Bot configuration update
  botConfig: z.object({
    paperTradingMode: z.boolean().optional(),
    tradingEnabled: z.boolean().optional(),
  }),

  // Market regime override
  regimeOverride: z.object({
    regime: z.enum(['FULL', 'CAUTIOUS', 'DEFENSIVE', 'PAUSE']),
  }),

  // Settings update - uses partial with strict bounds
  settingsUpdate: z.object({
    // Position Sizing
    maxPositionSize: z.number().min(0.1).max(10).optional(),
    minPositionSize: z.number().min(0.1).max(5).optional(),
    maxOpenPositions: z.number().int().min(1).max(20).optional(),
    maxTotalExposure: z.number().min(1).max(100).optional(),
    maxSingleTradeRisk: z.number().min(0.1).max(5).optional(),

    // Entry Rules
    minConvictionScore: z.number().int().min(0).max(100).optional(),
    minSmartWalletCount: z.number().int().min(1).max(10).optional(),
    maxTokenAge: z.number().min(0.1).max(168).optional(),
    minLiquidityDepth: z.number().min(1000).max(10000000).optional(),
    maxDipEntry: z.number().min(1).max(90).optional(),
    minDipEntry: z.number().min(1).max(90).optional(),

    // Exit Rules
    defaultStopLoss: z.number().min(5).max(50).optional(),
    earlyDiscoveryStopLoss: z.number().min(5).max(50).optional(),
    trailingStopActivation: z.number().min(5).max(100).optional(),
    trailingStopDistance: z.number().min(1).max(50).optional(),
    timeBasedStopHours: z.number().min(0.5).max(24).optional(),

    // Take Profit
    takeProfitLevel1: z.number().min(1).max(500).optional(),
    takeProfitLevel1Percent: z.number().min(1).max(100).optional(),
    takeProfitLevel2: z.number().min(1).max(500).optional(),
    takeProfitLevel2Percent: z.number().min(1).max(100).optional(),
    takeProfitLevel3: z.number().min(1).max(1000).optional(),
    takeProfitLevel3Percent: z.number().min(1).max(100).optional(),
    moonbagPercent: z.number().min(0).max(50).optional(),

    // Daily Limits
    maxDailyLoss: z.number().min(1).max(50).optional(),
    maxDailyProfit: z.number().min(1).max(100).optional(),
    losingStreakPause: z.number().int().min(1).max(20).optional(),
    weeklyCircuitBreaker: z.number().min(1).max(100).optional(),

    // Execution
    maxSlippageBuy: z.number().min(0.1).max(20).optional(),
    maxSlippageSell: z.number().min(0.1).max(30).optional(),
    maxSlippageEmergency: z.number().min(0.1).max(50).optional(),
    maxRetries: z.number().int().min(0).max(10).optional(),
    targetLatencyMs: z.number().int().min(100).max(5000).optional(),

    // Notifications
    telegramEnabled: z.boolean().optional(),
    telegramChatId: z.string().max(50).optional(),
    discordEnabled: z.boolean().optional(),
    discordWebhook: z.string().url().optional().or(z.literal('')),
  }).strict(),

  // ID parameter (UUID or integer)
  idParam: z.object({
    id: z.string().regex(/^[0-9a-f-]+$/i, 'Invalid ID format'),
  }),
};

/**
 * Validation error formatter
 */
function formatZodError(error: ZodError): string {
  return error.errors
    .map((err) => {
      const path = err.path.join('.');
      return path ? `${path}: ${err.message}` : err.message;
    })
    .join('; ');
}

/**
 * Create validation middleware for request body
 */
export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      res.status(400).json({
        success: false,
        error: formatZodError(result.error),
        code: 'VALIDATION_ERROR',
      });
      return;
    }

    // Replace body with validated/transformed data
    req.body = result.data;
    next();
  };
}

/**
 * Create validation middleware for query parameters
 */
export function validateQuery<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);

    if (!result.success) {
      res.status(400).json({
        success: false,
        error: formatZodError(result.error),
        code: 'VALIDATION_ERROR',
      });
      return;
    }

    // Replace query with validated/transformed data
    req.query = result.data as any;
    next();
  };
}

/**
 * Create validation middleware for route parameters
 */
export function validateParams<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.params);

    if (!result.success) {
      res.status(400).json({
        success: false,
        error: formatZodError(result.error),
        code: 'VALIDATION_ERROR',
      });
      return;
    }

    // Replace params with validated data
    req.params = result.data as any;
    next();
  };
}

/**
 * Sanitize string input - remove potentially dangerous characters
 */
export function sanitizeString(input: string): string {
  return input
    .replace(/[<>]/g, '') // Remove angle brackets (XSS)
    .replace(/[\x00-\x1F\x7F]/g, '') // Remove control characters
    .trim();
}

/**
 * Sanitize object values recursively
 */
export function sanitizeObject<T extends Record<string, any>>(obj: T): T {
  const result: any = {};

  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      result[key] = sanitizeString(value);
    } else if (typeof value === 'object' && value !== null) {
      result[key] = sanitizeObject(value);
    } else {
      result[key] = value;
    }
  }

  return result;
}
