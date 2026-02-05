/**
 * Bot Context - Shared State Manager
 *
 * This singleton holds references to all bot components so the API can access them.
 * It's initialized when the bot starts up and passed to the API server.
 */

import { Connection } from '@solana/web3.js';
import { PositionManager } from '../../positions';
import { ExecutionManager } from '../../execution';
import { WalletManager } from '../../discovery';
import { PriceFeed, RegimeDetector } from '../../market';
import { SafetyScorer } from '../../safety';
import { EntryDecisionEngine } from '../../conviction';
import { LearningScheduler } from '../../learning';
import { AlertManager, KillSwitch } from '../../alerts';

export interface BotContext {
  // Core Components
  connection: Connection;
  positionManager: PositionManager;
  executionManager: ExecutionManager;
  walletManager: WalletManager;
  priceFeed: PriceFeed;
  regimeDetector: RegimeDetector;
  safetyScorer: SafetyScorer;
  entryDecision: EntryDecisionEngine;
  learningScheduler: LearningScheduler;
  alertManager: AlertManager;
  killSwitch: KillSwitch;

  // Bot State
  startTime: Date;
  isRunning: boolean;
  isPaused: boolean;
}

class BotContextManager {
  private static instance: BotContextManager;
  private context: BotContext | null = null;

  private constructor() {}

  static getInstance(): BotContextManager {
    if (!BotContextManager.instance) {
      BotContextManager.instance = new BotContextManager();
    }
    return BotContextManager.instance;
  }

  /**
   * Initialize bot context with all components
   * Call this from src/index.ts after all components are initialized
   */
  initialize(context: BotContext): void {
    this.context = context;
  }

  /**
   * Get the current bot context
   * Throws error if not initialized
   */
  getContext(): BotContext {
    if (!this.context) {
      throw new Error('Bot context not initialized. Call initialize() first.');
    }
    return this.context;
  }

  /**
   * Check if context is initialized
   */
  isInitialized(): boolean {
    return this.context !== null;
  }

  /**
   * Update bot state
   */
  updateState(updates: Partial<Pick<BotContext, 'isRunning' | 'isPaused'>>): void {
    if (this.context) {
      Object.assign(this.context, updates);
    }
  }
}

// Export singleton instance
export const botContextManager = BotContextManager.getInstance();
