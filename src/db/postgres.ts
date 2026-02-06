import { Pool, PoolClient, QueryResult } from 'pg';
import { readFileSync, readdirSync, existsSync } from 'fs';
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

  // Determine SSL configuration
  // SECURITY: Always use SSL for remote databases
  const isRemoteDb = connectionString.includes('render.com') ||
    connectionString.includes('dpg-') ||
    connectionString.includes('neon.tech') ||
    connectionString.includes('supabase.co') ||
    !connectionString.includes('localhost');

  // SSL configuration - prefer verified connections
  // Set DATABASE_SSL_REJECT_UNAUTHORIZED=false only if absolutely necessary
  const sslConfig = isRemoteDb ? {
    rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false',
  } : false;

  if (isRemoteDb && process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === 'false') {
    logger.warn('Database SSL certificate verification disabled - this is insecure');
  }

  pool = new Pool({
    connectionString,
    max: 20, // Maximum pool size
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000, // 10 seconds - more resilient for cold starts
    ssl: sslConfig,
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
 * Initialize database schema and run all migrations
 */
export async function initializeSchema(): Promise<void> {
  try {
    // Step 1: Run fix script for critical tables
    const fixScriptPath = join(__dirname, '../../database/fix_missing_tables.sql');
    try {
      const fixScript = readFileSync(fixScriptPath, 'utf-8');
      await query(fixScript);
      logger.info('Database fix script applied');
    } catch (error: any) {
      logger.debug('Fix script skipped', { error: error.message });
    }

    // Step 2: Check if core tables exist, if not run base schema
    const tableCheck = await query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'smart_wallets'
      ) as smart_wallets_exists
    `);

    if (!tableCheck.rows[0].smart_wallets_exists) {
      const schemaPath = join(__dirname, '../../database/schema.sql');
      try {
        const schema = readFileSync(schemaPath, 'utf-8');
        await query(schema);
        logger.info('Base schema initialized');
      } catch (error: any) {
        if (!error.message.includes('already exists')) {
          throw error;
        }
      }
    }

    // Step 3: Run ALL migrations from database/migrations/ directory
    const migrationsDir = join(__dirname, '../../database/migrations');
    if (existsSync(migrationsDir)) {
      const migrationFiles = readdirSync(migrationsDir)
        .filter(file => file.endsWith('.sql'))
        .sort(); // Sort alphabetically to run in order (001, 002, 003, etc.)

      logger.info(`Found ${migrationFiles.length} migration files`);

      for (const file of migrationFiles) {
        const migrationPath = join(migrationsDir, file);
        try {
          const migrationSql = readFileSync(migrationPath, 'utf-8');
          await query(migrationSql);
          logger.info(`Migration applied: ${file}`);
        } catch (error: any) {
          // Handle common idempotent errors gracefully
          if (error.message.includes('already exists') ||
              error.message.includes('duplicate key') ||
              error.message.includes('does not exist') ||
              error.message.includes('cannot drop')) {
            logger.debug(`Migration ${file} skipped (already applied or no changes needed)`);
          } else {
            logger.warn(`Migration ${file} had issues`, { error: error.message });
          }
        }
      }
    }

    // Step 4: Run standalone schema files (schema_update.sql, schema_learning.sql)
    const standaloneSchemas = ['schema_update.sql', 'schema_learning.sql'];
    for (const schemaFile of standaloneSchemas) {
      const schemaPath = join(__dirname, '../../database', schemaFile);
      if (existsSync(schemaPath)) {
        try {
          const schemaSql = readFileSync(schemaPath, 'utf-8');
          await query(schemaSql);
          logger.info(`Schema applied: ${schemaFile}`);
        } catch (error: any) {
          if (error.message.includes('already exists') ||
              error.message.includes('duplicate key')) {
            logger.debug(`Schema ${schemaFile} skipped (already applied)`);
          } else {
            logger.warn(`Schema ${schemaFile} had issues`, { error: error.message });
          }
        }
      }
    }

    logger.info('Database schema and migrations ready');
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
