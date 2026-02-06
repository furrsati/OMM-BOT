import { logger } from '../utils/logger';
import type { Alert, Trade, MarketRegime } from '../types';
import { TelegramClient } from './telegram-client';
import { DiscordClient } from './discord-client';
import { AlertFormatter } from './alert-formatter';

export interface AlertManagerStats {
  totalSent: number;
  totalFailed: number;
  queueSize: number;
  lastAlert: Date | null;
  telegram: { sent: number; failed: number };
  discord: { sent: number; failed: number };
}

interface QueuedAlert {
  alert: Alert;
  addedAt: Date;
}

/**
 * Alert Manager
 *
 * Central alert dispatcher - routes alerts to all configured channels.
 * Features:
 * - Dual-channel dispatch (Telegram + Discord simultaneously)
 * - Priority-based handling
 * - Queue management for high-frequency alerts
 * - Deduplication (prevents spam)
 * - Alert history (last 100 alerts)
 * - Graceful degradation if channels unavailable
 */
export class AlertManager {
  private telegramClient: TelegramClient;
  private discordClient: DiscordClient;

  // Interval tracking for proper cleanup
  private deduplicationIntervalId: NodeJS.Timeout | null = null;
  private queueProcessorIntervalId: NodeJS.Timeout | null = null;

  // Queue for managing high-frequency alerts
  private queue: QueuedAlert[] = [];
  private readonly maxQueueSize = 1000;
  private processingQueue = false;

  // Deduplication - store hashes of recent alerts
  private recentAlerts = new Map<string, Date>();
  private readonly deduplicationWindow = 5 * 60 * 1000; // 5 minutes

  // Alert history (last 100)
  private history: Alert[] = [];
  private readonly maxHistory = 100;

  // Stats
  private stats: AlertManagerStats = {
    totalSent: 0,
    totalFailed: 0,
    queueSize: 0,
    lastAlert: null,
    telegram: { sent: 0, failed: 0 },
    discord: { sent: 0, failed: 0 },
  };

  constructor(telegramClient: TelegramClient, discordClient: DiscordClient) {
    this.telegramClient = telegramClient;
    this.discordClient = discordClient;
  }

  /**
   * Check if any alert channel is configured
   */
  hasEnabledChannels(): boolean {
    return this.telegramClient.isEnabled() || this.discordClient.isEnabled();
  }

  /**
   * Initialize the alert manager
   */
  async initialize(): Promise<void> {
    logger.info('Alert Manager initializing...');

    // Start queue processor
    this.startQueueProcessor();

    // Clean up old deduplication entries periodically
    this.deduplicationIntervalId = setInterval(() => this.cleanupDeduplication(), 60000); // Every minute

    const telegramEnabled = this.telegramClient.isEnabled();
    const discordEnabled = this.discordClient.isEnabled();

    if (!telegramEnabled && !discordEnabled) {
      logger.warn('⚠️ No alert channels configured. Set TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID or DISCORD_WEBHOOK_URL to enable alerts.');
    }

    logger.info('Alert Manager initialized', {
      telegram: telegramEnabled,
      discord: discordEnabled,
    });
  }

  /**
   * Send a generic alert
   */
  async sendAlert(alert: Alert): Promise<void> {
    // Check for duplicate (except CRITICAL)
    if (alert.level !== 'CRITICAL' && this.isDuplicate(alert)) {
      logger.debug('Duplicate alert suppressed', { type: alert.type });
      return;
    }

    // Add to queue
    this.enqueue(alert);

    // Update history
    this.addToHistory(alert);

    // Record deduplication hash
    this.recordAlert(alert);

    // Process immediately if CRITICAL
    if (alert.level === 'CRITICAL') {
      await this.processQueue();
    }
  }

  /**
   * Send trade entry alert
   */
  async tradeEntry(tokenAddress: string, conviction: number, positionSize: number, data?: any): Promise<void> {
    const alert = AlertFormatter.formatTradeEntry(
      { tokenAddress, entryPrice: data?.entryPrice },
      conviction,
      { ...data, positionSizePercent: positionSize }
    );
    await this.sendAlert(alert);
  }

  /**
   * Send trade exit alert
   */
  async tradeExit(tokenAddress: string, pnl: number, pnlPercent: number, reason: string, data?: any): Promise<void> {
    const trade: Trade = {
      id: data?.id || 'unknown',
      tokenAddress,
      entryPrice: data?.entryPrice || 0,
      entryAmount: data?.entryAmount || 0,
      entryTime: data?.entryTime || new Date(),
      exitPrice: data?.exitPrice,
      exitTime: data?.exitTime || new Date(),
      exitReason: reason as any,
      profitLoss: pnl,
      profitLossPercent: pnlPercent,
      convictionScore: data?.convictionScore || 0,
      fingerprint: data?.fingerprint || {} as any,
    };

    const alert = AlertFormatter.formatTradeExit(trade, pnl, pnlPercent, reason);
    await this.sendAlert(alert);
  }

  /**
   * Send danger signal alert
   */
  async dangerSignal(signal: string, tokenAddress: string, data?: any): Promise<void> {
    const alert = AlertFormatter.formatDangerSignal(signal, tokenAddress, data);
    await this.sendAlert(alert);
  }

  /**
   * Send hard reject alert
   */
  async hardReject(reason: string, tokenAddress: string, data?: any): Promise<void> {
    const alert = AlertFormatter.formatHardReject(reason, tokenAddress, data);
    await this.sendAlert(alert);
  }

  /**
   * Send daily limit alert
   */
  async dailyLimit(limitType: string, current: number, max: number): Promise<void> {
    const alert = AlertFormatter.formatDailyLimit(limitType, current, max);
    await this.sendAlert(alert);
  }

  /**
   * Send market regime change alert
   */
  async marketRegimeChange(oldRegime: MarketRegime, newRegime: MarketRegime, reason: string): Promise<void> {
    const alert = AlertFormatter.formatMarketRegime(oldRegime, newRegime, reason);
    await this.sendAlert(alert);
  }

  /**
   * Send learning engine adjustment alert
   */
  async learningEngineAdjustment(what: string, why: string, data?: any): Promise<void> {
    const alert = AlertFormatter.formatLearningAdjustment(what, why, data);
    await this.sendAlert(alert);
  }

  /**
   * Send wallet list change alert
   */
  async walletListChange(added: number, removed: number, stats?: any): Promise<void> {
    const alert = AlertFormatter.formatWalletListChange(added, removed, stats);
    await this.sendAlert(alert);
  }

  /**
   * Send error alert
   */
  async error(message: string, error: Error): Promise<void> {
    const alert = AlertFormatter.formatError(message, error);
    await this.sendAlert(alert);
  }

  /**
   * Send kill switch alert
   */
  async killSwitch(reason: string, positions: number, data?: any): Promise<void> {
    const alert = AlertFormatter.formatKillSwitch(reason, positions, data);
    await this.sendAlert(alert);
  }

  /**
   * Get current queue size
   */
  getQueueSize(): number {
    return this.queue.length;
  }

  /**
   * Get statistics
   */
  getStats(): AlertManagerStats {
    return {
      ...this.stats,
      queueSize: this.queue.length,
      telegram: this.telegramClient.getStats(),
      discord: this.discordClient.getStats(),
    };
  }

  /**
   * Get alert history
   */
  getHistory(limit = 100): Alert[] {
    return this.history.slice(0, Math.min(limit, this.maxHistory));
  }

  // ============================================================
  // PRIVATE METHODS
  // ============================================================

  /**
   * Add alert to queue
   */
  private enqueue(alert: Alert): void {
    // If CRITICAL, add to front of queue
    if (alert.level === 'CRITICAL') {
      this.queue.unshift({ alert, addedAt: new Date() });
    } else {
      this.queue.push({ alert, addedAt: new Date() });
    }

    // If queue is full, drop oldest LOW priority alerts
    while (this.queue.length > this.maxQueueSize) {
      const lowPriorityIndex = this.queue.findIndex(q => q.alert.level === 'LOW');
      if (lowPriorityIndex >= 0) {
        this.queue.splice(lowPriorityIndex, 1);
        logger.warn('Alert queue full, dropped LOW priority alert');
      } else {
        // No LOW priority to drop, drop oldest
        this.queue.shift();
        logger.warn('Alert queue full, dropped oldest alert');
      }
    }

    this.stats.queueSize = this.queue.length;
  }

  /**
   * Start queue processor (processes every 500ms)
   */
  private startQueueProcessor(): void {
    this.queueProcessorIntervalId = setInterval(() => {
      if (!this.processingQueue && this.queue.length > 0) {
        this.processQueue().catch(error => {
          logger.error('Queue processor error', { error: error.message });
        });
      }
    }, 500);
  }

  /**
   * Stop the alert manager (cleanup intervals and clear queues)
   */
  stop(): void {
    if (this.deduplicationIntervalId) {
      clearInterval(this.deduplicationIntervalId);
      this.deduplicationIntervalId = null;
    }
    if (this.queueProcessorIntervalId) {
      clearInterval(this.queueProcessorIntervalId);
      this.queueProcessorIntervalId = null;
    }
    // Clear queues and caches
    this.queue.length = 0;
    this.recentAlerts.clear();
    this.history.length = 0;
    logger.info('Alert Manager stopped');
  }

  /**
   * Process queued alerts
   */
  private async processQueue(): Promise<void> {
    if (this.processingQueue) return;
    this.processingQueue = true;

    try {
      // Process up to 10 alerts per cycle
      const batch = this.queue.splice(0, 10);

      for (const { alert } of batch) {
        await this.dispatchAlert(alert);
      }

      this.stats.queueSize = this.queue.length;

    } finally {
      this.processingQueue = false;
    }
  }

  /**
   * Dispatch alert to all channels
   */
  private async dispatchAlert(alert: Alert): Promise<void> {
    // Skip if no channels configured
    if (!this.hasEnabledChannels()) {
      return;
    }

    const results = await Promise.allSettled([
      this.sendToTelegram(alert),
      this.sendToDiscord(alert),
    ]);

    // Count successes and failures (only count channels that are enabled)
    let sent = 0;
    let failed = 0;
    let enabledCount = 0;

    if (this.telegramClient.isEnabled()) {
      enabledCount++;
      if (results[0].status === 'fulfilled' && results[0].value) {
        sent++;
      } else {
        failed++;
      }
    }

    if (this.discordClient.isEnabled()) {
      enabledCount++;
      if (results[1].status === 'fulfilled' && results[1].value) {
        sent++;
      } else {
        failed++;
      }
    }

    // Update stats
    this.stats.totalSent += sent;
    this.stats.totalFailed += failed;
    if (sent > 0) {
      this.stats.lastAlert = new Date();
    }

    // Log if all ENABLED channels failed (not just if all channels failed)
    if (sent === 0 && enabledCount > 0) {
      logger.error('Alert failed to send on all channels', {
        type: alert.type,
        level: alert.level,
      });
    }
  }

  /**
   * Send alert to Telegram
   */
  private async sendToTelegram(alert: Alert): Promise<boolean> {
    if (!this.telegramClient.isEnabled()) {
      return false;
    }

    try {
      const message = AlertFormatter.formatForTelegram(alert);
      const success = await this.telegramClient.sendMessage(message, alert.level as any);

      if (success) {
        this.stats.telegram.sent++;
      } else {
        this.stats.telegram.failed++;
      }

      return success;

    } catch (error: any) {
      logger.error('Failed to send Telegram alert', { error: error.message });
      this.stats.telegram.failed++;
      return false;
    }
  }

  /**
   * Send alert to Discord
   */
  private async sendToDiscord(alert: Alert): Promise<boolean> {
    if (!this.discordClient.isEnabled()) {
      return false;
    }

    try {
      const success = await this.discordClient.sendAlert(alert);

      if (success) {
        this.stats.discord.sent++;
      } else {
        this.stats.discord.failed++;
      }

      return success;

    } catch (error: any) {
      logger.error('Failed to send Discord alert', { error: error.message });
      this.stats.discord.failed++;
      return false;
    }
  }

  /**
   * Check if alert is a duplicate
   */
  private isDuplicate(alert: Alert): boolean {
    const hash = this.hashAlert(alert);
    const lastSent = this.recentAlerts.get(hash);

    if (lastSent) {
      const elapsed = Date.now() - lastSent.getTime();
      return elapsed < this.deduplicationWindow;
    }

    return false;
  }

  /**
   * Record alert for deduplication
   */
  private recordAlert(alert: Alert): void {
    const hash = this.hashAlert(alert);
    this.recentAlerts.set(hash, new Date());
  }

  /**
   * Generate hash for deduplication
   */
  private hashAlert(alert: Alert): string {
    // Simple hash based on type and key data
    const key = `${alert.type}:${alert.message.substring(0, 100)}`;
    return key;
  }

  /**
   * Clean up old deduplication entries
   */
  private cleanupDeduplication(): void {
    const now = Date.now();
    const toDelete: string[] = [];

    for (const [hash, timestamp] of this.recentAlerts.entries()) {
      if (now - timestamp.getTime() > this.deduplicationWindow) {
        toDelete.push(hash);
      }
    }

    for (const hash of toDelete) {
      this.recentAlerts.delete(hash);
    }

    if (toDelete.length > 0) {
      logger.debug('Cleaned up deduplication entries', { count: toDelete.length });
    }
  }

  /**
   * Add alert to history
   */
  private addToHistory(alert: Alert): void {
    this.history.unshift(alert);

    // Keep only last maxHistory alerts
    if (this.history.length > this.maxHistory) {
      this.history = this.history.slice(0, this.maxHistory);
    }
  }
}
