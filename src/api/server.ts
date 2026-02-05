import express, { Express } from 'express';
import { Server } from 'http';
import { corsMiddleware, apiLimiter, errorHandler, notFoundHandler } from './middleware';
import apiRoutes from './routes';
import { logger } from '../utils/logger';
import { botContextManager } from './services/bot-context';

/**
 * API Server
 *
 * REST API for monitoring and controlling the trading bot
 */
export class APIServer {
  private app: Express;
  private server: Server | null = null;
  private port: number;

  constructor(port: number = 3001) {
    this.port = port;
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandlers();
  }

  /**
   * Setup Express middleware
   */
  private setupMiddleware(): void {
    // Trust proxy (required for rate limiting behind Render/reverse proxy)
    this.app.set('trust proxy', 1);

    // Body parsing
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));

    // CORS
    this.app.use(corsMiddleware);

    // Rate limiting
    this.app.use('/api/', apiLimiter);

    // Request logging (development only)
    if (process.env.NODE_ENV === 'development') {
      this.app.use((req, res, next) => {
        logger.debug(`${req.method} ${req.path}`, {
          query: req.query,
          body: req.body,
        });
        next();
      });
    }
  }

  /**
   * Setup API routes
   */
  private setupRoutes(): void {
    // Health check (no /api prefix for monitoring services)
    this.app.get('/health', (req, res) => {
      res.json({
        success: true,
        status: 'healthy',
        timestamp: new Date().toISOString(),
      });
    });

    // API routes
    this.app.use('/api', apiRoutes);

    // Root endpoint
    this.app.get('/', (req, res) => {
      res.json({
        success: true,
        message: 'Solana Memecoin Trading Bot API',
        version: '1.0.0',
        endpoints: {
          health: '/health',
          status: '/api/status',
          positions: '/api/positions',
          trades: '/api/trades',
          metrics: '/api/metrics',
          controls: '/api/controls',
          learning: '/api/learning',
          market: '/api/market',
        },
      });
    });
  }

  /**
   * Setup error handlers (must be last)
   */
  private setupErrorHandlers(): void {
    this.app.use(notFoundHandler);
    this.app.use(errorHandler);
  }

  /**
   * Start the API server
   */
  async start(): Promise<void> {
    // Check if bot context is initialized
    if (!botContextManager.isInitialized()) {
      throw new Error('Bot context not initialized. Call botContextManager.initialize() first.');
    }

    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(this.port, () => {
          logger.info(`🌐 API Server listening on port ${this.port}`);
          logger.info(`   • Health Check: http://localhost:${this.port}/health`);
          logger.info(`   • API Docs: http://localhost:${this.port}/`);
          resolve();
        });

        this.server.on('error', (error) => {
          logger.error('API Server error', { error: error.message });
          reject(error);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Stop the API server
   */
  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }

    return new Promise((resolve, reject) => {
      this.server!.close((error) => {
        if (error) {
          logger.error('Error stopping API server', { error: error.message });
          reject(error);
        } else {
          logger.info('API server stopped');
          resolve();
        }
      });
    });
  }

  /**
   * Get Express app instance (for testing)
   */
  getApp(): Express {
    return this.app;
  }
}
