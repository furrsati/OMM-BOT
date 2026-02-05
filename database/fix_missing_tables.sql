-- Fix script to create missing critical tables
-- This uses only simple SQL without UUID functions

-- MOST IMPORTANT: Create cache table if it doesn't exist
CREATE TABLE IF NOT EXISTS cache (
  key VARCHAR(255) PRIMARY KEY,
  value TEXT NOT NULL,
  expires_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cache_expires_at ON cache(expires_at);

-- Create rate_limits table if it doesn't exist
CREATE TABLE IF NOT EXISTS rate_limits (
  identifier VARCHAR(255) PRIMARY KEY,
  count INT NOT NULL DEFAULT 1,
  window_start TIMESTAMP NOT NULL DEFAULT NOW(),
  window_seconds INT NOT NULL,
  expires_at TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_expires_at ON rate_limits(expires_at);

-- Wallet stats table for tracking smart wallet performance
CREATE TABLE IF NOT EXISTS wallet_stats (
    id SERIAL PRIMARY KEY,
    wallet_address VARCHAR(44) UNIQUE NOT NULL,
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
