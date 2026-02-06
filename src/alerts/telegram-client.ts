import TelegramBot from 'node-telegram-bot-api';
import { logger } from '../utils/logger';

export type AlertPriority = 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW';

export interface FormattedMessage {
  text: string;
  priority: AlertPriority;
  parseMode?: 'Markdown' | 'HTML';
}

export interface TelegramStats {
  sent: number;
  failed: number;
  lastSent: Date | null;
}

/**
 * Telegram Client
 *
 * Interfaces with Telegram Bot API to send formatted messages.
 * Features:
 * - Rate limiting (30 messages/second with token bucket)
 * - Retry logic (3 attempts with exponential backoff)
 * - CRITICAL alerts bypass rate limits
 * - Graceful degradation if credentials missing
 */
export class TelegramClient {
  private bot: TelegramBot | null = null;
  private chatId: string | null = null;
  private enabled = false;

  // Rate limiting - token bucket (30 tokens, refill 30/second)
  private tokens = 30;
  private maxTokens = 30;
  private refillRate = 30; // tokens per second
  private lastRefill = Date.now();

  // Track interval for cleanup (memory leak prevention)
  private refillInterval: NodeJS.Timeout | null = null;

  // Stats
  private stats: TelegramStats = {
    sent: 0,
    failed: 0,
    lastSent: null,
  };

  constructor() {
    // Constructor is empty - initialization happens in initialize()
  }

  /**
   * Initialize the Telegram client
   * Gracefully handles missing credentials
   */
  async initialize(): Promise<void> {
    try {
      const token = process.env.TELEGRAM_BOT_TOKEN;
      this.chatId = process.env.TELEGRAM_CHAT_ID || null;
      const enabledEnv = process.env.ENABLE_TELEGRAM !== 'false'; // default true

      if (!token || !this.chatId) {
        logger.info('Telegram credentials not configured - alerts disabled');
        this.enabled = false;
        return;
      }

      if (!enabledEnv) {
        logger.info('Telegram alerts disabled via ENABLE_TELEGRAM=false');
        this.enabled = false;
        return;
      }

      // Initialize bot
      this.bot = new TelegramBot(token, { polling: false });

      // Test connection by getting bot info
      const me = await this.bot.getMe();
      logger.info('✅ Telegram client initialized', { botUsername: me.username });

      this.enabled = true;

      // Start token refill interval (tracked for cleanup)
      this.refillInterval = setInterval(() => this.refillTokens(), 100); // Refill every 100ms

    } catch (error: any) {
      logger.error('Failed to initialize Telegram client', { error: error.message });
      this.enabled = false;
    }
  }

  /**
   * Send a simple text message
   */
  async sendMessage(text: string, priority: AlertPriority = 'NORMAL'): Promise<boolean> {
    if (!this.enabled || !this.bot || !this.chatId) {
      return false;
    }

    return this.sendFormattedMessage({ text, priority, parseMode: 'Markdown' });
  }

  /**
   * Send a formatted message with retry logic
   */
  async sendFormattedMessage(message: FormattedMessage): Promise<boolean> {
    if (!this.enabled || !this.bot || !this.chatId) {
      return false;
    }

    // Check rate limit (CRITICAL bypasses)
    if (message.priority !== 'CRITICAL' && !this.consumeToken()) {
      logger.warn('Telegram rate limit reached, message queued', { priority: message.priority });
      // In a production system, this would queue the message
      // For now, we'll try to send anyway after a short delay
      await new Promise(resolve => setTimeout(resolve, 100));
      if (!this.consumeToken()) {
        logger.warn('Telegram rate limit still exceeded, dropping message');
        return false;
      }
    }

    // Retry logic: 3 attempts with exponential backoff
    const maxAttempts = 3;
    const delays = [1000, 2000, 4000]; // 1s, 2s, 4s

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        await this.bot.sendMessage(this.chatId, message.text, {
          parse_mode: message.parseMode || 'Markdown',
          disable_web_page_preview: true,
        });

        this.stats.sent++;
        this.stats.lastSent = new Date();

        if (attempt > 0) {
          logger.info('Telegram message sent after retry', { attempt: attempt + 1 });
        }

        return true;

      } catch (error: any) {
        logger.error('Failed to send Telegram message', {
          attempt: attempt + 1,
          error: error.message,
          priority: message.priority,
        });

        // If not last attempt, wait before retry
        if (attempt < maxAttempts - 1) {
          await new Promise(resolve => setTimeout(resolve, delays[attempt]));
        }
      }
    }

    // All attempts failed
    this.stats.failed++;
    logger.error('Telegram message failed after all retries', { priority: message.priority });
    return false;
  }

  /**
   * Check if Telegram is enabled and configured
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Get statistics
   */
  getStats(): TelegramStats {
    return { ...this.stats };
  }

  /**
   * Get bot instance (for commands)
   */
  getBot(): TelegramBot | null {
    return this.bot;
  }

  /**
   * Get configured chat ID
   */
  getChatId(): string | null {
    return this.chatId;
  }

  /**
   * Stop the client and cleanup resources
   */
  stop(): void {
    if (this.refillInterval) {
      clearInterval(this.refillInterval);
      this.refillInterval = null;
    }
    this.enabled = false;
    logger.info('Telegram client stopped');
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
