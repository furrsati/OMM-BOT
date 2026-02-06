import { Connection, ConnectionConfig } from '@solana/web3.js';
import { RPCProvider } from '../types';
import { logger, logRPCFailover } from '../utils/logger';
import { rateLimitedRPC } from '../utils/rate-limiter';

export class SolanaRPCManager {
  private providers: RPCProvider[];
  private connections: Map<string, Connection>;
  private currentProviderIndex: number = 0;
  private healthCheckInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.providers = this.initializeProviders();
    this.connections = new Map();
    this.initializeConnections();
    this.startHealthChecks();
  }

  private initializeProviders(): RPCProvider[] {
    const providers: RPCProvider[] = [];

    if (process.env.SOLANA_RPC_PRIMARY) {
      providers.push({
        name: 'Primary (Helius)',
        url: process.env.SOLANA_RPC_PRIMARY,
        priority: 1,
        isHealthy: true,
        lastCheck: new Date(),
        failureCount: 0,
      });
    }

    if (process.env.SOLANA_RPC_SECONDARY) {
      providers.push({
        name: 'Secondary',
        url: process.env.SOLANA_RPC_SECONDARY,
        priority: 2,
        isHealthy: true,
        lastCheck: new Date(),
        failureCount: 0,
      });
    }

    if (process.env.SOLANA_RPC_TERTIARY) {
      providers.push({
        name: 'Tertiary',
        url: process.env.SOLANA_RPC_TERTIARY,
        priority: 3,
        isHealthy: true,
        lastCheck: new Date(),
        failureCount: 0,
      });
    }

    if (providers.length === 0) {
      throw new Error('No RPC providers configured. Please set environment variables.');
    }

    // Sort by priority
    providers.sort((a, b) => a.priority - b.priority);

    logger.info(`Initialized ${providers.length} RPC providers`, {
      providers: providers.map((p) => ({ name: p.name, priority: p.priority })),
    });

    return providers;
  }

  private initializeConnections(): void {
    const config: ConnectionConfig = {
      commitment: 'confirmed',
      confirmTransactionInitialTimeout: 60000,
    };

    for (const provider of this.providers) {
      const connection = new Connection(provider.url, config);
      this.connections.set(provider.name, connection);
    }
  }

  /**
   * Get the current active connection
   */
  public getCurrentConnection(): Connection {
    const provider = this.providers[this.currentProviderIndex];
    const connection = this.connections.get(provider.name);

    if (!connection) {
      throw new Error(`Connection not found for provider: ${provider.name}`);
    }

    return connection;
  }

  /**
   * Get the current provider info
   */
  public getCurrentProvider(): RPCProvider {
    return this.providers[this.currentProviderIndex];
  }

  /**
   * Execute an operation with automatic failover
   */
  public async withFailover<T>(
    operation: (connection: Connection) => Promise<T>,
    maxRetries: number = 3
  ): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const provider = this.providers[this.currentProviderIndex];
      const connection = this.connections.get(provider.name);

      if (!connection) {
        this.markProviderUnhealthy(provider);
        this.failoverToNext();
        continue;
      }

      try {
        const result = await operation(connection);
        // Success - reset failure count
        provider.failureCount = 0;
        return result;
      } catch (error: any) {
        lastError = error;
        logger.error(`RPC operation failed on ${provider.name}`, {
          error: error.message,
          attempt: attempt + 1,
          maxRetries,
        });

        // Increment failure count
        provider.failureCount++;

        // If too many failures, mark as unhealthy
        if (provider.failureCount >= 3) {
          this.markProviderUnhealthy(provider);
        }

        // Try failover to next provider
        const failedOver = this.failoverToNext();
        if (!failedOver) {
          // No more healthy providers
          throw new Error('All RPC providers failed. Cannot continue.');
        }
      }
    }

    throw lastError || new Error('Operation failed after maximum retries');
  }

  /**
   * Failover to the next available provider
   */
  private failoverToNext(): boolean {
    const currentProvider = this.providers[this.currentProviderIndex];
    let nextIndex = (this.currentProviderIndex + 1) % this.providers.length;
    let attempts = 0;

    // Try to find a healthy provider
    while (attempts < this.providers.length) {
      const nextProvider = this.providers[nextIndex];

      if (nextProvider.isHealthy) {
        logRPCFailover(currentProvider.name, nextProvider.name);
        this.currentProviderIndex = nextIndex;
        return true;
      }

      nextIndex = (nextIndex + 1) % this.providers.length;
      attempts++;
    }

    // No healthy providers found
    logger.error('All RPC providers are unhealthy');
    return false;
  }

  /**
   * Mark a provider as unhealthy
   */
  private markProviderUnhealthy(provider: RPCProvider): void {
    provider.isHealthy = false;
    provider.lastCheck = new Date();
    logger.warn(`Marked provider ${provider.name} as unhealthy`);
  }

  /**
   * Start periodic health checks
   */
  private startHealthChecks(): void {
    // Check every 60 seconds (reduced from 30s to save rate limit quota)
    this.healthCheckInterval = setInterval(() => {
      this.performHealthChecks();
    }, 60000);

    // Perform initial check after a short delay to let main operations start first
    setTimeout(() => this.performHealthChecks(), 5000);
  }

  /**
   * Perform health checks on all providers
   */
  private async performHealthChecks(): Promise<void> {
    for (const provider of this.providers) {
      const connection = this.connections.get(provider.name);
      if (!connection) continue;

      try {
        // Simple health check: get recent blockhash (rate limited to avoid 429s)
        const start = Date.now();
        await rateLimitedRPC(
          () => connection.getLatestBlockhash(),
          0  // Low priority - don't compete with trading operations
        );
        const latency = Date.now() - start;

        // If previously unhealthy, mark as healthy again
        if (!provider.isHealthy) {
          provider.isHealthy = true;
          provider.failureCount = 0;
          logger.info(`Provider ${provider.name} is healthy again (latency: ${latency}ms)`);
        }

        provider.lastCheck = new Date();
      } catch (error: any) {
        logger.warn(`Health check failed for ${provider.name}`, { error: error.message });
        provider.failureCount++;

        if (provider.failureCount >= 3) {
          this.markProviderUnhealthy(provider);
        }
      }
    }
  }

  /**
   * Get status of all providers
   */
  public getProvidersStatus(): RPCProvider[] {
    return this.providers.map((p) => ({ ...p }));
  }

  /**
   * Stop health checks (cleanup)
   */
  public stop(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    logger.info('RPC Manager stopped');
  }
}

// Singleton instance
let rpcManagerInstance: SolanaRPCManager | null = null;

export const getRPCManager = (): SolanaRPCManager => {
  if (!rpcManagerInstance) {
    rpcManagerInstance = new SolanaRPCManager();
  }
  return rpcManagerInstance;
};
