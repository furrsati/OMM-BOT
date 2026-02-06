import { logger } from '../utils/logger';
import { AlertManager } from './alert-manager';

export interface KillSwitchState {
  triggered: boolean;
  reason: string;
  triggeredAt: Date | null;
  manual: boolean;
  positionsExited: number;
  finalPnL: number;
}

/**
 * Kill Switch
 *
 * Emergency shutdown system with multiple triggers.
 * Features:
 * - Manual trigger via Telegram command
 * - Auto-triggers for catastrophic failures
 * - Emergency position exit
 * - Final P&L report generation
 * - Graceful shutdown
 * - Prevent restart without manual intervention
 */
export class KillSwitch {
  private alertManager: AlertManager;
  private positionManager?: any; // Will be populated when position manager exists
  private executionEngine?: any; // Will be populated when execution engine exists
  private autoTriggerIntervalId: NodeJS.Timeout | null = null;

  private state: KillSwitchState = {
    triggered: false,
    reason: '',
    triggeredAt: null,
    manual: false,
    positionsExited: 0,
    finalPnL: 0,
  };

  // Auto-trigger tracking
  private rpcFailureStartTime: Date | null = null;
  private networkDegradedStartTime: Date | null = null;
  private lastWalletBalance: number | null = null;

  constructor(
    alertManager: AlertManager,
    positionManager?: any,
    executionEngine?: any
  ) {
    this.alertManager = alertManager;
    this.positionManager = positionManager;
    this.executionEngine = executionEngine;
  }

  /**
   * Initialize the kill switch
   */
  async initialize(): Promise<void> {
    logger.info('Kill Switch armed and ready');

    // Start periodic auto-trigger checks (every 10 seconds)
    this.autoTriggerIntervalId = setInterval(() => {
      if (!this.state.triggered) {
        this.checkAutoTriggers().catch(error => {
          logger.error('Kill switch auto-trigger check failed', { error: error.message });
        });
      }
    }, 10000);
  }

  /**
   * Stop the kill switch (cleanup interval)
   */
  stop(): void {
    if (this.autoTriggerIntervalId) {
      clearInterval(this.autoTriggerIntervalId);
      this.autoTriggerIntervalId = null;
    }
    logger.info('Kill Switch stopped');
  }

  /**
   * Trigger the kill switch
   */
  async trigger(reason: string, manual = false): Promise<void> {
    if (this.state.triggered) {
      logger.warn('Kill switch already triggered', { reason: this.state.reason });
      return;
    }

    logger.error('🚨 KILL SWITCH TRIGGERED', { reason, manual });

    // Update state
    this.state = {
      triggered: true,
      reason,
      triggeredAt: new Date(),
      manual,
      positionsExited: 0,
      finalPnL: 0,
    };

    try {
      // 1. Send CRITICAL alert immediately
      await this.alertManager.killSwitch(reason, this.getOpenPositionCount(), {
        manual,
        triggeredAt: this.state.triggeredAt,
      });

      // 2. Emergency exit all positions
      await this.emergencyExitAllPositions();

      // 3. Generate final report
      const report = await this.generateFinalReport();
      logger.info('Final P&L Report:\n' + report);

      // 4. Send final report as alert
      await this.alertManager.sendAlert({
        level: 'CRITICAL',
        type: 'FINAL_REPORT',
        message: report,
        timestamp: new Date(),
      });

      // 5. Initiate shutdown
      await this.shutdown();

    } catch (error: any) {
      logger.error('Error during kill switch execution', { error: error.message });
      // Still attempt to shutdown
      await this.shutdown();
    }
  }

  /**
   * Check all auto-trigger conditions
   */
  async checkAutoTriggers(): Promise<void> {
    try {
      // Check RPC failure
      if (this.isRPCFailure()) {
        await this.trigger('All RPC nodes failed for >30 seconds', false);
        return;
      }

      // Check wallet drain
      if (await this.isWalletDrain()) {
        await this.trigger('Wallet being drained by unknown transaction', false);
        return;
      }

      // Check network degradation
      if (this.isNetworkDegraded()) {
        await this.trigger('Solana network severely degraded (>5 minutes)', false);
        return;
      }

      // Check catastrophic loss
      if (this.isCatastrophicLoss()) {
        await this.trigger('Catastrophic daily loss exceeds limit by >50%', false);
        return;
      }

    } catch (error: any) {
      logger.error('Error checking auto-triggers', { error: error.message });
    }
  }

  /**
   * Check if all RPC nodes have failed
   */
  isRPCFailure(): boolean {
    try {
      // TODO: Integrate with RPC manager when available
      // For now, return false (no RPC failure detected)

      // Example implementation:
      // const rpcManager = getRPCManager();
      // const allProviders = rpcManager.getAllProviders();
      // const allFailed = allProviders.every(p => !p.isHealthy);
      //
      // if (allFailed) {
      //   if (!this.rpcFailureStartTime) {
      //     this.rpcFailureStartTime = new Date();
      //   }
      //   const elapsed = Date.now() - this.rpcFailureStartTime.getTime();
      //   return elapsed > 30000; // 30 seconds
      // }
      //
      // this.rpcFailureStartTime = null;
      return false;

    } catch (error) {
      logger.error('Error checking RPC failure', { error });
      return false;
    }
  }

  /**
   * Check if wallet is being drained
   */
  async isWalletDrain(): Promise<boolean> {
    try {
      // TODO: Integrate with wallet monitor when available
      // For now, return false (no drain detected)

      // Example implementation:
      // const currentBalance = await getWalletBalance();
      //
      // if (this.lastWalletBalance !== null) {
      //   const change = this.lastWalletBalance - currentBalance;
      //   const changePercent = (change / this.lastWalletBalance) * 100;
      //
      //   // If balance dropped >10% unexpectedly (not from known trades)
      //   if (changePercent > 10) {
      //     // Check if this was from a known trade
      //     const recentTrade = await checkRecentTradeActivity();
      //     if (!recentTrade) {
      //       return true; // Unexpected drain
      //     }
      //   }
      // }
      //
      // this.lastWalletBalance = currentBalance;
      return false;

    } catch (error) {
      logger.error('Error checking wallet drain', { error });
      return false;
    }
  }

  /**
   * Check if Solana network is severely degraded
   */
  isNetworkDegraded(): boolean {
    try {
      // TODO: Integrate with network monitor when available
      // For now, return false (no degradation detected)

      // Example implementation:
      // const txSuccessRate = getRecentTransactionSuccessRate();
      //
      // if (txSuccessRate < 0.5) { // Less than 50% success rate
      //   if (!this.networkDegradedStartTime) {
      //     this.networkDegradedStartTime = new Date();
      //   }
      //   const elapsed = Date.now() - this.networkDegradedStartTime.getTime();
      //   return elapsed > 5 * 60 * 1000; // 5 minutes
      // }
      //
      // this.networkDegradedStartTime = null;
      return false;

    } catch (error) {
      logger.error('Error checking network degradation', { error });
      return false;
    }
  }

  /**
   * Check if daily loss has exceeded max by >50%
   */
  isCatastrophicLoss(): boolean {
    try {
      // TODO: Integrate with decision engine when available
      // For now, return false (no catastrophic loss)

      // Example implementation:
      // const dailyPnL = getDecisionEngineState().dailyPnL;
      // const maxLoss = parseFloat(process.env.MAX_DAILY_LOSS_PERCENT || '8');
      // const threshold = maxLoss * 1.5; // 50% over max
      //
      // return dailyPnL < -threshold;
      return false;

    } catch (error) {
      logger.error('Error checking catastrophic loss', { error });
      return false;
    }
  }

  /**
   * Emergency exit all open positions
   */
  async emergencyExitAllPositions(): Promise<void> {
    try {
      if (!this.positionManager || !this.executionEngine) {
        logger.warn('Position manager or execution engine not available - cannot exit positions');
        return;
      }

      logger.info('🚨 Initiating emergency exit of all positions');

      // TODO: Integrate with position manager and execution engine
      // const openPositions = await this.positionManager.getAllOpenPositions();
      // logger.info(`Emergency exiting ${openPositions.length} positions`);
      //
      // const exitPromises = openPositions.map(async (position) => {
      //   try {
      //     await this.executionEngine.emergencyExit(position, {
      //       maxSlippage: 0.15, // 15% slippage tolerance
      //       reason: 'KILL_SWITCH',
      //     });
      //     this.state.positionsExited++;
      //     logger.info('Position exited', { token: position.tokenAddress });
      //   } catch (error: any) {
      //     logger.error('Failed to exit position', {
      //       token: position.tokenAddress,
      //       error: error.message,
      //     });
      //   }
      // });
      //
      // // Wait for all exits (max 30 seconds)
      // await Promise.race([
      //   Promise.all(exitPromises),
      //   new Promise(resolve => setTimeout(resolve, 30000)),
      // ]);

      logger.info(`Emergency exit complete - ${this.state.positionsExited} positions exited`);

    } catch (error: any) {
      logger.error('Error during emergency exit', { error: error.message });
    }
  }

  /**
   * Generate final P&L report
   */
  async generateFinalReport(): Promise<string> {
    try {
      // TODO: Integrate with performance tracker when available
      // For now, generate a basic report

      const report = [
        '═══════════════════════════════════════',
        '           FINAL P&L REPORT            ',
        '═══════════════════════════════════════',
        '',
        `Shutdown Reason: ${this.state.reason}`,
        `Triggered: ${this.state.manual ? 'Manual' : 'Automatic'}`,
        `Timestamp: ${this.state.triggeredAt?.toISOString() || 'Unknown'}`,
        '',
        '--- POSITIONS ---',
        `Open Positions Exited: ${this.state.positionsExited}`,
        '',
        '--- PERFORMANCE ---',
        // TODO: Add actual performance data
        'Total Trades: N/A',
        'Win Rate: N/A',
        'Profit Factor: N/A',
        'Total P&L: N/A',
        '',
        '--- SYSTEM STATE ---',
        `Bot Runtime: N/A`,
        `Last Update: ${new Date().toISOString()}`,
        '',
        '═══════════════════════════════════════',
        '      Bot shutdown complete.           ',
        '   Manual restart required to resume.  ',
        '═══════════════════════════════════════',
      ].join('\n');

      return report;

    } catch (error: any) {
      logger.error('Error generating final report', { error: error.message });
      return 'Final report generation failed';
    }
  }

  /**
   * Initiate graceful shutdown
   */
  async shutdown(): Promise<void> {
    try {
      logger.info('🛑 Initiating bot shutdown...');

      // Give alert manager time to send pending alerts
      await new Promise(resolve => setTimeout(resolve, 2000));

      logger.info('✅ Bot shutdown complete');
      logger.info('⚠️  Manual restart required');

      // Exit process
      process.exit(1);

    } catch (error: any) {
      logger.error('Error during shutdown', { error: error.message });
      process.exit(1);
    }
  }

  /**
   * Check if kill switch has been triggered
   */
  isTriggered(): boolean {
    return this.state.triggered;
  }

  /**
   * Get current state
   */
  getState(): KillSwitchState {
    return { ...this.state };
  }

  /**
   * Get count of open positions (stub)
   */
  private getOpenPositionCount(): number {
    // TODO: Integrate with position manager
    // return this.positionManager?.getOpenPositionCount() || 0;
    return 0;
  }
}
