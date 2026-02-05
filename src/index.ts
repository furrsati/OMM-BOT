import dotenv from 'dotenv';
import { Connection } from '@solana/web3.js';
import { logger } from './utils/logger';
import { getRPCManager } from './config/rpc.config';
import { initializePostgres, initializeSchema, healthCheck as dbHealthCheck, closePool } from './db/postgres';
import { initializeRedis, healthCheck as redisHealthCheck, closeRedis } from './db/redis';
import { PatternMatcher, WeightOptimizer, ParameterTuner, MetaLearner } from './learning';
import { OnChainSocialIntelligence } from './social/on-chain-social-intelligence';
import { HypeDetector } from './social/hype-detector';
import { WalletScanner, WalletManager } from './discovery';
import { PriceFeed, RegimeDetector } from './market';
import { SafetyScorer } from './safety';

// Load environment variables
dotenv.config();

/**
 * Main entry point for the Solana Memecoin Trading Bot V3.0
 * WITH ADAPTIVE LEARNING ENGINE
 */
async function main() {
  logger.info('🤖 Starting Solana Memecoin Trading Bot V3.0');
  logger.info('🧠 WITH ADAPTIVE LEARNING ENGINE');
  logger.info('================================================');

  // Validate environment
  if (!process.env.SOLANA_RPC_PRIMARY) {
    logger.error('Missing required environment variable: SOLANA_RPC_PRIMARY');
    process.exit(1);
  }

  // Declare variables at function scope for shutdown access
  let walletScanner: WalletScanner | undefined;
  let walletManager: WalletManager | undefined;
  let priceFeed: PriceFeed | undefined;
  let regimeDetector: RegimeDetector | undefined;
  let safetyScorer: SafetyScorer | undefined;
  let rpcManager: any;

  try {
    // ============================================================
    // PHASE 1: INITIALIZE INFRASTRUCTURE
    // ============================================================

    // Initialize RPC Manager
    logger.info('🔌 Initializing RPC Manager...');
    rpcManager = getRPCManager();
    const currentProvider = rpcManager.getCurrentProvider();
    logger.info(`✅ Connected to ${currentProvider.name}`, { url: currentProvider.url });

    // Test RPC connection
    logger.info('🧪 Testing RPC connection...');
    await rpcManager.withFailover(async (connection: Connection) => {
      const slot = await connection.getSlot();
      const blockTime = await connection.getBlockTime(slot);
      logger.info('✅ RPC connection successful', {
        slot,
        blockTime: new Date((blockTime || 0) * 1000).toISOString()
      });
    });

    // Initialize PostgreSQL
    logger.info('🗄️  Initializing PostgreSQL...');
    initializePostgres();
    const dbHealthy = await dbHealthCheck();
    if (!dbHealthy) {
      throw new Error('PostgreSQL health check failed');
    }
    logger.info('✅ PostgreSQL connected');

    // Initialize database schema
    logger.info('📋 Initializing database schema...');
    await initializeSchema();
    logger.info('✅ Database schema ready');

    // Initialize Redis
    logger.info('⚡ Initializing Redis...');
    await initializeRedis();
    const redisHealthy = await redisHealthCheck();
    if (!redisHealthy) {
      throw new Error('Redis health check failed');
    }
    logger.info('✅ Redis connected');

    // ============================================================
    // PHASE 1: INITIALIZE LEARNING ENGINE (SKELETON)
    // ============================================================

    logger.info('🧠 Initializing Learning Engine...');

    const patternMatcher = new PatternMatcher();
    logger.info('  ✅ Level 1: Pattern Matcher (SKELETON)');

    const weightOptimizer = new WeightOptimizer();
    logger.info('  ✅ Level 2: Weight Optimizer (SKELETON)');

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const parameterTuner = new ParameterTuner();
    logger.info('  ✅ Level 3: Parameter Tuner (SKELETON)');

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const metaLearner = new MetaLearner();
    logger.info('  ✅ Level 4: Meta-Learner (SKELETON)');

    logger.info('✅ Learning Engine initialized (full implementation in Phase 7)');

    // Test Learning Engine
    logger.info('🧪 Testing Learning Engine skeleton...');
    const currentWeights = await weightOptimizer.getCurrentWeights();
    logger.info('  ✅ Current category weights:', currentWeights);

    const mockTrade: Partial<import('./types').Trade> = {
      tokenAddress: 'TEST123...',
      convictionScore: 85
    };
    const fingerprint = await patternMatcher.createFingerprint(mockTrade);
    logger.info('  ✅ Trade fingerprinting works (stubbed)');

    const similarTrades = await patternMatcher.findSimilarTrades(fingerprint);
    logger.info('  ✅ Pattern matching works (stubbed, no trades yet)');

    const adjustment = patternMatcher.getPatternMatchAdjustment(similarTrades);
    logger.info('  ✅ Pattern adjustment calculation works:', { adjustment });

    logger.info('✅ Learning Engine test passed');

    // ============================================================
    // PHASE 1: INITIALIZE SOCIAL INTELLIGENCE
    // ============================================================

    logger.info('📊 Initializing On-Chain Social Intelligence...');
    const connection = rpcManager.getCurrentConnection();
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const socialIntelligence = new OnChainSocialIntelligence(connection);
    logger.info('✅ On-Chain Social Intelligence initialized');

    logger.info('📈 Initializing Hype Detector...');
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const hypeDetector = new HypeDetector();
    logger.info('✅ Hype Detector initialized');

    // ============================================================
    // PHASE 2: DATA COLLECTION
    // ============================================================

    logger.info('================================================');
    logger.info('📡 PHASE 2: DATA COLLECTION');
    logger.info('================================================');

    // Initialize Wallet Scanner
    logger.info('🔍 Initializing Smart Wallet Scanner...');
    walletScanner = new WalletScanner(connection);
    logger.info('✅ Smart Wallet Scanner initialized');

    // Initialize Wallet Manager
    logger.info('📋 Initializing Wallet Manager...');
    walletManager = new WalletManager(connection);
    await walletManager.initialize();
    logger.info('✅ Wallet Manager initialized');

    // Initialize Price Feed
    logger.info('📊 Initializing Price Feed...');
    priceFeed = new PriceFeed(connection);
    await priceFeed.start();
    logger.info('✅ Price Feed started');

    // Initialize Regime Detector
    logger.info('🌍 Initializing Market Regime Detector...');
    regimeDetector = new RegimeDetector();
    await regimeDetector.start();
    logger.info('✅ Market Regime Detector started');

    // Wait for initial regime detection
    await new Promise(resolve => setTimeout(resolve, 5000));
    const currentRegime = regimeDetector.getRegimeState();
    logger.info(`Current Market Regime: ${currentRegime.regime}`, {
      solChange: currentRegime.solChange24h.toFixed(2) + '%',
      btcChange: currentRegime.btcChange24h.toFixed(2) + '%',
      reason: currentRegime.reason
    });

    // Start wallet scanner (runs every 6 hours)
    if (process.env.ENABLE_WALLET_SCANNING !== 'false') {
      logger.info('🔍 Starting wallet scanner background process...');
      // Run in background - don't await
      walletScanner.startScanning().catch(error => {
        logger.error('Wallet scanner error', { error: error.message });
      });
      logger.info('✅ Wallet scanner started (background)');
    } else {
      logger.info('⏸️  Wallet scanning disabled (ENABLE_WALLET_SCANNING=false)');
    }

    // Start weekly wallet maintenance
    if (process.env.ENABLE_WALLET_MAINTENANCE !== 'false') {
      logger.info('🔧 Starting weekly wallet maintenance...');
      // Run in background - don't await
      walletManager.startWeeklyMaintenance().catch(error => {
        logger.error('Wallet maintenance error', { error: error.message });
      });
      logger.info('✅ Weekly maintenance started (background)');
    } else {
      logger.info('⏸️  Wallet maintenance disabled (ENABLE_WALLET_MAINTENANCE=false)');
    }

    logger.info('✅ PHASE 2 COMPLETE');

    // ============================================================
    // PHASE 3: SAFETY ANALYSIS
    // ============================================================

    logger.info('================================================');
    logger.info('🛡️  PHASE 3: SAFETY ANALYSIS');
    logger.info('================================================');

    // Initialize Safety Scorer (includes Contract Analyzer, Honeypot Detector, Blacklist Manager)
    logger.info('🛡️  Initializing Safety Scorer...');
    safetyScorer = new SafetyScorer(connection);
    await safetyScorer.initialize();
    logger.info('✅ Safety Scorer initialized');

    // Get blacklist stats
    const blacklistStats = await safetyScorer.getBlacklistManager().getStats();
    logger.info('📊 Blacklist Statistics:', {
      total: blacklistStats.totalEntries,
      wallets: blacklistStats.wallets,
      contracts: blacklistStats.contracts,
      recentlyAdded: blacklistStats.recentlyAdded
    });

    logger.info('✅ PHASE 3 COMPLETE');

    // ============================================================
    // BOT STATUS DISPLAY
    // ============================================================

    logger.info('================================================');
    logger.info('📊 Bot Configuration:');
    logger.info('  Node Environment:', process.env.NODE_ENV || 'development');
    logger.info('  Trading Enabled:', process.env.ENABLE_TRADING === 'true');
    logger.info('  Paper Trading Mode:', process.env.PAPER_TRADING_MODE === 'true');
    logger.info('  Max Position Size:', process.env.MAX_POSITION_SIZE_PERCENT || '5', '%');
    logger.info('  Max Daily Loss:', process.env.MAX_DAILY_LOSS_PERCENT || '8', '%');
    logger.info('  Max Daily Profit:', process.env.MAX_DAILY_PROFIT_PERCENT || '15', '%');
    logger.info('================================================');

    if (process.env.PAPER_TRADING_MODE === 'true') {
      logger.warn('⚠️  PAPER TRADING MODE ACTIVE - No real trades will be executed');
    }

    if (process.env.ENABLE_TRADING !== 'true') {
      logger.warn('⚠️  TRADING DISABLED - Bot running in monitoring mode only');
    }

    logger.info('✅ PHASE 1 COMPLETE');
    logger.info('');
    logger.info('🧠 Learning Engine Status:');
    logger.info('  • Pattern Memory (Level 1): READY (skeleton)');
    logger.info('  • Weight Optimizer (Level 2): READY (skeleton)');
    logger.info('  • Parameter Tuner (Level 3): READY (skeleton)');
    logger.info('  • Meta-Learner (Level 4): READY (skeleton)');
    logger.info('');
    logger.info('📊 Infrastructure Status:');
    logger.info('  • RPC Connection: HEALTHY');
    logger.info('  • PostgreSQL: HEALTHY');
    logger.info('  • Redis: HEALTHY');
    logger.info('  • On-Chain Social Intelligence: READY');
    logger.info('  • Hype Detector: READY');
    logger.info('');
    logger.info('📡 Data Collection Status:');
    logger.info(`  • Smart Wallet Scanner: ${process.env.ENABLE_WALLET_SCANNING !== 'false' ? 'ACTIVE' : 'DISABLED'}`);
    logger.info(`  • Wallet Manager: READY (Watchlist: ${walletManager.getWatchlist().length} wallets)`);
    logger.info(`  • Price Feed: ACTIVE (Monitoring: ${priceFeed.getMonitoredTokens().length} tokens)`);
    logger.info(`  • Market Regime: ${currentRegime.regime} (${currentRegime.reason})`);
    logger.info('');
    logger.info('🛡️  Safety Analysis Status:');
    logger.info(`  • Safety Scorer: READY`);
    logger.info(`  • Contract Analyzer: READY`);
    logger.info(`  • Honeypot Detector: READY`);
    logger.info(`  • Blacklist Manager: READY (${blacklistStats.totalEntries} entries)`);
    logger.info('');
    logger.info('🎯 Next Steps:');
    logger.info('  → Phase 4: Conviction Engine (Scoring system)');
    logger.info('  → Phase 5: Execution Engine (Trade execution)');
    logger.info('  → Phase 6: Position Management (Monitoring, stops)');
    logger.info('  → Phase 7: Learning Engine (Full implementation)');
    logger.info('================================================');

    // TODO: Phase 4 - Initialize conviction engine
    // TODO: Phase 5 - Initialize execution engine
    // TODO: Phase 6 - Initialize position manager
    // TODO: Phase 7 - Complete learning engine implementation
    // TODO: Phase 8 - Initialize alert system

    // Keep the process running
    logger.info('Bot is running. Press Ctrl+C to stop.');

    // Graceful shutdown handler
    const shutdownHandler = async () => {
      try {
        logger.info('Shutting down...');

        // Stop data collection systems
        if (walletScanner) {
          walletScanner.stopScanning();
        }
        if (priceFeed) {
          priceFeed.stop();
        }
        if (regimeDetector) {
          regimeDetector.stop();
        }

        // Stop RPC manager
        if (rpcManager) {
          rpcManager.stop();
        }

        // Close database connections
        await closePool();
        await closeRedis();

        logger.info('✅ Shutdown complete');
        process.exit(0);
      } catch (error: any) {
        logger.error('Error during shutdown', { error: error.message });
        process.exit(1);
      }
    };

    process.on('SIGINT', shutdownHandler);
    process.on('SIGTERM', shutdownHandler);

  } catch (error: any) {
    logger.error('Failed to start bot', { error: error.message, stack: error.stack });
    process.exit(1);
  }
}

// Start the bot
main().catch((error) => {
  logger.error('Unhandled error in main', { error: error.message });
  process.exit(1);
});
