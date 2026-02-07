-- Solana Memecoin Trading Bot Database Schema

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================
-- TRIGGER FUNCTION FOR UPDATED_AT
-- Must be defined before any table that uses it
-- =====================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- SMART WALLETS TABLE
-- =====================================================
CREATE TABLE smart_wallets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  address VARCHAR(44) NOT NULL UNIQUE,
  tier INT NOT NULL CHECK (tier IN (1, 2, 3)),
  score DECIMAL(10, 2) NOT NULL DEFAULT 0,
  win_rate DECIMAL(5, 2) DEFAULT 0,
  average_return DECIMAL(10, 2) DEFAULT 0,
  tokens_entered INT DEFAULT 0,
  tokens_won INT DEFAULT 0,
  last_active TIMESTAMP DEFAULT NOW(),
  total_trades INT DEFAULT 0,
  successful_trades INT DEFAULT 0,
  average_hold_time INT DEFAULT 0,
  avg_peak_multiplier DECIMAL(10, 2) DEFAULT 0,
  best_pick_multiplier DECIMAL(10, 2) DEFAULT 0,
  recent_tokens JSONB DEFAULT '[]',
  is_active BOOLEAN DEFAULT TRUE,
  is_crowded BOOLEAN DEFAULT FALSE,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_smart_wallets_address ON smart_wallets(address);
CREATE INDEX idx_smart_wallets_tier ON smart_wallets(tier);
CREATE INDEX idx_smart_wallets_score ON smart_wallets(score DESC);
CREATE INDEX idx_smart_wallets_last_active ON smart_wallets(last_active DESC);

-- =====================================================
-- TOKENS TABLE
-- =====================================================
CREATE TABLE tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contract_address VARCHAR(44) NOT NULL UNIQUE,
  deployer VARCHAR(44) NOT NULL,
  name VARCHAR(255),
  symbol VARCHAR(50),
  decimals INT NOT NULL,
  total_supply BIGINT,
  metadata JSONB DEFAULT '{}',
  safety_score DECIMAL(5, 2) DEFAULT 0,
  liquidity_depth DECIMAL(18, 6) DEFAULT 0,
  holder_count INT DEFAULT 0,
  is_honeypot BOOLEAN DEFAULT FALSE,
  has_mint_authority BOOLEAN DEFAULT FALSE,
  has_freeze_authority BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_tokens_contract_address ON tokens(contract_address);
CREATE INDEX idx_tokens_deployer ON tokens(deployer);
CREATE INDEX idx_tokens_safety_score ON tokens(safety_score DESC);
CREATE INDEX idx_tokens_created_at ON tokens(created_at DESC);

-- =====================================================
-- TRADES TABLE
-- =====================================================
CREATE TABLE trades (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  token_address VARCHAR(44) NOT NULL,
  entry_price DECIMAL(18, 9) NOT NULL,
  entry_amount DECIMAL(18, 6) NOT NULL,
  entry_time TIMESTAMP NOT NULL DEFAULT NOW(),
  exit_price DECIMAL(18, 9),
  exit_amount DECIMAL(18, 6),
  exit_time TIMESTAMP,
  exit_reason VARCHAR(50),
  profit_loss DECIMAL(18, 6),
  profit_loss_percent DECIMAL(10, 2),
  conviction_score DECIMAL(5, 2) NOT NULL,
  fingerprint JSONB NOT NULL,
  outcome VARCHAR(20) CHECK (outcome IN ('WIN', 'LOSS', 'BREAKEVEN', 'EMERGENCY', 'RUG')),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_trades_token_address ON trades(token_address);
CREATE INDEX idx_trades_entry_time ON trades(entry_time DESC);
CREATE INDEX idx_trades_outcome ON trades(outcome);
CREATE INDEX idx_trades_profit_loss ON trades(profit_loss DESC);

-- =====================================================
-- BLACKLIST TABLE
-- =====================================================
CREATE TABLE blacklist (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  address VARCHAR(44) NOT NULL UNIQUE,
  type VARCHAR(20) NOT NULL CHECK (type IN ('wallet', 'contract', 'deployer')),
  reason TEXT NOT NULL,
  depth INT NOT NULL DEFAULT 0,
  evidence JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_blacklist_address ON blacklist(address);
CREATE INDEX idx_blacklist_type ON blacklist(type);

-- =====================================================
-- DANGER PATTERNS TABLE
-- =====================================================
CREATE TABLE danger_patterns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pattern_data JSONB NOT NULL,
  confidence_score DECIMAL(5, 2) NOT NULL,
  occurrences INT DEFAULT 1,
  last_seen TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_danger_patterns_confidence ON danger_patterns(confidence_score DESC);

-- =====================================================
-- WIN PATTERNS TABLE
-- =====================================================
CREATE TABLE win_patterns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pattern_data JSONB NOT NULL,
  avg_return DECIMAL(10, 2) NOT NULL,
  occurrences INT DEFAULT 1,
  last_seen TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_win_patterns_avg_return ON win_patterns(avg_return DESC);

-- =====================================================
-- BOT PARAMETERS TABLE (Learning Engine Versioning)
-- =====================================================
CREATE TABLE bot_parameters (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  version INT NOT NULL UNIQUE,
  dip_entry_range JSONB NOT NULL,
  stop_loss_percent DECIMAL(5, 2) NOT NULL,
  position_sizes JSONB NOT NULL,
  max_open_positions INT NOT NULL,
  max_daily_loss DECIMAL(5, 2) NOT NULL,
  max_daily_profit DECIMAL(5, 2) NOT NULL,
  is_active BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_bot_parameters_version ON bot_parameters(version DESC);
CREATE INDEX idx_bot_parameters_active ON bot_parameters(is_active);

-- =====================================================
-- LEARNING SNAPSHOTS TABLE
-- =====================================================
CREATE TABLE learning_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  version INT NOT NULL,
  weights JSONB NOT NULL,
  parameters JSONB NOT NULL,
  trade_count INT NOT NULL,
  win_rate DECIMAL(5, 2) NOT NULL,
  profit_factor DECIMAL(10, 2) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_learning_snapshots_version ON learning_snapshots(version DESC);
CREATE INDEX idx_learning_snapshots_created_at ON learning_snapshots(created_at DESC);

-- =====================================================
-- POSITIONS TABLE (Current Holdings - Enhanced for Phase 6)
-- =====================================================
CREATE TABLE positions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  token_address VARCHAR(44) NOT NULL UNIQUE,
  token_name VARCHAR(100),
  token_symbol VARCHAR(20),
  entry_price DECIMAL(18, 9) NOT NULL,
  entry_amount DECIMAL(18, 6) NOT NULL,
  entry_time TIMESTAMP NOT NULL,
  entry_conviction INTEGER NOT NULL,
  current_price DECIMAL(18, 9),
  highest_price DECIMAL(18, 9),
  stop_loss_price DECIMAL(18, 9),
  trailing_stop_active BOOLEAN DEFAULT FALSE,
  take_profit_30_hit BOOLEAN DEFAULT FALSE,
  take_profit_60_hit BOOLEAN DEFAULT FALSE,
  take_profit_100_hit BOOLEAN DEFAULT FALSE,
  take_profit_200_hit BOOLEAN DEFAULT FALSE,
  remaining_amount DECIMAL(18, 6),
  pnl_percent DECIMAL(10, 4),
  pnl_usd DECIMAL(20, 10),
  status VARCHAR(20) DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'STOP_HIT', 'TP_HIT', 'DANGER_EXIT', 'CLOSED')),
  exit_reason VARCHAR(100),
  exit_time TIMESTAMP,
  smart_wallets_in_position TEXT[] DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_positions_status ON positions(status);
CREATE INDEX idx_positions_token ON positions(token_address);
CREATE INDEX idx_positions_entry_time ON positions(entry_time DESC);

CREATE TRIGGER update_positions_updated_at BEFORE UPDATE ON positions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- ALERTS TABLE
-- =====================================================
CREATE TABLE alerts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  level VARCHAR(20) NOT NULL CHECK (level IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'critical', 'error', 'warning', 'info')),
  type VARCHAR(50) NOT NULL,
  message TEXT NOT NULL,
  data JSONB DEFAULT '{}',
  acknowledged BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_alerts_level ON alerts(level);
CREATE INDEX idx_alerts_acknowledged ON alerts(acknowledged);
CREATE INDEX idx_alerts_created_at ON alerts(created_at DESC);

-- =====================================================
-- AUDIT LOG TABLE (Tamper-proof)
-- =====================================================
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  action VARCHAR(100) NOT NULL,
  details JSONB DEFAULT '{}',
  checksum VARCHAR(64),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_audit_log_created_at ON audit_log(created_at DESC);
CREATE INDEX idx_audit_log_action ON audit_log(action);

-- =====================================================
-- PRICE HISTORY TABLE (TimescaleDB Hypertable)
-- =====================================================
CREATE TABLE price_history (
  time TIMESTAMP NOT NULL,
  token_address VARCHAR(44) NOT NULL,
  price DECIMAL(18, 9) NOT NULL,
  volume DECIMAL(18, 6),
  liquidity DECIMAL(18, 6),
  holder_count INT,
  PRIMARY KEY (time, token_address)
);

-- Convert to hypertable (requires TimescaleDB extension)
-- SELECT create_hypertable('price_history', 'time');

CREATE INDEX idx_price_history_token ON price_history(token_address, time DESC);

-- =====================================================
-- TRIGGERS FOR UPDATED_AT
-- =====================================================
CREATE TRIGGER update_smart_wallets_updated_at BEFORE UPDATE ON smart_wallets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_tokens_updated_at BEFORE UPDATE ON tokens
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_trades_updated_at BEFORE UPDATE ON trades
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- CACHE TABLES (Replace Redis)
-- =====================================================

-- Generic cache table for key-value storage with expiration
CREATE TABLE cache (
  key VARCHAR(255) PRIMARY KEY,
  value TEXT NOT NULL,
  expires_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_cache_expires_at ON cache(expires_at);

-- Rate limiting counters
CREATE TABLE rate_limits (
  identifier VARCHAR(255) PRIMARY KEY,
  count INT NOT NULL DEFAULT 1,
  window_start TIMESTAMP NOT NULL DEFAULT NOW(),
  window_seconds INT NOT NULL,
  expires_at TIMESTAMP NOT NULL
);

CREATE INDEX idx_rate_limits_expires_at ON rate_limits(expires_at);

-- =====================================================
-- INITIAL DEFAULT PARAMETERS
-- =====================================================
INSERT INTO bot_parameters (
  version,
  dip_entry_range,
  stop_loss_percent,
  position_sizes,
  max_open_positions,
  max_daily_loss,
  max_daily_profit,
  is_active
) VALUES (
  1,
  '{"min": 20, "max": 30}'::jsonb,
  25.0,
  '{"high": 5, "medium": 3, "low": 1}'::jsonb,
  5,
  8.0,
  15.0,
  TRUE
);

-- =====================================================
-- INITIAL LEARNING SNAPSHOT
-- =====================================================
INSERT INTO learning_snapshots (
  version,
  weights,
  parameters,
  trade_count,
  win_rate,
  profit_factor
) VALUES (
  1,
  '{"smartWallet": 30, "tokenSafety": 25, "marketConditions": 15, "socialSignals": 10, "entryQuality": 20}'::jsonb,
  '{"dipEntryRange": {"min": 20, "max": 30}, "stopLossPercent": 25}'::jsonb,
  0,
  0.0,
  0.0
);
