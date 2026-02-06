-- Phase 2 Schema Updates
-- Add missing columns to smart_wallets and create wallet_stats table

-- Update smart_wallets table
-- Rename wallet_address to address ONLY if wallet_address exists (idempotent)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'smart_wallets' AND column_name = 'wallet_address'
  ) THEN
    ALTER TABLE smart_wallets RENAME COLUMN wallet_address TO address;
  END IF;
END $$;

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

-- =====================================================
-- BOT LOGS TABLE (for dashboard visibility)
-- =====================================================
CREATE TABLE IF NOT EXISTS bot_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  level VARCHAR(20) NOT NULL DEFAULT 'info',
  category VARCHAR(50) DEFAULT 'general',
  message TEXT NOT NULL,
  data JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bot_logs_level ON bot_logs(level);
CREATE INDEX IF NOT EXISTS idx_bot_logs_category ON bot_logs(category);
CREATE INDEX IF NOT EXISTS idx_bot_logs_created_at ON bot_logs(created_at DESC);

-- Auto-delete old logs after 7 days to prevent unbounded growth
CREATE OR REPLACE FUNCTION cleanup_old_bot_logs()
RETURNS void AS $$
BEGIN
  DELETE FROM bot_logs WHERE created_at < NOW() - INTERVAL '7 days';
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- WALLET DISCOVERIES TABLE (for tracking wallet performance)
-- =====================================================
-- Tracks each token entry by a smart wallet and the token's performance
CREATE TABLE IF NOT EXISTS wallet_discoveries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  wallet_address VARCHAR(44) NOT NULL,
  token_address VARCHAR(44) NOT NULL,
  token_symbol VARCHAR(20),
  entry_time TIMESTAMP NOT NULL,
  entry_price_usd DECIMAL(20, 12),
  current_price_usd DECIMAL(20, 12),
  peak_price_usd DECIMAL(20, 12),
  peak_multiplier DECIMAL(10, 2) DEFAULT 1.0,
  current_multiplier DECIMAL(10, 2) DEFAULT 1.0,
  is_winner BOOLEAN DEFAULT FALSE,  -- True if hit 2x+
  seconds_after_launch INT,
  last_price_update TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(wallet_address, token_address)
);

CREATE INDEX IF NOT EXISTS idx_wallet_discoveries_wallet ON wallet_discoveries(wallet_address);
CREATE INDEX IF NOT EXISTS idx_wallet_discoveries_token ON wallet_discoveries(token_address);
CREATE INDEX IF NOT EXISTS idx_wallet_discoveries_entry_time ON wallet_discoveries(entry_time DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_discoveries_is_winner ON wallet_discoveries(is_winner);

-- Add new columns to smart_wallets for better metrics display
ALTER TABLE smart_wallets ADD COLUMN IF NOT EXISTS tokens_won INT DEFAULT 0;
ALTER TABLE smart_wallets ADD COLUMN IF NOT EXISTS avg_peak_multiplier DECIMAL(10, 2) DEFAULT 0;
ALTER TABLE smart_wallets ADD COLUMN IF NOT EXISTS best_pick_multiplier DECIMAL(10, 2) DEFAULT 0;
ALTER TABLE smart_wallets ADD COLUMN IF NOT EXISTS recent_tokens JSONB DEFAULT '[]';
