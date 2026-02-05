// Core Types for Solana Memecoin Trading Bot

export interface SmartWallet {
  address: string;
  tier: 1 | 2 | 3;
  score: number;
  winRate: number;
  averageReturn: number;
  tokensEntered: number;
  lastActive: Date;
  metrics: {
    totalTrades: number;
    successfulTrades: number;
    averageHoldTime: number;
  };
}

export interface Token {
  contractAddress: string;
  deployer: string;
  name?: string;
  symbol?: string;
  decimals: number;
  totalSupply: bigint;
  metadata: {
    twitter?: string;
    telegram?: string;
    website?: string;
  };
  safetyScore: number;
  liquidityDepth: number;
  holderCount: number;
  createdAt: Date;
}

export interface Trade {
  id: string;
  tokenAddress: string;
  entryPrice: number;
  entryAmount: number;
  entryTime: Date;
  exitPrice?: number;
  exitAmount?: number;
  exitTime?: Date;
  exitReason?: 'take_profit' | 'stop_loss' | 'trailing_stop' | 'time_stop' | 'danger_signal' | 'manual';
  profitLoss?: number;
  profitLossPercent?: number;
  convictionScore: number;
  fingerprint: TradeFingerprint;
  outcome?: 'WIN' | 'LOSS' | 'BREAKEVEN' | 'EMERGENCY' | 'RUG';
}

export interface TradeFingerprint {
  smartWallets: {
    count: number;
    tiers: number[];
    addresses: string[];
  };
  tokenSafety: {
    overallScore: number;
    liquidityLocked: boolean;
    liquidityDepth: number;
    honeypotRisk: boolean;
    mintAuthority: boolean;
    freezeAuthority: boolean;
  };
  marketConditions: {
    solPrice: number;
    solTrend: 'up' | 'stable' | 'down';
    btcTrend: 'up' | 'stable' | 'down';
    regime: MarketRegime;
    timeOfDay: number;
    dayOfWeek: number;
  };
  socialSignals: {
    twitterFollowers: number;
    telegramMembers: number;
    mentionVelocity: number;
  };
  entryQuality: {
    dipDepth: number;
    distanceFromATH: number;
    tokenAge: number;
    buySellRatio: number;
    hypePhase: HypePhase;
  };
}

export type MarketRegime = 'FULL' | 'CAUTIOUS' | 'DEFENSIVE' | 'PAUSE';

export type HypePhase = 'DISCOVERY' | 'EARLY_FOMO' | 'PEAK_FOMO' | 'DISTRIBUTION' | 'DUMP';

export interface Position {
  tokenAddress: string;
  entryPrice: number;
  currentPrice: number;
  amount: number;
  entryTime: Date;
  profitLoss: number;
  profitLossPercent: number;
  stops: {
    hard: number;
    trailing?: number;
    timeBased?: Date;
  };
  takeProfitLevels: TakeProfitLevel[];
  smartWalletsInPosition: string[];
}

export interface TakeProfitLevel {
  targetPercent: number;
  sellPercent: number;
  executed: boolean;
}

export interface ConvictionScore {
  total: number;
  breakdown: {
    smartWallet: number;
    tokenSafety: number;
    marketConditions: number;
    socialSignals: number;
    entryQuality: number;
  };
  weights: CategoryWeights;
}

export interface CategoryWeights {
  smartWallet: number;  // default 30%
  tokenSafety: number;  // default 25%
  marketConditions: number;  // default 15%
  socialSignals: number;  // default 10%
  entryQuality: number;  // default 20%
}

export interface BotParameters {
  version: number;
  dipEntryRange: { min: number; max: number };
  stopLossPercent: number;
  positionSizes: {
    high: number;
    medium: number;
    low: number;
  };
  maxOpenPositions: number;
  maxDailyLoss: number;
  maxDailyProfit: number;
  isActive: boolean;
  createdAt: Date;
}

export interface Alert {
  level: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  type: string;
  message: string;
  timestamp: Date;
  data?: any;
}

export interface LearningSnapshot {
  id: string;
  version: number;
  weights: CategoryWeights;
  parameters: BotParameters;
  tradeCount: number;
  winRate: number;
  profitFactor: number;
  createdAt: Date;
}

export interface DangerPattern {
  id: string;
  patternData: any;
  confidenceScore: number;
  occurrences: number;
  createdAt: Date;
}

export interface WinPattern {
  id: string;
  patternData: any;
  avgReturn: number;
  occurrences: number;
  createdAt: Date;
}

export interface BlacklistEntry {
  address: string;
  type: 'wallet' | 'contract';
  reason: string;
  depth: number;
  createdAt: Date;
}

export interface RPCProvider {
  name: string;
  url: string;
  priority: number;
  isHealthy: boolean;
  lastCheck: Date;
  failureCount: number;
}

export interface BotMetrics {
  totalTrades: number;
  winRate: number;
  profitFactor: number;
  totalProfitLoss: number;
  averageWinner: number;
  averageLoser: number;
  currentDrawdown: number;
  maxDrawdown: number;
  uptime: number;
  averageExecutionLatency: number;
}
