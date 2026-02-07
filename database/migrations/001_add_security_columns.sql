-- Migration: Add security-related columns to audit_log table
-- This migration adds columns needed for the authentication and audit middleware

-- Add new columns to audit_log table for security tracking
ALTER TABLE audit_log
  ADD COLUMN IF NOT EXISTS api_key_id VARCHAR(50),
  ADD COLUMN IF NOT EXISTS ip_address VARCHAR(45),
  ADD COLUMN IF NOT EXISTS user_agent VARCHAR(500),
  ADD COLUMN IF NOT EXISTS path VARCHAR(255),
  ADD COLUMN IF NOT EXISTS method VARCHAR(10),
  ADD COLUMN IF NOT EXISTS request_body JSONB,
  ADD COLUMN IF NOT EXISTS response_status INT,
  ADD COLUMN IF NOT EXISTS actor VARCHAR(100);

-- Make checksum nullable since new audit entries may not have it
ALTER TABLE audit_log
  ALTER COLUMN checksum DROP NOT NULL;

-- Make details column nullable (we may not always have details)
ALTER TABLE audit_log
  ALTER COLUMN details DROP NOT NULL;

-- Create indexes for security-related queries
CREATE INDEX IF NOT EXISTS idx_audit_log_api_key_id ON audit_log(api_key_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_ip_address ON audit_log(ip_address);
CREATE INDEX IF NOT EXISTS idx_audit_log_path ON audit_log(path);

-- Update blacklist type constraint to include 'deployer'
-- First drop the existing constraint, then add the updated one
DO $$
BEGIN
  ALTER TABLE blacklist DROP CONSTRAINT IF EXISTS blacklist_type_check;
  ALTER TABLE blacklist ADD CONSTRAINT blacklist_type_check
    CHECK (type IN ('wallet', 'contract', 'deployer'));
EXCEPTION WHEN undefined_object THEN
  NULL;
END $$;

-- Add smart_wallets.address column alias if using wallet_address
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'smart_wallets' AND column_name = 'address'
  ) THEN
    -- Add address as alias for wallet_address
    ALTER TABLE smart_wallets ADD COLUMN address VARCHAR(44);
    UPDATE smart_wallets SET address = wallet_address;
    -- Create index on address
    CREATE INDEX IF NOT EXISTS idx_smart_wallets_address ON smart_wallets(address);
  END IF;
END $$;

-- Add is_crowded column to smart_wallets if not exists
ALTER TABLE smart_wallets
  ADD COLUMN IF NOT EXISTS is_crowded BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS notes TEXT;

-- Create bot_settings table if not exists
CREATE TABLE IF NOT EXISTS bot_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key VARCHAR(100) NOT NULL UNIQUE,
  value JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bot_settings_key ON bot_settings(key);

-- Create execution_history table if not exists
CREATE TABLE IF NOT EXISTS execution_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type VARCHAR(20) NOT NULL CHECK (type IN ('buy', 'sell', 'emergency', 'BUY', 'SELL')),
  token_address VARCHAR(44) NOT NULL,
  token_symbol VARCHAR(20),
  amount DECIMAL(18, 6),
  price DECIMAL(18, 9),
  value_usd DECIMAL(18, 6),
  signature VARCHAR(100),
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed', 'PENDING', 'SUCCESS', 'FAILED')),
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

-- Create token_opportunities table if not exists
CREATE TABLE IF NOT EXISTS token_opportunities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  token_address VARCHAR(44) NOT NULL,
  token_name VARCHAR(100),
  token_symbol VARCHAR(20),
  status VARCHAR(20) DEFAULT 'ANALYZING' CHECK (status IN ('PENDING', 'ANALYZING', 'QUALIFIED', 'ENTERED', 'REJECTED', 'MISSED', 'EXPIRED')),
  conviction_score DECIMAL(5, 2),
  rejection_reason TEXT,
  smart_wallets_count INT DEFAULT 0,
  safety_score DECIMAL(5, 2),
  decision_time TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_token_opportunities_status ON token_opportunities(status);
CREATE INDEX IF NOT EXISTS idx_token_opportunities_decision_time ON token_opportunities(decision_time DESC);
