import { WebhookClient, EmbedBuilder } from 'discord.js';
import { logger } from '../utils/logger';
import type { Alert } from '../types';

export interface DiscordEmbed {
  title: string;
  description: string;
  color: number;
  fields: Array<{ name: string; value: string; inline?: boolean }>;
  timestamp: Date;
  footer?: { text: string };
}

export interface DiscordStats {
  sent: number;
  failed: number;
  lastSent: Date | null;
}

/**
 * Discord Client
 *
 * Interfaces with Discord webhook API to send rich embeds.
 * Features:
 * - Rate limiting (5 messages/second with token bucket)
 * - Retry logic (3 attempts with exponential backoff)
 * - Color-coded embeds by priority
 * - CRITICAL alerts bypass rate limits
 * - Graceful degradation if webhook missing
 */
export class DiscordClient {
  private webhook: WebhookClient | null = null;
  private enabled = false;

  // Rate limiting - token bucket (5 tokens, refill 5/second)
  private tokens = 5;
  private maxTokens = 5;
  private refillRate = 5; // tokens per second
  private lastRefill = Date.now();

  // Stats
  private stats: DiscordStats = {
    sent: 0,
    failed: 0,
    lastSent: null,
  };

  // Color mapping by priority
  private readonly colors = {
    CRITICAL: 0xFF0000, // Red
    HIGH: 0xFFFF00,     // Yellow
    MEDIUM: 0x00FF00,   // Green
    LOW: 0xAAAAAA,      // Gray
  };

  constructor() {
    // Constructor is empty - initialization happens in initialize()
  }

  /**
   * Initialize the Discord client
   * Gracefully handles missing webhook URL
   */
  async initialize(): Promise<void> {
    try {
      const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
      const enabledEnv = process.env.ENABLE_DISCORD !== 'false'; // default true

      if (!webhookUrl) {
        logger.info('Discord webhook not configured - alerts disabled');
        this.enabled = false;
        return;
      }

      if (!enabledEnv) {
        logger.info('Discord alerts disabled via ENABLE_DISCORD=false');
        this.enabled = false;
        return;
      }

      // Initialize webhook client
      this.webhook = new WebhookClient({ url: webhookUrl });

      logger.info('✅ Discord client initialized');
      this.enabled = true;

      // Start token refill interval
      setInterval(() => this.refillTokens(), 100); // Refill every 100ms

    } catch (error: any) {
      logger.error('Failed to initialize Discord client', { error: error.message });
      this.enabled = false;
    }
  }

  /**
   * Send a rich embed
   */
  async sendEmbed(embed: DiscordEmbed): Promise<boolean> {
    if (!this.enabled || !this.webhook) {
      return false;
    }

    // Build Discord embed
    const discordEmbed = new EmbedBuilder()
      .setTitle(embed.title)
      .setDescription(embed.description)
      .setColor(embed.color)
      .setTimestamp(embed.timestamp);

    // Add fields
    for (const field of embed.fields) {
      discordEmbed.addFields({
        name: field.name,
        value: field.value,
        inline: field.inline || false,
      });
    }

    // Add footer if provided
    if (embed.footer) {
      discordEmbed.setFooter({ text: embed.footer.text });
    }

    // Retry logic: 3 attempts with exponential backoff
    const maxAttempts = 3;
    const delays = [1000, 2000, 4000]; // 1s, 2s, 4s

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        await this.webhook.send({
          embeds: [discordEmbed],
        });

        this.stats.sent++;
        this.stats.lastSent = new Date();

        if (attempt > 0) {
          logger.info('Discord embed sent after retry', { attempt: attempt + 1 });
        }

        return true;

      } catch (error: any) {
        logger.error('Failed to send Discord embed', {
          attempt: attempt + 1,
          error: error.message,
        });

        // If not last attempt, wait before retry
        if (attempt < maxAttempts - 1) {
          await new Promise(resolve => setTimeout(resolve, delays[attempt]));
        }
      }
    }

    // All attempts failed
    this.stats.failed++;
    logger.error('Discord embed failed after all retries');
    return false;
  }

  /**
   * Send an alert as a Discord embed
   */
  async sendAlert(alert: Alert): Promise<boolean> {
    if (!this.enabled || !this.webhook) {
      return false;
    }

    // Check rate limit (CRITICAL bypasses)
    if (alert.level !== 'CRITICAL' && !this.consumeToken()) {
      logger.warn('Discord rate limit reached, message queued', { level: alert.level });
      // In a production system, this would queue the message
      // For now, we'll try to send anyway after a short delay
      await new Promise(resolve => setTimeout(resolve, 200));
      if (!this.consumeToken()) {
        logger.warn('Discord rate limit still exceeded, dropping message');
        return false;
      }
    }

    // Build embed from alert
    const embed: DiscordEmbed = {
      title: `${this.getPriorityEmoji(alert.level)} ${alert.type}`,
      description: alert.message,
      color: this.colors[alert.level],
      fields: [],
      timestamp: alert.timestamp,
      footer: { text: 'Solana Memecoin Trading Bot V3.0' },
    };

    // Add data fields if present
    if (alert.data && typeof alert.data === 'object') {
      for (const [key, value] of Object.entries(alert.data)) {
        if (value !== null && value !== undefined) {
          embed.fields.push({
            name: this.formatFieldName(key),
            value: String(value),
            inline: true,
          });
        }
      }
    }

    return this.sendEmbed(embed);
  }

  /**
   * Check if Discord is enabled and configured
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Get statistics
   */
  getStats(): DiscordStats {
    return { ...this.stats };
  }

  /**
   * Get emoji for priority level
   */
  private getPriorityEmoji(level: string): string {
    const emojis: Record<string, string> = {
      CRITICAL: '🔴',
      HIGH: '🟡',
      NORMAL: '🟢',
      LOW: '⚪',
    };
    return emojis[level] || '⚪';
  }

  /**
   * Format field name (convert snake_case to Title Case)
   */
  private formatFieldName(name: string): string {
    return name
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  /**
   * Token bucket rate limiting - refill tokens
   */
  private refillTokens(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000; // seconds
    const tokensToAdd = elapsed * this.refillRate;

    this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }

  /**
   * Token bucket rate limiting - consume a token
   */
  private consumeToken(): boolean {
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }
}
