-- Analytics and Monitoring Tables
-- Run with: psql $DATABASE_URL -f database/migrations/003_analytics_and_monitoring.sql

-- Daily analytics table
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

-- System health tracking
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

-- API request tracking
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

-- Token performance tracking
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

-- Backup and recovery tracking
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

-- Success message
DO $$
BEGIN
  RAISE NOTICE 'Analytics and monitoring tables created successfully';
END $$;
