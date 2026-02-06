/**
 * Backfill wallet discoveries
 * Run with: npx ts-node scripts/backfill-wallets.ts
 */

import { Connection } from '@solana/web3.js';
import { config } from 'dotenv';
config();

import { WalletScanner } from '../src/discovery/wallet-scanner';
import { initializePostgres, closePool } from '../src/db/postgres';

async function main() {
  console.log('Starting wallet backfill...');

  // Initialize database
  console.log('Connecting to database...');
  await initializePostgres();

  const rpcUrl = process.env.SOLANA_RPC_PRIMARY || 'https://api.mainnet-beta.solana.com';
  console.log(`Using RPC: ${rpcUrl.slice(0, 50)}...`);

  const connection = new Connection(rpcUrl, 'confirmed');
  const scanner = new WalletScanner(connection);

  try {
    await scanner.backfillExistingWallets();
    console.log('Backfill complete!');
  } catch (error) {
    console.error('Backfill failed:', error);
  } finally {
    await closePool();
  }

  process.exit(0);
}

main();
