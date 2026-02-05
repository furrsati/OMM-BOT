-- Phase 2 Schema Updates
-- Add missing columns to smart_wallets and create wallet_stats table

-- Update smart_wallets table
ALTER TABLE smart_wallets RENAME COLUMN wallet_address TO address;

ALTER TABLE smart_wallets ADD COLUMN IF NOT EXISTS total_trades INT DEFAULT 0;
ALTER TABLE smart_wallets ADD COLUMN IF NOT EXISTS successful_trades INT DEFAULT 0;
ALTER TABLE smart_wallets ADD COLUMN IF NOT EXISTS average_hold_time INT DEFAULT 0;

-- Drop old metrics JSONB column if exists
ALTER TABLE smart_wallets DROP COLUMN IF EXISTS metrics;

-- Create wallet_stats table
CREATE TABLE IF NOT EXISTS wallet_stats (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  wallet_address VARCHAR(44) NOT NULL UNIQUE,
  signals_generated INT DEFAULT 0,
  trades_entered INT DEFAULT 0,
  trades_won INT DEFAULT 0,
  avg_time_to_move INT DEFAULT 0,
  is_crowded BOOLEAN DEFAULT FALSE,
  is_burned BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallet_stats_address ON wallet_stats(wallet_address);
CREATE INDEX IF NOT EXISTS idx_wallet_stats_burned ON wallet_stats(is_burned);
CREATE INDEX IF NOT EXISTS idx_wallet_stats_crowded ON wallet_stats(is_crowded);
