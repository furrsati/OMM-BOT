/**
 * Import Smart Wallets from Seed File
 *
 * Usage: npx ts-node scripts/import-wallets.ts
 *
 * Loads wallets from database/seeds/smart-wallets-seed.json
 * and imports them into the smart_wallets table.
 */

import * as fs from 'fs';
import * as path from 'path';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import { randomUUID } from 'crypto';

dotenv.config();

interface WalletSeed {
  address: string;
  tier: number;
  notes?: string;
  score?: number;
  winRate?: number;
}

interface SeedFile {
  _warning: string;
  wallets: WalletSeed[];
}

async function importWallets() {
  console.log('🔄 Starting wallet import...\n');

  // Load seed file
  const seedPath = path.join(__dirname, '../database/seeds/smart-wallets-seed.json');

  if (!fs.existsSync(seedPath)) {
    console.error('❌ Seed file not found:', seedPath);
    console.log('   Create the file or use the API endpoint POST /api/smart-wallets/import');
    process.exit(1);
  }

  const seedData: SeedFile = JSON.parse(fs.readFileSync(seedPath, 'utf-8'));

  console.log('⚠️  WARNING:', seedData._warning);
  console.log('');

  // Determine SSL configuration (same as src/db/postgres.ts)
  const connectionString = process.env.DATABASE_URL || '';
  const isRemoteDb = connectionString.includes('render.com') ||
    connectionString.includes('dpg-') ||
    connectionString.includes('neon.tech') ||
    connectionString.includes('supabase.co') ||
    !connectionString.includes('localhost');

  const sslConfig = isRemoteDb ? {
    rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false',
  } : false;

  // Connect to database
  const pool = new Pool({
    connectionString,
    ssl: sslConfig,
  });

  try {
    await pool.query('SELECT 1'); // Test connection
    console.log('✅ Connected to database\n');
  } catch (error: any) {
    console.error('❌ Database connection failed:', error.message);
    process.exit(1);
  }

  const results = {
    imported: 0,
    skipped: 0,
    errors: [] as string[],
  };

  for (const wallet of seedData.wallets) {
    try {
      // Check if wallet exists
      const existing = await pool.query(
        'SELECT id, is_active FROM smart_wallets WHERE wallet_address = $1',
        [wallet.address]
      );

      if (existing.rows.length > 0) {
        if (!existing.rows[0].is_active) {
          // Reactivate inactive wallet
          await pool.query(
            `UPDATE smart_wallets
             SET is_active = true, tier = $2, notes = $3, updated_at = NOW()
             WHERE wallet_address = $1`,
            [wallet.address, wallet.tier, wallet.notes || null]
          );
          console.log(`🔄 Reactivated: ${wallet.address.slice(0, 8)}... (Tier ${wallet.tier})`);
          results.imported++;
        } else {
          console.log(`⏭️  Skipped (exists): ${wallet.address.slice(0, 8)}...`);
          results.skipped++;
        }
        continue;
      }

      // Insert new wallet with explicit UUID and all required columns
      await pool.query(
        `INSERT INTO smart_wallets
         (id, wallet_address, tier, notes, score, win_rate, average_return, is_active, last_active,
          tokens_entered, metrics, is_crowded, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, 0, true, NOW(), 0, '{}', false, NOW(), NOW())`,
        [
          randomUUID(),
          wallet.address,
          wallet.tier,
          wallet.notes || null,
          wallet.score || 50,
          wallet.winRate || 0,
        ]
      );
      console.log(`✅ Imported: ${wallet.address.slice(0, 8)}... (Tier ${wallet.tier})`);
      results.imported++;
    } catch (error: any) {
      console.error(`❌ Error importing ${wallet.address.slice(0, 8)}...: ${error.message}`);
      results.errors.push(`${wallet.address.slice(0, 8)}: ${error.message}`);
    }
  }

  console.log('\n========================================');
  console.log('📊 Import Summary:');
  console.log(`   ✅ Imported: ${results.imported}`);
  console.log(`   ⏭️  Skipped:  ${results.skipped}`);
  console.log(`   ❌ Errors:   ${results.errors.length}`);
  console.log('========================================\n');

  if (results.errors.length > 0) {
    console.log('Errors:');
    results.errors.forEach((e) => console.log(`   - ${e}`));
  }

  await pool.end();
  console.log('✅ Done!');
}

importWallets().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
