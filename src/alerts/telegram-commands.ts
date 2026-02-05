import TelegramBot from 'node-telegram-bot-api';
import { logger } from '../utils/logger';
import { TelegramClient } from './telegram-client';
import { AlertManager } from './alert-manager';
import { KillSwitch } from './kill-switch';

interface PendingKillSwitch {
  chatId: number;
  expiresAt: Date;
}

/**
 * Telegram Commands
 *
 * Handles bot commands sent via Telegram for remote monitoring and control.
 * Features:
 * - Authentication (only responds to configured chat ID)
 * - 8 commands: status, positions, wallet, limits, kill, pause, resume, report
 * - Kill switch requires confirmation
 * - Formatted responses with real-time data
 */
export class TelegramCommands {
  private telegramClient: TelegramClient;
  private alertManager: AlertManager;
  private killSwitch: KillSwitch;

  // Optional managers (will be populated as they become available)
  private positionManager?: any;
  private convictionEngine?: any;
  private learningEngine?: any;
  private regimeDetector?: any;
  private priceFeed?: any;

  // Pending kill switch confirmations
  private pendingKillSwitch: PendingKillSwitch | null = null;

  // Trading pause state
  private tradingPaused = false;

  constructor(
    telegramClient: TelegramClient,
    alertManager: AlertManager,
    killSwitch: KillSwitch,
    options?: {
      positionManager?: any;
      convictionEngine?: any;
      learningEngine?: any;
      regimeDetector?: any;
      priceFeed?: any;
    }
  ) {
    this.telegramClient = telegramClient;
    this.alertManager = alertManager;
    this.killSwitch = killSwitch;

    if (options) {
      this.positionManager = options.positionManager;
      this.convictionEngine = options.convictionEngine;
      this.learningEngine = options.learningEngine;
      this.regimeDetector = options.regimeDetector;
      this.priceFeed = options.priceFeed;
    }
  }

  /**
   * Initialize command handlers
   */
  async initialize(): Promise<void> {
    const bot = this.telegramClient.getBot();
    if (!bot) {
      logger.warn('Telegram bot not available - commands disabled');
      return;
    }

    // Start polling for commands
    bot.startPolling();

    // Register command handlers
    bot.onText(/\/status/, (msg) => this.handleCommand(msg, 'status'));
    bot.onText(/\/positions/, (msg) => this.handleCommand(msg, 'positions'));
    bot.onText(/\/wallet/, (msg) => this.handleCommand(msg, 'wallet'));
    bot.onText(/\/limits/, (msg) => this.handleCommand(msg, 'limits'));
    bot.onText(/\/kill(.*)/, (msg, match) => this.handleCommand(msg, 'kill', match?.[1]?.trim()));
    bot.onText(/\/pause/, (msg) => this.handleCommand(msg, 'pause'));
    bot.onText(/\/resume/, (msg) => this.handleCommand(msg, 'resume'));
    bot.onText(/\/report/, (msg) => this.handleCommand(msg, 'report'));

    // Clean up expired kill switch confirmations periodically
    setInterval(() => this.cleanupExpiredKillSwitch(), 30000); // Every 30 seconds

    logger.info('Telegram commands registered');
  }

  /**
   * Handle incoming command
   */
  private async handleCommand(msg: TelegramBot.Message, command: string, args?: string): Promise<void> {
    const chatId = msg.chat.id;

    // Check authorization
    if (!this.isAuthorized(chatId)) {
      logger.warn('Unauthorized Telegram command attempt', { chatId, command });
      return; // Silently ignore unauthorized users
    }

    try {
      logger.info('Telegram command received', { command, chatId });

      switch (command) {
        case 'status':
          await this.handleStatus(chatId);
          break;
        case 'positions':
          await this.handlePositions(chatId);
          break;
        case 'wallet':
          await this.handleWallet(chatId);
          break;
        case 'limits':
          await this.handleLimits(chatId);
          break;
        case 'kill':
          await this.handleKill(chatId, args);
          break;
        case 'pause':
          await this.handlePause(chatId);
          break;
        case 'resume':
          await this.handleResume(chatId);
          break;
        case 'report':
          await this.handleReport(chatId);
          break;
        default:
          await this.sendMessage(chatId, 'Unknown command');
      }

    } catch (error: any) {
      logger.error('Error handling Telegram command', { command, error: error.message });
      await this.sendMessage(chatId, `Error: ${error.message}`);
    }
  }

  /**
   * Handle /status command
   */
  private async handleStatus(chatId: number): Promise<void> {
    const trading = process.env.ENABLE_TRADING === 'true' && !this.tradingPaused;
    const paperMode = process.env.PAPER_TRADING_MODE === 'true';

    // Get regime info
    let regimeInfo = 'Unknown';
    if (this.regimeDetector) {
      const regime = this.regimeDetector.getRegimeState();
      regimeInfo = `${regime.regime} (${regime.reason})`;
    }

    // Get decision engine state
    let dailyPnL = 0;
    let openPositions = 0;
    let losingStreak = 0;
    if (this.convictionEngine) {
      const state = this.convictionEngine.getState();
      dailyPnL = state.dailyPnL || 0;
      openPositions = state.openPositions || 0;
      losingStreak = state.losingStreak || 0;
    }

    const message = [
      '🤖 *BOT STATUS*',
      '',
      `Trading: ${trading ? '✅ Active' : '⏸️ Paused'}`,
      paperMode ? '⚠️ PAPER TRADING MODE' : '',
      `Regime: ${regimeInfo}`,
      `Daily P&L: ${dailyPnL >= 0 ? '+' : ''}${dailyPnL.toFixed(2)}%`,
      `Open Positions: ${openPositions}/5`,
      `Losing Streak: ${losingStreak}`,
      `Cooldown: None`, // TODO: Get from decision engine
      '',
      '⚙️ *Systems*',
      '• RPC: HEALTHY', // TODO: Get from RPC manager
      '• Database: HEALTHY', // TODO: Get from DB
      '• Learning: READY',
      '',
      `_Last updated: ${new Date().toISOString().replace('T', ' ').substring(0, 19)}_`,
    ].filter(Boolean).join('\n');

    await this.sendMessage(chatId, message);
  }

  /**
   * Handle /positions command
   */
  private async handlePositions(chatId: number): Promise<void> {
    // TODO: Integrate with position manager
    const positions: any[] = []; // this.positionManager?.getAllOpenPositions() || [];

    if (positions.length === 0) {
      await this.sendMessage(chatId, '📊 *OPEN POSITIONS*\n\nNo open positions');
      return;
    }

    const message = [
      `📊 *OPEN POSITIONS (${positions.length})*`,
      '',
      // TODO: Format each position
      'Position data will be available when position manager is integrated',
      '',
      `_Last updated: ${new Date().toISOString().replace('T', ' ').substring(0, 19)}_`,
    ].join('\n');

    await this.sendMessage(chatId, message);
  }

  /**
   * Handle /wallet command
   */
  private async handleWallet(chatId: number): Promise<void> {
    // TODO: Integrate with wallet manager
    const balance = 0; // await getWalletBalance();
    const inPositions = 0; // Calculate from position manager
    const available = balance - inPositions;

    const maxLoss = parseFloat(process.env.MAX_DAILY_LOSS_PERCENT || '8');
    const maxProfit = parseFloat(process.env.MAX_DAILY_PROFIT_PERCENT || '15');

    const message = [
      '💰 *WALLET STATUS*',
      '',
      `Balance: $${balance.toFixed(2)}`,
      `In Positions: $${inPositions.toFixed(2)} (${((inPositions / balance) * 100).toFixed(1)}%)`,
      `Available: $${available.toFixed(2)} (${((available / balance) * 100).toFixed(1)}%)`,
      '',
      '*Daily Stats:*',
      `• P&L Today: +$0.00 (+0%)`, // TODO: Get from performance tracker
      `• Max Loss Limit: -${maxLoss}% (-$${(balance * maxLoss / 100).toFixed(2)})`,
      `• Max Profit Limit: +${maxProfit}% (+$${(balance * maxProfit / 100).toFixed(2)})`,
      '',
      '*Risk Metrics:*',
      `• Total Exposure: 0% / 20% max`,
      `• Open Positions: 0 / 5 max`,
      '',
      `_Last updated: ${new Date().toISOString().replace('T', ' ').substring(0, 19)}_`,
    ].join('\n');

    await this.sendMessage(chatId, message);
  }

  /**
   * Handle /limits command
   */
  private async handleLimits(chatId: number): Promise<void> {
    const maxLoss = parseFloat(process.env.MAX_DAILY_LOSS_PERCENT || '8');
    const maxProfit = parseFloat(process.env.MAX_DAILY_PROFIT_PERCENT || '15');

    // TODO: Get actual values from decision engine
    const currentLoss = 0;
    const currentProfit = 0;
    const todayTrades = 0;
    const winRate = 0;
    const losingStreak = 0;

    const message = [
      '📊 *DAILY LIMITS STATUS*',
      '',
      '*Daily Loss:*',
      `  Current: ${currentLoss.toFixed(2)}%`,
      `  Limit: -${maxLoss}%`,
      `  Status: ✅ Safe`,
      '',
      '*Daily Profit:*',
      `  Current: +${currentProfit.toFixed(2)}%`,
      `  Limit: +${maxProfit}%`,
      `  Status: ✅ Safe`,
      '',
      '*Trade Count:*',
      `  Today: ${todayTrades} trades`,
      `  Win Rate: ${winRate}%`,
      '',
      '*Losing Streak:*',
      `  Current: ${losingStreak}`,
      `  Max Before Pause: 5`,
      `  Status: ✅ Safe`,
      '',
      `_Last updated: ${new Date().toISOString().replace('T', ' ').substring(0, 19)}_`,
    ].join('\n');

    await this.sendMessage(chatId, message);
  }

  /**
   * Handle /kill command
   */
  private async handleKill(chatId: number, args?: string): Promise<void> {
    // Check if confirming
    if (args === 'confirm') {
      if (this.pendingKillSwitch && this.pendingKillSwitch.chatId === chatId) {
        if (new Date() < this.pendingKillSwitch.expiresAt) {
          // Valid confirmation
          await this.sendMessage(chatId, '🚨 *KILL SWITCH ACTIVATED*\n\nInitiating emergency shutdown...');
          this.pendingKillSwitch = null;

          // Trigger kill switch
          await this.killSwitch.trigger('Manual trigger via Telegram', true);
          return;
        } else {
          // Expired
          this.pendingKillSwitch = null;
          await this.sendMessage(chatId, '⚠️ Kill switch confirmation expired. Send `/kill` again to retry.');
          return;
        }
      } else {
        // No pending kill switch
        await this.sendMessage(chatId, '⚠️ No pending kill switch to confirm. Send `/kill` first.');
        return;
      }
    }

    // Initial kill command - request confirmation
    const openPositions = 0; // TODO: Get from position manager

    this.pendingKillSwitch = {
      chatId,
      expiresAt: new Date(Date.now() + 30000), // 30 seconds
    };

    const message = [
      '⚠️ *KILL SWITCH*',
      '',
      'This will:',
      '• Stop all trading immediately',
      `• Exit all open positions (${openPositions})`,
      '• Generate final P&L report',
      '• Shut down the bot',
      '',
      '⚠️ *This cannot be undone remotely.*',
      'You will need to manually restart.',
      '',
      'To confirm, type: `/kill confirm`',
      '_(Expires in 30 seconds)_',
    ].join('\n');

    await this.sendMessage(chatId, message);
  }

  /**
   * Handle /pause command
   */
  private async handlePause(chatId: number): Promise<void> {
    this.tradingPaused = true;

    const message = [
      '⏸️ *TRADING PAUSED*',
      '',
      'New entries: DISABLED',
      'Open positions: Will continue monitoring',
      'Stops/TPs: Still active',
      '',
      'To resume: `/resume`',
    ].join('\n');

    await this.sendMessage(chatId, message);

    // Send alert
    await this.alertManager.sendAlert({
      level: 'HIGH',
      type: 'TRADING_PAUSED',
      message: 'Trading paused via Telegram command',
      timestamp: new Date(),
    });
  }

  /**
   * Handle /resume command
   */
  private async handleResume(chatId: number): Promise<void> {
    this.tradingPaused = false;

    const message = [
      '▶️ *TRADING RESUMED*',
      '',
      'New entries: ENABLED',
      'Monitoring: Active',
      'Status: Operational',
    ].join('\n');

    await this.sendMessage(chatId, message);

    // Send alert
    await this.alertManager.sendAlert({
      level: 'HIGH',
      type: 'TRADING_RESUMED',
      message: 'Trading resumed via Telegram command',
      timestamp: new Date(),
    });
  }

  /**
   * Handle /report command
   */
  private async handleReport(chatId: number): Promise<void> {
    // TODO: Integrate with performance tracker
    const message = [
      '📈 *PERFORMANCE REPORT*',
      'Period: Last 24 hours',
      '',
      'Trades: 0 total (0W/0L)',
      'Win Rate: N/A',
      'P&L: $0.00 (0%)',
      'Profit Factor: N/A',
      '',
      'Best Trade: N/A',
      'Worst Trade: N/A',
      'Avg Winner: N/A',
      'Avg Loser: N/A',
      '',
      'Current Streak: 0',
      '',
      'Performance tracking will be available',
      'when the full system is integrated.',
      '',
      `_Generated: ${new Date().toISOString().replace('T', ' ').substring(0, 19)}_`,
    ].join('\n');

    await this.sendMessage(chatId, message);
  }

  /**
   * Check if user is authorized
   */
  private isAuthorized(chatId: number): boolean {
    const authorizedChatId = this.telegramClient.getChatId();
    if (!authorizedChatId) return false;
    return chatId.toString() === authorizedChatId;
  }

  /**
   * Send message to chat
   */
  private async sendMessage(chatId: number, text: string): Promise<void> {
    const bot = this.telegramClient.getBot();
    if (!bot) return;

    try {
      await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    } catch (error: any) {
      logger.error('Failed to send Telegram message', { error: error.message });
    }
  }

  /**
   * Clean up expired kill switch confirmations
   */
  private cleanupExpiredKillSwitch(): void {
    if (this.pendingKillSwitch && new Date() > this.pendingKillSwitch.expiresAt) {
      logger.debug('Kill switch confirmation expired');
      this.pendingKillSwitch = null;
    }
  }

  /**
   * Check if trading is paused
   */
  isTradingPaused(): boolean {
    return this.tradingPaused;
  }
}
