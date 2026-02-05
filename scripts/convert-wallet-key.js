#!/usr/bin/env node
/**
 * Converts Solana wallet JSON file to base58 private key
 * Usage: node convert-wallet-key.js [path-to-wallet.json]
 */

const fs = require('fs');
const bs58 = require('bs58');
const path = require('path');

// Get wallet file path from argument or use default
const walletPath = process.argv[2] || path.join(process.env.USERPROFILE || process.env.HOME, 'bot-wallet.json');

try {
  // Read wallet file
  if (!fs.existsSync(walletPath)) {
    console.error(`❌ Wallet file not found: ${walletPath}`);
    console.error('\nUsage: node convert-wallet-key.js [path-to-wallet.json]');
    console.error('Example: node convert-wallet-key.js C:\\Users\\dunze\\bot-wallet.json');
    process.exit(1);
  }

  const keypairArray = JSON.parse(fs.readFileSync(walletPath, 'utf8'));

  if (!Array.isArray(keypairArray) || keypairArray.length !== 64) {
    console.error('❌ Invalid wallet file format. Expected array of 64 numbers.');
    process.exit(1);
  }

  // Convert to base58
  const keypairBuffer = Buffer.from(keypairArray);
  const base58Key = bs58.encode(keypairBuffer);

  // Get public key (last 32 bytes of keypair)
  const publicKeyBytes = keypairArray.slice(32);
  const publicKeyBuffer = Buffer.from(publicKeyBytes);
  const publicKey = bs58.encode(publicKeyBuffer);

  // Display results
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║          🔐 SOLANA BOT WALLET CREDENTIALS                      ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  console.log('📂 Wallet File:', walletPath);
  console.log('');
  console.log('🔑 Public Address (Fund this wallet with SOL):');
  console.log('   ', publicKey);
  console.log('');
  console.log('🔐 Private Key (Base58) - Add to .env as WALLET_PRIVATE_KEY:');
  console.log('   ', base58Key);
  console.log('');
  console.log('⚠️  SECURITY WARNINGS:');
  console.log('   • NEVER share the private key with anyone');
  console.log('   • NEVER commit it to GitHub');
  console.log('   • Store the seed phrase on paper in a safe place');
  console.log('   • This wallet should ONLY be used for the bot');
  console.log('');
  console.log('📝 Next Steps:');
  console.log('   1. Add to .env file:');
  console.log('      WALLET_PRIVATE_KEY=' + base58Key);
  console.log('   2. Fund the public address with SOL (start small: 0.5-1 SOL)');
  console.log('   3. Never delete bot-wallet.json (it\'s your backup)');
  console.log('');

} catch (error) {
  console.error('❌ Error:', error.message);
  process.exit(1);
}
