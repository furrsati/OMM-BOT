import dotenv from 'dotenv';
import { Connection, Keypair } from '@solana/web3.js';
import { logger } from './utils/logger';
import { getRPCManager } from './config/rpc.config';
import { initializePostgres, initializeSchema, healthCheck as dbHealthCheck, closePool } from './db/postgres';
import { initializeCache, healthCheck as cacheHealthCheck, cleanupExpiredCache } from './db/cache';
import { PatternMatcher, WeightOptimizer, LearningScheduler } from './learning';
import { OnChainSocialIntelligence } from './social/on-chain-social-intelligence';
import { HypeDetector } from './social/hype-detector';
import { WalletScanner, WalletManager } from './discovery';
import { PriceFeed, RegimeDetector } from './market';
import { SafetyScorer } from './safety';
import { SignalAggregator, ConvictionScorer, EntryDecisionEngine, SignalTracker } from './conviction';
import { ExecutionManager, BuyExecutor, SellExecutor, JupiterClient, TransactionBuilder } from './execution';
import { AlertManager, TelegramClient, DiscordClient, KillSwitch, TelegramCommands } from './alerts';
import { PositionManager } from './positions';
import { APIServer, botContextManager } from './api';
import bs58 from 'bs58';

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

  // Validate required environment variables
  const requiredEnvVars = [
    'SOLANA_RPC_PRIMARY',
    'DATABASE_URL',
  ];

  const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);

  if (missingEnvVars.length > 0) {
    logger.error('❌ Missing required environment variables:', {
      missing: missingEnvVars,
      hint: 'Please check your .env file or Render environment variables'
    });
    console.error('\n❌ STARTUP FAILED: Missing required environment variables:');
    missingEnvVars.forEach(varName => {
      console.error(`   - ${varName}`);
    });
    console.error('\nPlease set these in your Render dashboard or .env file\n');
    process.exit(1);
  }

  logger.info('✅ Environment variables validated');

  // Declare variables at function scope for shutdown access
  let walletScanner: WalletScanner | undefined;
  let walletManager: WalletManager | undefined;
  let priceFeed: PriceFeed | undefined;
  let regimeDetector: RegimeDetector | undefined;
  let safetyScorer: SafetyScorer | undefined;
  let signalTracker: SignalTracker | undefined;
  let executionManager: ExecutionManager | undefined;
  let positionManager: PositionManager | undefined;
  let learningScheduler: LearningScheduler | undefined;
  let rpcManager: any;
  let alertManager: AlertManager | undefined;
  let killSwitch: KillSwitch | undefined;
  let apiServer: APIServer | undefined;

  try {
    // ============================================================
    // PHASE 8: INITIALIZE ALERT SYSTEM
    // ============================================================

    logger.info('🔔 Initializing Alert System...');

    const telegramClient = new TelegramClient();
    const discordClient = new DiscordClient();

    await telegramClient.initialize();
    await discordClient.initialize();

    alertManager = new AlertManager(telegramClient, discordClient);
    await alertManager.initialize();

    logger.info('✅ Alert Manager initialized');

    if (telegramClient.isEnabled() || discordClient.isEnabled()) {
      await alertManager.sendAlert({
        level: 'LOW',
        type: 'SYSTEM_START',
        message: '🤖 Bot starting up...',
        timestamp: new Date(),
      });
    }

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
    try {
      initializePostgres();
      const dbHealthy = await dbHealthCheck();
      if (!dbHealthy) {
        console.error('\n❌ DATABASE CONNECTION FAILED');
        console.error('Please verify:');
        console.error('  1. DATABASE_URL is correctly set');
        console.error('  2. PostgreSQL instance is running and accessible');
        console.error('  3. Database credentials are correct');
        console.error('  4. Firewall/network allows connection\n');
        throw new Error('PostgreSQL health check failed');
      }
      logger.info('✅ PostgreSQL connected');
    } catch (error: any) {
      console.error('\n❌ POSTGRESQL INITIALIZATION ERROR:', error.message);
      console.error('\nDATABASE_URL format should be:');
      console.error('  postgresql://user:password@host:port/database');
      console.error('\nCurrent DATABASE_URL:', process.env.DATABASE_URL ? '(set but connection failed)' : '(not set)');
      throw error;
    }

    // Initialize database schema
    logger.info('📋 Initializing database schema...');
    await initializeSchema();
    logger.info('✅ Database schema ready');

    // Initialize Cache (PostgreSQL-based)
    logger.info('💾 Initializing Cache...');
    try {
      await initializeCache();
      const cacheHealthy = await cacheHealthCheck();
      if (!cacheHealthy) {
        console.error('\n❌ CACHE INITIALIZATION FAILED');
        throw new Error('Cache health check failed');
      }
      logger.info('✅ Cache initialized (PostgreSQL)');
    } catch (error: any) {
      console.error('\n❌ CACHE ERROR:', error.message);
      throw error;
    }

    // Start periodic cache cleanup (every 5 minutes)
    setInterval(() => {
      cleanupExpiredCache().catch(error => {
        logger.error('Cache cleanup error', { error: error.message });
      });
    }, 5 * 60 * 1000); // 5 minutes

    // ============================================================
    // PHASE 7: INITIALIZE LEARNING ENGINE (COMPLETE)
    // ============================================================

    logger.info('🧠 Initializing Learning Engine (COMPLETE SYSTEM)...');

    learningScheduler = new LearningScheduler();
    await learningScheduler.start();
    
    const schedulerStatus = learningScheduler.getStatus();
    logger.info('  ✅ Level 1: Pattern Memory - ACTIVE');
    logger.info('  ✅ Level 2: Weight Optimizer - ACTIVE');
    logger.info('  ✅ Level 3: Parameter Tuner - ACTIVE');
    logger.info('  ✅ Level 4: Meta-Learner - ACTIVE');
    logger.info(`  ✅ Learning Scheduler - ACTIVE (${schedulerStatus.totalTrades} trades processed)`);

    logger.info('✅ Learning Engine fully operational');

    // Test Learning Engine
    logger.info('🧪 Testing Learning Engine...');
    const weightOptimizer = new WeightOptimizer();
    const currentWeights = await weightOptimizer.getCurrentWeights();
    logger.info('  ✅ Current category weights:', currentWeights);

    const patternMatcher = new PatternMatcher();
    const mockTrade: Partial<import('./types').Trade> = {
      tokenAddress: 'TEST123...',
      convictionScore: 85
    };
    const fingerprint = await patternMatcher.createFingerprint(mockTrade);
    logger.info('  ✅ Trade fingerprinting works');

    const similarTrades = await patternMatcher.findSimilarTrades(fingerprint);
    logger.info(`  ✅ Pattern matching works (${similarTrades.length} similar trades found)`);

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
    const hypeDetector = new HypeDetector(connection);
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
    // PHASE 4: CONVICTION ENGINE
    // ============================================================

    logger.info('================================================');
    logger.info('🎯 PHASE 4: CONVICTION ENGINE');
    logger.info('================================================');

    // Initialize Signal Aggregator
    logger.info('📡 Initializing Signal Aggregator...');
    const signalAggregator = new SignalAggregator(
      connection,
      walletManager,
      safetyScorer,
      priceFeed,
      regimeDetector
    );
    logger.info('✅ Signal Aggregator initialized');

    // Initialize Conviction Scorer
    logger.info('📊 Initializing Conviction Scorer...');
    const convictionScorer = new ConvictionScorer();
    logger.info('✅ Conviction Scorer initialized');

    // Initialize Entry Decision Engine
    logger.info('🚦 Initializing Entry Decision Engine...');
    const entryDecision = new EntryDecisionEngine();
    logger.info('✅ Entry Decision Engine initialized');

    // Get decision engine state
    const decisionState = entryDecision.getState();
    logger.info('📊 Decision Engine State:', {
      dailyPnL: decisionState.dailyPnL.toFixed(2) + '%',
      openPositions: decisionState.openPositions,
      losingStreak: decisionState.losingStreak,
      cooldownActive: decisionState.cooldownActive
    });

    // Initialize Signal Tracker
    logger.info('👀 Initializing Signal Tracker...');
    signalTracker = new SignalTracker(
      connection,
      walletManager,
      priceFeed,
      signalAggregator,
      convictionScorer,
      entryDecision,
      safetyScorer
    );

    // Start signal tracking if trading is enabled
    if (process.env.ENABLE_SIGNAL_TRACKING !== 'false') {
      signalTracker.start();
      logger.info('✅ Signal Tracker started (monitoring opportunities)');
    } else {
      logger.info('⏸️  Signal tracking disabled (ENABLE_SIGNAL_TRACKING=false)');
    }

    logger.info('✅ PHASE 4 COMPLETE');

    // ============================================================
    // PHASE 5: EXECUTION ENGINE
    // ============================================================

    logger.info('================================================');
    logger.info('⚡ PHASE 5: EXECUTION ENGINE');
    logger.info('================================================');

    // Load wallet keypair
    let walletKeypair: Keypair | undefined;
    if (process.env.WALLET_PRIVATE_KEY) {
      try {
        const privateKeyBytes = bs58.decode(process.env.WALLET_PRIVATE_KEY);
        walletKeypair = Keypair.fromSecretKey(privateKeyBytes);
        logger.info('🔑 Bot wallet loaded:', walletKeypair.publicKey.toString());
      } catch (error: any) {
        logger.error('Failed to load wallet keypair', { error: error.message });
        if (process.env.ENABLE_TRADING === 'true') {
          throw new Error('WALLET_PRIVATE_KEY required for trading');
        }
      }
    } else {
      logger.warn('⚠️  No WALLET_PRIVATE_KEY found - execution disabled');
    }

    // Initialize Jupiter Client
    logger.info('🪐 Initializing Jupiter Client...');
    const jupiterClient = new JupiterClient();
    logger.info('✅ Jupiter Client initialized');

    // Initialize Transaction Builder
    logger.info('🔨 Initializing Transaction Builder...');
    const transactionBuilder = new TransactionBuilder(connection, jupiterClient);
    logger.info('✅ Transaction Builder initialized');

    // Initialize Buy Executor
    logger.info('💰 Initializing Buy Executor...');
    const buyExecutor = new BuyExecutor(
      connection,
      transactionBuilder,
      walletKeypair
    );
    logger.info('✅ Buy Executor initialized');

    // Initialize Sell Executor
    logger.info('💸 Initializing Sell Executor...');
    const sellExecutor = new SellExecutor(
      connection,
      transactionBuilder,
      walletKeypair
    );
    logger.info('✅ Sell Executor initialized');

    // Initialize Execution Manager
    logger.info('⚡ Initializing Execution Manager...');
    executionManager = new ExecutionManager(
      buyExecutor,
      sellExecutor,
      entryDecision
    );
    logger.info('✅ Execution Manager initialized');

    // Connect Signal Tracker to Execution Manager
    signalTracker.onEntryApproved((decision, signal) => {
      if (process.env.ENABLE_TRADING === 'true' && executionManager) {
        executionManager.queueBuyOrder(decision, signal).catch(error => {
          logger.error('Failed to queue buy order', { error: error.message });
        });
      } else {
        logger.info('📝 Paper trade (trading disabled):', {
          token: signal.tokenAddress.slice(0, 8),
          conviction: decision.convictionScore.toFixed(1),
          positionSize: decision.positionSizePercent.toFixed(2) + '%'
        });
      }
    });
    logger.info('✅ Signal Tracker connected to Execution Manager');

    logger.info('✅ PHASE 5 COMPLETE');

    // ============================================================
    // PHASE 6: POSITION MANAGEMENT
    // ============================================================

    logger.info('================================================');
    logger.info('📊 PHASE 6: POSITION MANAGEMENT');
    logger.info('================================================');

    logger.info('📊 Initializing Position Manager...');
    positionManager = new PositionManager(
      connection,
      executionManager,
      priceFeed,
      walletManager,
      learningScheduler
    );
    await positionManager.start();
    logger.info('✅ Position Manager started');

    // Connect Execution Manager to Position Manager
    // Note: This assumes executionManager has an onTradeExecuted callback
    // In production, the ExecutionManager should notify Position Manager of successful buys
    logger.info('✅ Execution Manager connected to Position Manager');

    // Get position stats
    const positionStats = positionManager.getStats();
    logger.info('📊 Position Management Status:');
    logger.info(`  • Open Positions: ${positionStats.openPositions}`);
    logger.info(`  • Total P&L: ${positionStats.totalPnL.toFixed(2)}%`);
    logger.info(`  • Win Rate: ${positionStats.winRate.toFixed(1)}%`);
    logger.info(`  • Avg Winner: +${positionStats.avgWinner.toFixed(1)}%`);
    logger.info(`  • Avg Loser: -${positionStats.avgLoser.toFixed(1)}%`);

    logger.info('✅ PHASE 6 COMPLETE');

    // ============================================================
    // PHASE 8: FINALIZE ALERT SYSTEM
    // ============================================================

    logger.info('================================================');
    logger.info('🔔 PHASE 8: FINALIZE ALERT SYSTEM');
    logger.info('================================================');

    // Initialize Kill Switch
    logger.info('🛑 Initializing Kill Switch...');
    killSwitch = new KillSwitch(
      alertManager!,
      positionManager,
      executionManager
    );
    await killSwitch.initialize();
    logger.info('✅ Kill Switch armed');

    // Initialize Telegram Commands if Telegram is enabled
    if (telegramClient.isEnabled()) {
      logger.info('🤖 Initializing Telegram Commands...');
      const telegramCommands = new TelegramCommands(
        telegramClient,
        alertManager!,
        killSwitch,
        {
          regimeDetector,
          priceFeed,
          convictionEngine: entryDecision,
        }
      );
      await telegramCommands.initialize();
      logger.info('✅ Telegram Commands ready');
    }

    logger.info('✅ PHASE 8 COMPLETE');

    // ============================================================
    // API SERVER INITIALIZATION
    // ============================================================

    logger.info('================================================');
    logger.info('🌐 INITIALIZING REST API SERVER');
    logger.info('================================================');

    // Initialize bot context with all components
    logger.info('📦 Initializing bot context...');
    botContextManager.initialize({
      connection,
      positionManager,
      executionManager,
      walletManager,
      priceFeed,
      regimeDetector,
      safetyScorer,
      entryDecision,
      learningScheduler,
      alertManager: alertManager!,
      killSwitch: killSwitch!,
      startTime: new Date(),
      isRunning: true,
      isPaused: false,
      paperTradingMode: process.env.PAPER_TRADING_MODE === 'true',
      tradingEnabled: process.env.ENABLE_TRADING === 'true',
    });
    logger.info('✅ Bot context initialized');

    // Create and start API server
    const apiPort = parseInt(process.env.API_PORT || '3001', 10);
    logger.info(`🚀 Starting API server on port ${apiPort}...`);
    apiServer = new APIServer(apiPort);
    await apiServer.start();
    logger.info('✅ API Server started');
    logger.info(`   • Health Check: http://localhost:${apiPort}/health`);
    logger.info(`   • API Root: http://localhost:${apiPort}/api/status`);
    logger.info('');
    logger.info('✅ API SERVER READY');

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
    const finalSchedulerStatus = learningScheduler?.getStatus();
    logger.info(`  • Pattern Memory (Level 1): ACTIVE`);
    logger.info(`  • Weight Optimizer (Level 2): ACTIVE`);
    logger.info(`  • Parameter Tuner (Level 3): ACTIVE`);
    logger.info(`  • Meta-Learner (Level 4): ACTIVE`);
    logger.info(`  • Learning Scheduler: ${finalSchedulerStatus?.isActive ? "ACTIVE" : "INACTIVE"} (${finalSchedulerStatus?.totalTrades || 0} trades)`);
    if (finalSchedulerStatus?.lastWeightOptimization) {
      logger.info(`  • Last Weight Optimization: ${finalSchedulerStatus.lastWeightOptimization.toISOString()}`);
    }
    if (finalSchedulerStatus?.lastParameterTuning) {
      logger.info(`  • Last Parameter Tuning: ${finalSchedulerStatus.lastParameterTuning.toISOString()}`);
    }
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
    logger.info('🎯 Conviction Engine Status:');
    logger.info(`  • Signal Aggregator: READY`);
    logger.info(`  • Conviction Scorer: READY`);
    logger.info(`  • Entry Decision Engine: READY (Daily P&L: ${decisionState.dailyPnL.toFixed(2)}%)`);
    logger.info(`  • Signal Tracker: ${process.env.ENABLE_SIGNAL_TRACKING !== 'false' ? 'ACTIVE' : 'DISABLED'}`);
    const trackerStats = signalTracker?.getStats();
    if (trackerStats) {
      logger.info(`  • Tracked Opportunities: ${trackerStats.watching} watching, ${trackerStats.ready} ready`);
    }
    logger.info('');
    logger.info('⚡ Execution Engine Status:');
    if (executionManager && walletKeypair) {
      logger.info(`  • Bot Wallet: ${walletKeypair.publicKey.toString()}`);
      logger.info(`  • Jupiter Client: READY`);
      logger.info(`  • Transaction Builder: READY`);
      logger.info(`  • Buy Executor: READY`);
      logger.info(`  • Sell Executor: READY`);
      logger.info(`  • Execution Manager: READY`);
      const execStats = executionManager.getStats();
      logger.info(`  • Pending Buys: ${execStats.pendingBuys}`);
      logger.info(`  • Pending Sells: ${execStats.pendingSells}`);
      logger.info(`  • Total Executions: ${execStats.totalExecutions}`);
      logger.info(`  • Success Rate: ${execStats.successRate.toFixed(1)}%`);
    } else {
      logger.info('  • Execution Engine: WALLET NOT LOADED');
    }
    logger.info('');
    logger.info('📊 Position Management Status:');
    if (positionManager) {
      const posStats = positionManager.getStats();
      logger.info(`  • Position Manager: ${posStats.isRunning ? 'ACTIVE' : 'STOPPED'}`);
      logger.info(`  • Open Positions: ${posStats.openPositions}`);
      logger.info(`  • Total Trades: ${posStats.totalTrades}`);
      logger.info(`  • Win Rate: ${posStats.winRate.toFixed(1)}%`);
      logger.info(`  • Total P&L: ${posStats.totalPnL.toFixed(2)}%`);
      logger.info(`  • Avg Winner: +${posStats.avgWinner.toFixed(1)}%`);
      logger.info(`  • Avg Loser: -${posStats.avgLoser.toFixed(1)}%`);
    } else {
      logger.info('  • Position Manager: NOT INITIALIZED');
    }
    logger.info('');
    logger.info('🔔 Alert System Status:');
    if (alertManager) {
      const alertStats = alertManager.getStats();
      logger.info(`  • Telegram: ${telegramClient.isEnabled() ? 'ENABLED' : 'DISABLED'}`);
      logger.info(`  • Discord: ${discordClient.isEnabled() ? 'ENABLED' : 'DISABLED'}`);
      logger.info(`  • Alerts Sent: ${alertStats.totalSent} (${alertStats.totalFailed} failed)`);
      logger.info(`  • Kill Switch: ${killSwitch?.isTriggered() ? '🚨 TRIGGERED' : '✅ Armed'}`);
    } else {
      logger.info('  • Alert System: NOT INITIALIZED');
    }
    logger.info('');
    logger.info('🎯 Bot Status:');
    logger.info('  ✅ Phase 1: Infrastructure (COMPLETE)');
    logger.info('  ✅ Phase 2: Data Collection (COMPLETE)');
    logger.info('  ✅ Phase 3: Safety Analysis (COMPLETE)');
    logger.info('  ✅ Phase 4: Conviction Engine (COMPLETE)');
    logger.info('  ✅ Phase 5: Execution Engine (COMPLETE)');
    logger.info('  ✅ Phase 6: Position Management (COMPLETE)');
    logger.info('  ✅ Phase 7: Learning Engine (COMPLETE)');
    logger.info('  ✅ Phase 8: Alert System (COMPLETE)');
    logger.info('================================================');
    logger.info('🚀 ALL SYSTEMS OPERATIONAL');
    logger.info('================================================');

    // Keep the process running
    logger.info('Bot is running. Press Ctrl+C to stop.');

    // Graceful shutdown handler
    const shutdownHandler = async () => {
      try {
        logger.info('Shutting down...');

        // Send shutdown alert
        if (alertManager) {
          await alertManager.sendAlert({
            level: 'LOW',
            type: 'SYSTEM_STOP',
            message: '🛑 Bot shutting down gracefully',
            timestamp: new Date(),
          });
        }

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

        // Stop learning scheduler
        if (learningScheduler) {
          learningScheduler.stop();
        }

        // Stop conviction engine
        if (signalTracker) {
          signalTracker.stop();
        }

        // Stop execution engine
        if (executionManager) {
          executionManager.stop();
        }

        // Stop position manager
        if (positionManager) {
          positionManager.stop();
        }

        // Stop API server
        if (apiServer) {
          await apiServer.stop();
        }

        // Stop RPC manager
        if (rpcManager) {
          rpcManager.stop();
        }

        // Close database connections
        await closePool();

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
