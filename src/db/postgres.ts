import { Pool, PoolClient, QueryResult } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';
import { logger } from '../utils/logger';

/**
 * PostgreSQL Connection Manager
 *
 * Provides connection pooling, query utilities, and schema initialization.
 * Used for storing trades, smart wallets, safety data, and learning engine data.
 */

let pool: Pool | null = null;

/**
 * Initialize PostgreSQL connection pool
 */
export function initializePostgres(): Pool {
  if (pool) {
    return pool;
  }

  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  pool = new Pool({
    connectionString,
    max: 20, // Maximum pool size
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000, // 10 seconds - more resilient for cold starts
    ssl: connectionString.includes('render.com') || connectionString.includes('dpg-') ? {
      rejectUnauthorized: false // Required for Render PostgreSQL
    } : false
  });

  // Handle pool errors
  pool.on('error', (err) => {
    logger.error('Unexpected PostgreSQL pool error', { error: err.message });
  });

  // Handle connection events
  pool.on('connect', () => {
    logger.debug('New PostgreSQL connection established');
  });

  logger.info('PostgreSQL connection pool initialized');

  return pool;
}

/**
 * Get PostgreSQL connection pool
 */
export function getPool(): Pool {
  if (!pool) {
    throw new Error('PostgreSQL pool not initialized. Call initializePostgres() first.');
  }
  return pool;
}

/**
 * Execute a query with automatic connection management
 */
export async function query<T extends import("pg").QueryResultRow = any>(
  text: string,
  params?: any[]
): Promise<QueryResult<T>> {
  const pool = getPool();

  try {
    const start = Date.now();
    const result = await pool.query<T>(text, params);
    const duration = Date.now() - start;

    logger.debug('Executed query', {
      text: text.substring(0, 100),
      duration,
      rows: result.rowCount
    });

    return result;
  } catch (error: any) {
    logger.error('Database query error', {
      error: error.message,
      query: text.substring(0, 100),
      params: params ? JSON.stringify(params).substring(0, 100) : undefined
    });
    throw error;
  }
}

/**
 * Get a client from the pool for transaction support
 */
export async function getClient(): Promise<PoolClient> {
  const pool = getPool();
  return await pool.connect();
}

/**
 * Execute a transaction with automatic rollback on error
 */
export async function transaction<T>(
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await getClient();

  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Transaction rolled back', { error: error.message });
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Initialize database schema
 */
export async function initializeSchema(): Promise<void> {
  try {
    // First, run the fix script to ensure all tables exist with IF NOT EXISTS
    const fixScriptPath = join(__dirname, '../../database/fix_missing_tables.sql');
    try {
      const fixScript = readFileSync(fixScriptPath, 'utf-8');
      await query(fixScript);
      logger.info('Database schema fix applied successfully');
    } catch (error: any) {
      // Fix script might not exist or have errors, continue anyway
      logger.debug('Fix script not applied', { error: error.message });
    }

    // Check if core tables exist
    const tableCheck = await query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'cache'
      ) as cache_exists,
      EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'smart_wallets'
      ) as smart_wallets_exists
    `);

    const { cache_exists, smart_wallets_exists } = tableCheck.rows[0];

    // If core tables exist, we're good
    if (cache_exists && smart_wallets_exists) {
      logger.info('Database schema already exists');
      return;
    }

    // If not, try to run the main schema
    const schemaPath = join(__dirname, '../../database/schema.sql');
    const schema = readFileSync(schemaPath, 'utf-8');

    logger.info('Loading database schema...');

    try {
      await query(schema);
      logger.info('Database schema initialized successfully');
    } catch (error: any) {
      // If tables already exist, that's fine
      if (error.message.includes('already exists')) {
        logger.info('Database schema already exists');
      } else {
        logger.error('Failed to initialize database schema', { error: error.message });
        throw error;
      }
    }
  } catch (error: any) {
    logger.error('Failed to initialize database schema', { error: error.message });
    throw error;
  }
}

/**
 * Check database connection health
 */
export async function healthCheck(): Promise<boolean> {
  try {
    const result = await query('SELECT 1 as health');
    return result.rows[0].health === 1;
  } catch (error) {
    logger.error('Database health check failed', { error });
    return false;
  }
}

/**
 * Close all connections
 */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    logger.info('PostgreSQL connection pool closed');
  }
}

/**
 * Repository pattern helpers
 */
export const db = {
  query,
  getClient,
  transaction,
  getPool,
};
