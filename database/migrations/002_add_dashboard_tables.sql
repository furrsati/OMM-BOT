-- Migration: Add tables for dashboard functionality
-- Created: 2024
-- Uses gen_random_uuid() for PostgreSQL 13+

-- =====================================================
-- BOT LOGS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS bot_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  level VARCHAR(10) NOT NULL CHECK (level IN ('debug', 'info', 'warn', 'error')),
  category VARCHAR(50),
  message TEXT NOT NULL,
  data JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bot_logs_level ON bot_logs(level);
CREATE INDEX IF NOT EXISTS idx_bot_logs_category ON bot_logs(category);
CREATE INDEX IF NOT EXISTS idx_bot_logs_created_at ON bot_logs(created_at DESC);

-- =====================================================
-- TOKEN OPPORTUNITIES TABLE (Scanner/Opportunities Page)
-- =====================================================
CREATE TABLE IF NOT EXISTS token_opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_address VARCHAR(44) NOT NULL,
  token_name VARCHAR(100),
  token_symbol VARCHAR(20),
  deployer_address VARCHAR(44),

  -- Discovery info
  discovered_at TIMESTAMP DEFAULT NOW(),
  discovered_via VARCHAR(50),

  -- Smart wallet signals
  smart_wallets_entered TEXT[] DEFAULT '{}',
  smart_wallet_count INT DEFAULT 0,
  tier1_count INT DEFAULT 0,
  tier2_count INT DEFAULT 0,
  tier3_count INT DEFAULT 0,

  -- Safety analysis
  safety_score DECIMAL(5, 2) DEFAULT 0,
  safety_checks JSONB DEFAULT '{}',
  is_honeypot BOOLEAN DEFAULT FALSE,
  has_mint_authority BOOLEAN,
  has_freeze_authority BOOLEAN,

  -- Market data
  current_price DECIMAL(18, 9),
  market_cap DECIMAL(18, 2),
  liquidity_usd DECIMAL(18, 2),
  holder_count INT DEFAULT 0,
  volume_24h DECIMAL(18, 2),
  price_change_1h DECIMAL(10, 4),
  price_change_24h DECIMAL(10, 4),

  -- Entry analysis
  dip_from_high DECIMAL(10, 4),
  ath_price DECIMAL(18, 9),
  token_age_minutes INT,
  hype_phase VARCHAR(20),

  -- Conviction scoring
  conviction_score DECIMAL(5, 2) DEFAULT 0,
  conviction_breakdown JSONB DEFAULT '{}',

  -- Decision
  status VARCHAR(20) DEFAULT 'ANALYZING' CHECK (status IN ('ANALYZING', 'QUALIFIED', 'REJECTED', 'ENTERED', 'EXPIRED')),
  rejection_reason TEXT,
  decision_time TIMESTAMP,

  -- Timestamps
  last_updated TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP DEFAULT NOW() + INTERVAL '1 hour'
);

CREATE INDEX IF NOT EXISTS idx_token_opportunities_status ON token_opportunities(status);
CREATE INDEX IF NOT EXISTS idx_token_opportunities_token ON token_opportunities(token_address);
CREATE INDEX IF NOT EXISTS idx_token_opportunities_conviction ON token_opportunities(conviction_score DESC);
CREATE INDEX IF NOT EXISTS idx_token_opportunities_discovered ON token_opportunities(discovered_at DESC);
CREATE INDEX IF NOT EXISTS idx_token_opportunities_expires ON token_opportunities(expires_at);

-- =====================================================
-- EXECUTION HISTORY TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS execution_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type VARCHAR(20) NOT NULL CHECK (type IN ('buy', 'sell', 'emergency')),
  token_address VARCHAR(44) NOT NULL,
  token_symbol VARCHAR(20),
  amount DECIMAL(18, 6),
  price DECIMAL(18, 9),
  value_usd DECIMAL(18, 2),
  signature VARCHAR(100),
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed')),
  latency_ms INT,
  slippage_percent DECIMAL(5, 2),
  priority_fee DECIMAL(18, 9),
  retries INT DEFAULT 0,
  error_message TEXT,
  rpc_node VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_execution_history_status ON execution_history(status);
CREATE INDEX IF NOT EXISTS idx_execution_history_type ON execution_history(type);
CREATE INDEX IF NOT EXISTS idx_execution_history_created ON execution_history(created_at DESC);

-- Add notes column to smart_wallets if not exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'smart_wallets' AND column_name = 'notes') THEN
    ALTER TABLE smart_wallets ADD COLUMN notes TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'smart_wallets' AND column_name = 'is_crowded') THEN
    ALTER TABLE smart_wallets ADD COLUMN is_crowded BOOLEAN DEFAULT FALSE;
  END IF;
END $$;

-- Add title column to alerts if not exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'alerts' AND column_name = 'title') THEN
    ALTER TABLE alerts ADD COLUMN title VARCHAR(255);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'alerts' AND column_name = 'category') THEN
    ALTER TABLE alerts ADD COLUMN category VARCHAR(50);
  END IF;
END $$;

-- Update alerts level check constraint
ALTER TABLE alerts DROP CONSTRAINT IF EXISTS alerts_level_check;
ALTER TABLE alerts ADD CONSTRAINT alerts_level_check
  CHECK (level IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'critical', 'error', 'warning', 'info'));
