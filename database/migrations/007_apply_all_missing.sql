-- =====================================================
-- CONSOLIDATED MIGRATION: Apply All Missing Tables
-- =====================================================
-- This migration is IDEMPOTENT - safe to run multiple times
-- Uses IF NOT EXISTS and DO blocks to handle existing objects
-- =====================================================

-- =====================================================
-- 1. LEARNING ENGINE TABLES
-- =====================================================

-- Learning Weights - Tracks category weight adjustments over time
CREATE TABLE IF NOT EXISTS learning_weights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version INT NOT NULL,
  weights JSONB NOT NULL,
  reason TEXT NOT NULL,
  performance_before JSONB,
  performance_after JSONB,
  trade_count INT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_learning_weights_version ON learning_weights(version DESC);
CREATE INDEX IF NOT EXISTS idx_learning_weights_created_at ON learning_weights(created_at DESC);

-- Learning Parameters - Tracks parameter tuning adjustments over time
CREATE TABLE IF NOT EXISTS learning_parameters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version INT NOT NULL,
  parameter_name VARCHAR(100) NOT NULL,
  old_value JSONB NOT NULL,
  new_value JSONB NOT NULL,
  reason TEXT NOT NULL,
  performance_impact JSONB,
  trade_count INT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_learning_parameters_version ON learning_parameters(version DESC);
CREATE INDEX IF NOT EXISTS idx_learning_parameters_name ON learning_parameters(parameter_name);
CREATE INDEX IF NOT EXISTS idx_learning_parameters_created_at ON learning_parameters(created_at DESC);

-- Learning Meta - Tracks meta-learning evaluations and adjustments
CREATE TABLE IF NOT EXISTS learning_meta (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id INT NOT NULL,
  cycle_type VARCHAR(50) NOT NULL CHECK (cycle_type IN ('weight_optimization', 'parameter_tuning', 'meta_review', 'full_report')),
  adjustment_type VARCHAR(100),
  before_value JSONB,
  after_value JSONB,
  impact JSONB NOT NULL,
  improvement_flag BOOLEAN DEFAULT FALSE,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_learning_meta_cycle_id ON learning_meta(cycle_id DESC);
CREATE INDEX IF NOT EXISTS idx_learning_meta_cycle_type ON learning_meta(cycle_type);
CREATE INDEX IF NOT EXISTS idx_learning_meta_improvement ON learning_meta(improvement_flag);
CREATE INDEX IF NOT EXISTS idx_learning_meta_created_at ON learning_meta(created_at DESC);

-- Learning Cycles - Tracks when each learning cycle ran
CREATE TABLE IF NOT EXISTS learning_cycles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_number INT NOT NULL UNIQUE,
  cycle_type VARCHAR(50) NOT NULL,
  trade_count_at_cycle INT NOT NULL,
  adjustments_made INT DEFAULT 0,
  status VARCHAR(20) NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  error_message TEXT,
  duration_ms INT,
  created_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_learning_cycles_cycle_number ON learning_cycles(cycle_number DESC);
CREATE INDEX IF NOT EXISTS idx_learning_cycles_cycle_type ON learning_cycles(cycle_type);
CREATE INDEX IF NOT EXISTS idx_learning_cycles_status ON learning_cycles(status);
CREATE INDEX IF NOT EXISTS idx_learning_cycles_created_at ON learning_cycles(created_at DESC);

-- Frozen Parameters - Parameters locked by operator
CREATE TABLE IF NOT EXISTS frozen_parameters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parameter_name VARCHAR(100) NOT NULL UNIQUE,
  frozen_value JSONB NOT NULL,
  reason TEXT NOT NULL,
  frozen_by VARCHAR(100) DEFAULT 'operator',
  frozen_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_frozen_parameters_name ON frozen_parameters(parameter_name);

-- Learning Statistics View
CREATE OR REPLACE VIEW learning_statistics AS
SELECT
  lc.cycle_number,
  lc.cycle_type,
  lc.trade_count_at_cycle,
  lc.adjustments_made,
  lm.improvement_flag,
  lc.created_at
FROM learning_cycles lc
LEFT JOIN learning_meta lm ON lc.cycle_number = lm.cycle_id
WHERE lc.status = 'completed'
ORDER BY lc.cycle_number DESC;

-- =====================================================
-- 2. ANALYTICS & MONITORING TABLES
-- =====================================================

-- Daily Analytics
CREATE TABLE IF NOT EXISTS daily_analytics (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL UNIQUE,
  total_trades INTEGER DEFAULT 0,
  win_rate DECIMAL(5, 2) DEFAULT 0,
  avg_win_percent DECIMAL(10, 4) DEFAULT 0,
  avg_loss_percent DECIMAL(10, 4) DEFAULT 0,
  profit_factor DECIMAL(10, 4) DEFAULT 0,
  smart_wallet_accuracy DECIMAL(5, 2) DEFAULT 0,
  tokens_analyzed INTEGER DEFAULT 0,
  tokens_rejected INTEGER DEFAULT 0,
  honeypots_caught INTEGER DEFAULT 0,
  total_volume_sol DECIMAL(20, 8) DEFAULT 0,
  realized_pnl_sol DECIMAL(20, 8) DEFAULT 0,
  unrealized_pnl_sol DECIMAL(20, 8) DEFAULT 0,
  avg_hold_time_minutes INTEGER DEFAULT 0,
  max_drawdown_percent DECIMAL(10, 4) DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_daily_analytics_date ON daily_analytics(date DESC);

-- System Health Logs
CREATE TABLE IF NOT EXISTS system_health_logs (
  id SERIAL PRIMARY KEY,
  timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
  component VARCHAR(50) NOT NULL,
  status VARCHAR(20) NOT NULL,
  memory_usage_mb DECIMAL(10, 2),
  cpu_usage_percent DECIMAL(5, 2),
  open_positions INTEGER,
  pending_orders INTEGER,
  error_count INTEGER DEFAULT 0,
  warning_count INTEGER DEFAULT 0,
  metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_health_logs_timestamp ON system_health_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_health_logs_component ON system_health_logs(component, timestamp DESC);

-- API Requests
CREATE TABLE IF NOT EXISTS api_requests (
  id SERIAL PRIMARY KEY,
  timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
  endpoint VARCHAR(100) NOT NULL,
  method VARCHAR(10) NOT NULL,
  status_code INTEGER,
  response_time_ms INTEGER,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_api_requests_timestamp ON api_requests(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_api_requests_endpoint ON api_requests(endpoint, timestamp DESC);

-- Token Performance
CREATE TABLE IF NOT EXISTS token_performance (
  id SERIAL PRIMARY KEY,
  token_address VARCHAR(44) NOT NULL,
  analyzed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  safety_score INTEGER,
  conviction_score INTEGER,
  entered BOOLEAN DEFAULT false,
  trade_outcome VARCHAR(20),
  pnl_percent DECIMAL(10, 4),
  rejection_reason TEXT,
  smart_wallets_entered INTEGER,
  metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_token_performance_address ON token_performance(token_address);
CREATE INDEX IF NOT EXISTS idx_token_performance_analyzed ON token_performance(analyzed_at DESC);
CREATE INDEX IF NOT EXISTS idx_token_performance_outcome ON token_performance(trade_outcome, analyzed_at DESC);

-- Backup Logs
CREATE TABLE IF NOT EXISTS backup_logs (
  id SERIAL PRIMARY KEY,
  backup_type VARCHAR(50) NOT NULL,
  backup_path TEXT NOT NULL,
  size_bytes BIGINT,
  started_at TIMESTAMP NOT NULL,
  completed_at TIMESTAMP,
  status VARCHAR(20) NOT NULL,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_backup_logs_completed ON backup_logs(completed_at DESC);

-- =====================================================
-- 3. WALLET DISCOVERIES TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS wallet_discoveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address VARCHAR(44) NOT NULL,
  token_address VARCHAR(44) NOT NULL,
  token_symbol VARCHAR(20),
  entry_time TIMESTAMP NOT NULL,
  entry_price_usd DECIMAL(20, 12),
  current_price_usd DECIMAL(20, 12),
  peak_price_usd DECIMAL(20, 12),
  peak_multiplier DECIMAL(10, 2) DEFAULT 1.0,
  current_multiplier DECIMAL(10, 2) DEFAULT 1.0,
  is_winner BOOLEAN DEFAULT FALSE,
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

-- =====================================================
-- 4. BOT SETTINGS TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS bot_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key VARCHAR(100) NOT NULL UNIQUE,
  value JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bot_settings_key ON bot_settings(key);

-- =====================================================
-- 5. BOT LOGS TABLE (if not exists from fix_missing_tables)
-- =====================================================

CREATE TABLE IF NOT EXISTS bot_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  level VARCHAR(20) NOT NULL DEFAULT 'info',
  category VARCHAR(50) DEFAULT 'general',
  message TEXT NOT NULL,
  data JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bot_logs_level ON bot_logs(level);
CREATE INDEX IF NOT EXISTS idx_bot_logs_category ON bot_logs(category);
CREATE INDEX IF NOT EXISTS idx_bot_logs_created_at ON bot_logs(created_at DESC);

-- =====================================================
-- 6. EXECUTION HISTORY TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS execution_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type VARCHAR(20) NOT NULL,
  token_address VARCHAR(44) NOT NULL,
  token_symbol VARCHAR(20),
  amount DECIMAL(18, 6),
  price DECIMAL(18, 9),
  value_usd DECIMAL(18, 6),
  signature VARCHAR(100),
  status VARCHAR(20) DEFAULT 'pending',
  latency_ms INT,
  slippage_percent DECIMAL(5, 2),
  priority_fee DECIMAL(18, 9),
  retries INT DEFAULT 0,
  error_message TEXT,
  rpc_node VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_execution_history_token ON execution_history(token_address);
CREATE INDEX IF NOT EXISTS idx_execution_history_created_at ON execution_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_execution_history_status ON execution_history(status);

-- =====================================================
-- 7. TOKEN OPPORTUNITIES TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS token_opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_address VARCHAR(44) NOT NULL,
  token_name VARCHAR(100),
  token_symbol VARCHAR(20),
  deployer_address VARCHAR(44),
  discovered_at TIMESTAMP DEFAULT NOW(),
  discovered_via VARCHAR(50),
  smart_wallets_entered TEXT[] DEFAULT '{}',
  smart_wallet_count INT DEFAULT 0,
  tier1_count INT DEFAULT 0,
  tier2_count INT DEFAULT 0,
  tier3_count INT DEFAULT 0,
  safety_score DECIMAL(5, 2) DEFAULT 0,
  safety_checks JSONB DEFAULT '{}',
  is_honeypot BOOLEAN DEFAULT FALSE,
  has_mint_authority BOOLEAN,
  has_freeze_authority BOOLEAN,
  current_price DECIMAL(18, 9),
  market_cap DECIMAL(18, 2),
  liquidity_usd DECIMAL(18, 2),
  holder_count INT DEFAULT 0,
  volume_24h DECIMAL(18, 2),
  price_change_1h DECIMAL(10, 4),
  price_change_24h DECIMAL(10, 4),
  dip_from_high DECIMAL(10, 4),
  ath_price DECIMAL(18, 9),
  token_age_minutes INT,
  hype_phase VARCHAR(20),
  conviction_score DECIMAL(5, 2) DEFAULT 0,
  conviction_breakdown JSONB DEFAULT '{}',
  status VARCHAR(20) DEFAULT 'ANALYZING',
  rejection_reason TEXT,
  decision_time TIMESTAMP,
  last_updated TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP DEFAULT NOW() + INTERVAL '1 hour'
);

CREATE INDEX IF NOT EXISTS idx_token_opportunities_status ON token_opportunities(status);
CREATE INDEX IF NOT EXISTS idx_token_opportunities_token ON token_opportunities(token_address);
CREATE INDEX IF NOT EXISTS idx_token_opportunities_conviction ON token_opportunities(conviction_score DESC);
CREATE INDEX IF NOT EXISTS idx_token_opportunities_discovered ON token_opportunities(discovered_at DESC);
CREATE INDEX IF NOT EXISTS idx_token_opportunities_expires ON token_opportunities(expires_at);
CREATE INDEX IF NOT EXISTS idx_token_opportunities_discovered_via ON token_opportunities(discovered_via);

-- Add unique constraint for upsert operations
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'token_opportunities_token_address_key'
  ) THEN
    ALTER TABLE token_opportunities
    ADD CONSTRAINT token_opportunities_token_address_key UNIQUE (token_address);
  END IF;
END $$;

-- =====================================================
-- 8. FIX AUDIT_LOG TABLE
-- =====================================================

-- Add missing columns to audit_log
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS checksum VARCHAR(64);
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS api_key_id VARCHAR(50);
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS ip_address VARCHAR(45);
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS user_agent VARCHAR(500);
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS path VARCHAR(255);
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS method VARCHAR(10);
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS request_body JSONB;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS response_status INT;

-- Make details column nullable if not already
DO $$
BEGIN
  ALTER TABLE audit_log ALTER COLUMN details DROP NOT NULL;
EXCEPTION WHEN others THEN
  NULL;
END $$;

-- Create security indexes
CREATE INDEX IF NOT EXISTS idx_audit_log_api_key_id ON audit_log(api_key_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_ip_address ON audit_log(ip_address);
CREATE INDEX IF NOT EXISTS idx_audit_log_path ON audit_log(path);

-- =====================================================
-- 9. FIX SMART_WALLETS TABLE
-- =====================================================

-- Add unique constraint on address for upsert operations
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE c.conname = 'smart_wallets_address_key'
    AND n.nspname = current_schema()
  ) THEN
    ALTER TABLE smart_wallets ADD CONSTRAINT smart_wallets_address_key UNIQUE (address);
  END IF;
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

-- Add missing columns
ALTER TABLE smart_wallets ADD COLUMN IF NOT EXISTS is_crowded BOOLEAN DEFAULT FALSE;
ALTER TABLE smart_wallets ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE smart_wallets ADD COLUMN IF NOT EXISTS tokens_won INT DEFAULT 0;
ALTER TABLE smart_wallets ADD COLUMN IF NOT EXISTS avg_peak_multiplier DECIMAL(10, 2) DEFAULT 0;
ALTER TABLE smart_wallets ADD COLUMN IF NOT EXISTS best_pick_multiplier DECIMAL(10, 2) DEFAULT 0;
ALTER TABLE smart_wallets ADD COLUMN IF NOT EXISTS recent_tokens JSONB DEFAULT '[]';

-- =====================================================
-- 10. FIX ALERTS TABLE
-- =====================================================

-- Add missing columns
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS title VARCHAR(255);
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS category VARCHAR(50);

-- Update level check constraint to accept both cases
DO $$
BEGIN
  ALTER TABLE alerts DROP CONSTRAINT IF EXISTS alerts_level_check;
  ALTER TABLE alerts ADD CONSTRAINT alerts_level_check
    CHECK (level IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'critical', 'error', 'warning', 'info'));
EXCEPTION WHEN others THEN
  NULL;
END $$;

-- =====================================================
-- 11. FIX BLACKLIST TABLE
-- =====================================================

-- Update type constraint to include 'deployer'
DO $$
BEGIN
  ALTER TABLE blacklist DROP CONSTRAINT IF EXISTS blacklist_type_check;
  ALTER TABLE blacklist ADD CONSTRAINT blacklist_type_check
    CHECK (type IN ('wallet', 'contract', 'deployer'));
EXCEPTION WHEN others THEN
  NULL;
END $$;

-- =====================================================
-- TABLE COMMENTS
-- =====================================================

COMMENT ON TABLE learning_weights IS 'Stores history of category weight adjustments made by Weight Optimizer';
COMMENT ON TABLE learning_parameters IS 'Stores history of parameter tuning adjustments made by Parameter Tuner';
COMMENT ON TABLE learning_meta IS 'Stores meta-learning evaluations and impact assessments';
COMMENT ON TABLE learning_cycles IS 'Tracks execution of learning cycles (every 50/100/200 trades)';
COMMENT ON TABLE frozen_parameters IS 'Parameters locked by operator to prevent Learning Engine modifications';
COMMENT ON TABLE daily_analytics IS 'Daily aggregated performance statistics';
COMMENT ON TABLE system_health_logs IS 'System health and resource monitoring';
COMMENT ON TABLE wallet_discoveries IS 'Tracks each token entry by smart wallets and their performance';
COMMENT ON TABLE bot_settings IS 'Key-value configuration storage for bot settings';

-- =====================================================
-- SUCCESS MESSAGE
-- =====================================================

DO $$
BEGIN
  RAISE NOTICE 'Consolidated migration 007_apply_all_missing.sql completed successfully';
END $$;
