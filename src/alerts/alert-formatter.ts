import type { Alert, Trade, MarketRegime } from '../types';
import type { DiscordEmbed } from './discord-client';

/**
 * Alert Formatter
 *
 * Formats alerts consistently for both Telegram and Discord platforms.
 * Features:
 * - Platform-specific formatting (Telegram Markdown vs Discord Embeds)
 * - Emoji indicators for visual clarity
 * - Truncation for long messages
 * - Number formatting (percentages, currency)
 * - Concise but informative messages
 */
export class AlertFormatter {
  /**
   * Format alert for Telegram (Markdown)
   */
  static formatForTelegram(alert: Alert): string {
    const emoji = this.getAlertEmoji(alert);
    const timestamp = this.formatTimestamp(alert.timestamp);

    let message = `${emoji} *${alert.type.replace(/_/g, ' ')}*\n`;
    message += `${alert.message}\n`;

    // Add data fields if present
    if (alert.data && typeof alert.data === 'object') {
      message += '\n';
      for (const [key, value] of Object.entries(alert.data)) {
        if (value !== null && value !== undefined) {
          const formattedKey = key.replace(/_/g, ' ');
          message += `• ${formattedKey}: \`${value}\`\n`;
        }
      }
    }

    message += `\n_${timestamp}_`;

    // Truncate if too long (Telegram limit is 4096 chars)
    if (message.length > 4000) {
      message = message.substring(0, 3997) + '...';
    }

    return message;
  }

  /**
   * Format alert for Discord (Rich Embed)
   */
  static formatForDiscord(alert: Alert): DiscordEmbed {
    const color = this.getColorForLevel(alert.level);

    return {
      title: `${this.getAlertEmoji(alert)} ${alert.type.replace(/_/g, ' ')}`,
      description: alert.message,
      color,
      fields: this.extractFields(alert.data),
      timestamp: alert.timestamp,
      footer: { text: 'Solana Memecoin Trading Bot V3.0' },
    };
  }

  /**
   * Format trade entry alert
   */
  static formatTradeEntry(trade: Partial<Trade>, conviction: number, data?: any): Alert {
    const message = [
      `🟢 *TRADE ENTRY*`,
      ``,
      `Token: \`${this.truncateAddress(trade.tokenAddress || 'Unknown')}\``,
      `Conviction: *${conviction}/100* (${this.getConvictionTier(conviction)})`,
      `Entry Price: $${this.formatNumber(trade.entryPrice || 0, 8)}`,
      `Position Size: ${this.formatPercent(data?.positionSizePercent || 0)}`,
      `Amount: $${this.formatNumber(data?.positionSizeUSD || 0, 2)}`,
      ``,
      `Smart Wallets: ${data?.smartWalletCount || 0} (${data?.walletTiers || 'N/A'})`,
      `Safety Score: ${data?.safetyScore || 0}/100`,
      `Market Regime: ${data?.regime || 'Unknown'}`,
      ``,
      `_${this.formatTimestamp(new Date())}_`,
    ].join('\n');

    return {
      level: 'HIGH',
      type: 'TRADE_ENTRY',
      message,
      timestamp: new Date(),
      data,
    };
  }

  /**
   * Format trade exit alert
   */
  static formatTradeExit(trade: Trade, pnl: number, pnlPercent: number, reason: string): Alert {
    const emoji = pnlPercent >= 0 ? '🟢' : '🔴';
    const sign = pnlPercent >= 0 ? '+' : '';

    const message = [
      `${emoji} *TRADE EXIT*`,
      ``,
      `Token: \`${this.truncateAddress(trade.tokenAddress)}\``,
      `P&L: *${sign}${this.formatPercent(pnlPercent)}* ($${sign}${this.formatNumber(pnl, 2)})`,
      `Reason: ${reason}`,
      ``,
      `Entry: $${this.formatNumber(trade.entryPrice, 8)}`,
      `Exit: $${this.formatNumber(trade.exitPrice || 0, 8)}`,
      `Duration: ${this.formatDuration(trade.entryTime, trade.exitTime || new Date())}`,
      ``,
      `_${this.formatTimestamp(new Date())}_`,
    ].join('\n');

    return {
      level: pnlPercent >= 0 ? 'HIGH' : 'HIGH',
      type: 'TRADE_EXIT',
      message,
      timestamp: new Date(),
      data: { pnl, pnlPercent, reason, tokenAddress: trade.tokenAddress },
    };
  }

  /**
   * Format danger signal alert
   */
  static formatDangerSignal(signal: string, tokenAddress: string, data?: any): Alert {
    const message = [
      `⚠️ *DANGER SIGNAL DETECTED*`,
      ``,
      `Signal: ${signal}`,
      `Token: \`${this.truncateAddress(tokenAddress)}\``,
      ``,
      `Action: Position being monitored`,
      ``,
      `_${this.formatTimestamp(new Date())}_`,
    ].join('\n');

    return {
      level: 'HIGH',
      type: 'DANGER_SIGNAL',
      message,
      timestamp: new Date(),
      data: { signal, tokenAddress, ...data },
    };
  }

  /**
   * Format hard reject alert
   */
  static formatHardReject(reason: string, tokenAddress: string, data?: any): Alert {
    const message = [
      `🛑 *HARD REJECT*`,
      ``,
      `Reason: ${reason}`,
      `Token: \`${this.truncateAddress(tokenAddress)}\``,
      ``,
      `_${this.formatTimestamp(new Date())}_`,
    ].join('\n');

    return {
      level: 'MEDIUM',
      type: 'HARD_REJECT',
      message,
      timestamp: new Date(),
      data: { reason, tokenAddress, ...data },
    };
  }

  /**
   * Format daily limit alert
   */
  static formatDailyLimit(limitType: string, current: number, max: number): Alert {
    const percentage = (current / max) * 100;
    const isWarning = percentage >= 80;
    const isCritical = percentage >= 100;

    const emoji = isCritical ? '🚨' : isWarning ? '⚠️' : 'ℹ️';
    const level = isCritical ? 'CRITICAL' : isWarning ? 'HIGH' : 'NORMAL';

    const message = [
      `${emoji} *DAILY LIMIT ${isCritical ? 'EXCEEDED' : 'WARNING'}*`,
      ``,
      `Limit Type: ${limitType}`,
      `Current: ${this.formatPercent(current)}`,
      `Maximum: ${this.formatPercent(max)}`,
      `Usage: ${this.formatPercent(percentage)}`,
      ``,
      isCritical ? `🛑 Trading paused` : `⚠️ Approaching limit`,
      ``,
      `_${this.formatTimestamp(new Date())}_`,
    ].join('\n');

    return {
      level: level as 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW',
      type: 'DAILY_LIMIT',
      message,
      timestamp: new Date(),
      data: { limitType, current, max, percentage },
    };
  }

  /**
   * Format market regime change alert
   */
  static formatMarketRegime(oldRegime: MarketRegime, newRegime: MarketRegime, reason: string): Alert {
    const emoji = this.getRegimeEmoji(newRegime);

    const message = [
      `${emoji} *MARKET REGIME CHANGE*`,
      ``,
      `${oldRegime} → *${newRegime}*`,
      ``,
      `Reason: ${reason}`,
      ``,
      `Impact: ${this.getRegimeImpact(newRegime)}`,
      ``,
      `_${this.formatTimestamp(new Date())}_`,
    ].join('\n');

    return {
      level: 'HIGH',
      type: 'MARKET_REGIME_CHANGE',
      message,
      timestamp: new Date(),
      data: { oldRegime, newRegime, reason },
    };
  }

  /**
   * Format learning engine adjustment alert
   */
  static formatLearningAdjustment(what: string, why: string, data?: any): Alert {
    const message = [
      `🧠 *LEARNING ENGINE ADJUSTMENT*`,
      ``,
      `Changed: ${what}`,
      `Reason: ${why}`,
      ``,
      `_${this.formatTimestamp(new Date())}_`,
    ].join('\n');

    return {
      level: 'MEDIUM',
      type: 'LEARNING_ENGINE_ADJUSTMENT',
      message,
      timestamp: new Date(),
      data: { what, why, ...data },
    };
  }

  /**
   * Format wallet list change alert
   */
  static formatWalletListChange(added: number, removed: number, stats?: any): Alert {
    const message = [
      `👛 *WALLET LIST UPDATE*`,
      ``,
      `Added: ${added} wallets`,
      `Removed: ${removed} wallets`,
      `Total: ${stats?.total || 'N/A'} wallets`,
      ``,
      `_${this.formatTimestamp(new Date())}_`,
    ].join('\n');

    return {
      level: 'MEDIUM',
      type: 'WALLET_LIST_CHANGE',
      message,
      timestamp: new Date(),
      data: { added, removed, stats },
    };
  }

  /**
   * Format kill switch alert
   */
  static formatKillSwitch(reason: string, positions: number, data?: any): Alert {
    const message = [
      `🚨🚨🚨 *KILL SWITCH ACTIVATED* 🚨🚨🚨`,
      ``,
      `Reason: ${reason}`,
      `Open Positions: ${positions}`,
      ``,
      `Action: Emergency exit initiated`,
      `Status: Bot shutting down`,
      ``,
      `⚠️ Manual restart required`,
      ``,
      `_${this.formatTimestamp(new Date())}_`,
    ].join('\n');

    return {
      level: 'CRITICAL',
      type: 'KILL_SWITCH',
      message,
      timestamp: new Date(),
      data: { reason, positions, ...data },
    };
  }

  /**
   * Format system error alert
   */
  static formatError(errorMessage: string, error: Error): Alert {
    const message = [
      `🔴 *SYSTEM ERROR*`,
      ``,
      `${errorMessage}`,
      ``,
      `Error: \`${error.message}\``,
      ``,
      `_${this.formatTimestamp(new Date())}_`,
    ].join('\n');

    return {
      level: 'CRITICAL',
      type: 'ERROR',
      message,
      timestamp: new Date(),
      data: { errorMessage, errorName: error.name, errorStack: error.stack },
    };
  }

  // ============================================================
  // HELPER METHODS
  // ============================================================

  private static getAlertEmoji(alert: Alert): string {
    const emojiMap: Record<string, string> = {
      CRITICAL: '🔴',
      HIGH: '🟡',
      NORMAL: '🟢',
      LOW: '⚪',
    };
    return emojiMap[alert.level] || '⚪';
  }

  private static getColorForLevel(level: string): number {
    const colorMap: Record<string, number> = {
      CRITICAL: 0xFF0000, // Red
      HIGH: 0xFFFF00,     // Yellow
      NORMAL: 0x00FF00,   // Green
      LOW: 0xAAAAAA,      // Gray
    };
    return colorMap[level] || 0xAAAAAA;
  }

  private static extractFields(data?: any): Array<{ name: string; value: string; inline?: boolean }> {
    if (!data || typeof data !== 'object') {
      return [];
    }

    const fields: Array<{ name: string; value: string; inline?: boolean }> = [];
    for (const [key, value] of Object.entries(data)) {
      if (value !== null && value !== undefined) {
        fields.push({
          name: key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
          value: String(value),
          inline: true,
        });
      }
    }
    return fields;
  }

  private static truncateAddress(address: string): string {
    if (address.length <= 12) return address;
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  }

  private static formatNumber(num: number, decimals: number): string {
    return num.toFixed(decimals);
  }

  private static formatPercent(num: number): string {
    return `${num >= 0 ? '+' : ''}${num.toFixed(2)}%`;
  }

  private static formatTimestamp(date: Date): string {
    return date.toISOString().replace('T', ' ').substring(0, 19);
  }

  private static formatDuration(start: Date, end: Date): string {
    const ms = end.getTime() - start.getTime();
    const hours = Math.floor(ms / (1000 * 60 * 60));
    const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  }

  private static getConvictionTier(conviction: number): string {
    if (conviction >= 85) return 'HIGH';
    if (conviction >= 70) return 'MEDIUM';
    if (conviction >= 50) return 'LOW';
    return 'REJECT';
  }

  private static getRegimeEmoji(regime: MarketRegime): string {
    const emojiMap: Record<MarketRegime, string> = {
      FULL: '🟢',
      CAUTIOUS: '🟡',
      DEFENSIVE: '🟠',
      PAUSE: '🔴',
    };
    return emojiMap[regime] || '⚪';
  }

  private static getRegimeImpact(regime: MarketRegime): string {
    const impactMap: Record<MarketRegime, string> = {
      FULL: 'Normal trading, full position sizes',
      CAUTIOUS: 'Reduced position sizes by 50%, raised conviction threshold',
      DEFENSIVE: 'Only 90+ conviction trades, 1% max position',
      PAUSE: 'No new entries, managing existing positions only',
    };
    return impactMap[regime] || 'Unknown impact';
  }
}
