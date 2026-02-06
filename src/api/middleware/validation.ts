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

  // Settings update - category-based structure matching claude.md V3.0
  settingsUpdate: z.object({
    // Category 6: Position Sizing
    position_sizing: z.object({
      highConvictionSize: z.number().min(1).max(10).optional(),
      mediumConvictionSize: z.number().min(0.5).max(5).optional(),
      lowConvictionSize: z.number().min(0.1).max(3).optional(),
      maxOpenPositions: z.number().int().min(1).max(10).optional(),
      maxTotalExposure: z.number().min(5).max(50).optional(),
      maxSingleTradeRisk: z.number().min(0.5).max(5).optional(),
    }).partial().optional(),

    // Category 5: Entry Rules
    entry_rules: z.object({
      highConvictionThreshold: z.number().int().min(70).max(100).optional(),
      mediumConvictionThreshold: z.number().int().min(50).max(90).optional(),
      lowConvictionThreshold: z.number().int().min(30).max(70).optional(),
      minSmartWalletCountTier1: z.number().int().min(1).max(10).optional(),
      minSmartWalletCountEarly: z.number().int().min(1).max(5).optional(),
      minLiquidityDepth: z.number().min(1000).max(1000000).optional(),
      preferredLiquidityDepth: z.number().min(10000).max(5000000).optional(),
      minDipEntry: z.number().min(5).max(50).optional(),
      maxDipEntry: z.number().min(10).max(60).optional(),
      maxTokenAgeMinutes: z.number().min(1).max(60).optional(),
      tokenAgeBonus: z.number().min(10).max(240).optional(),
    }).partial().optional(),

    // Category 9: Exit Rules
    exit_rules: z.object({
      defaultStopLoss: z.number().min(12).max(35).optional(),
      earlyDiscoveryStopLoss: z.number().min(5).max(25).optional(),
      trailingStopActivation: z.number().min(10).max(50).optional(),
      trailingStop20to50: z.number().min(5).max(25).optional(),
      trailingStop50to100: z.number().min(5).max(20).optional(),
      trailingStop100plus: z.number().min(3).max(15).optional(),
      timeBasedStopHours: z.number().min(2).max(8).optional(),
      timeBasedStopMinPnL: z.number().min(-20).max(0).optional(),
      timeBasedStopMaxPnL: z.number().min(0).max(30).optional(),
    }).partial().optional(),

    // Category 10: Take Profit (Standard)
    take_profit: z.object({
      level1: z.number().min(10).max(100).optional(),
      level1Percent: z.number().min(5).max(50).optional(),
      level2: z.number().min(20).max(150).optional(),
      level2Percent: z.number().min(5).max(50).optional(),
      level3: z.number().min(50).max(300).optional(),
      level3Percent: z.number().min(5).max(50).optional(),
      level4: z.number().min(100).max(500).optional(),
      level4Percent: z.number().min(5).max(50).optional(),
      moonbagPercent: z.number().min(5).max(50).optional(),
    }).partial().optional(),

    // Category 10: Take Profit (Early Discovery)
    take_profit_early: z.object({
      level1: z.number().min(20).max(150).optional(),
      level1Percent: z.number().min(5).max(50).optional(),
      level2: z.number().min(50).max(300).optional(),
      level2Percent: z.number().min(5).max(50).optional(),
      level3: z.number().min(100).max(500).optional(),
      level3Percent: z.number().min(5).max(50).optional(),
      moonbagPercent: z.number().min(5).max(50).optional(),
    }).partial().optional(),

    // Category 11: Daily Limits
    daily_limits: z.object({
      maxDailyLoss: z.number().min(1).max(20).optional(),
      maxDailyProfit: z.number().min(5).max(50).optional(),
      losingStreakPause: z.number().int().min(2).max(10).optional(),
      losingStreakPauseHours: z.number().min(1).max(24).optional(),
      weeklyCircuitBreaker: z.number().min(5).max(30).optional(),
      weeklyCircuitBreakerHours: z.number().min(12).max(168).optional(),
      losingStreak2Reduction: z.number().min(10).max(50).optional(),
      losingStreak3Reduction: z.number().min(25).max(75).optional(),
    }).partial().optional(),

    // Category 7: Execution
    execution: z.object({
      maxSlippageBuy: z.number().min(1).max(10).optional(),
      maxSlippageSell: z.number().min(1).max(15).optional(),
      maxSlippageEmergency: z.number().min(5).max(25).optional(),
      maxRetries: z.number().int().min(1).max(5).optional(),
      retryPriorityFeeMultiplier: z.number().min(1).max(3).optional(),
      targetLatencyMs: z.number().int().min(100).max(2000).optional(),
    }).partial().optional(),

    // Category 3: Market Conditions
    market_conditions: z.object({
      solCautionThreshold: z.number().min(1).max(10).optional(),
      solDefensiveThreshold: z.number().min(3).max(15).optional(),
      solPauseThreshold: z.number().min(10).max(25).optional(),
      btcCautionThreshold: z.number().min(2).max(10).optional(),
      btcDefensiveThreshold: z.number().min(5).max(20).optional(),
      offPeakConvictionBoost: z.number().min(0).max(20).optional(),
      peakHoursStart: z.number().int().min(0).max(23).optional(),
      peakHoursEnd: z.number().int().min(0).max(23).optional(),
    }).partial().optional(),

    // Learning Engine Weights
    learning_weights: z.object({
      smartWallet: z.number().min(5).max(40).optional(),
      tokenSafety: z.number().min(5).max(40).optional(),
      marketConditions: z.number().min(5).max(40).optional(),
      socialSignals: z.number().min(5).max(40).optional(),
      entryQuality: z.number().min(5).max(40).optional(),
      minWeight: z.number().min(1).max(10).optional(),
      maxWeight: z.number().min(30).max(50).optional(),
      maxAdjustmentPerCycle: z.number().min(1).max(10).optional(),
    }).partial().optional(),

    // Notifications
    notifications: z.object({
      telegramEnabled: z.boolean().optional(),
      telegramChatId: z.string().max(50).optional(),
      discordEnabled: z.boolean().optional(),
      discordWebhook: z.string().url().optional().or(z.literal('')),
    }).partial().optional(),
  }).partial(),

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
