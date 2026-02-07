-- Migration: Update positions table for Phase 6
-- Safe, idempotent migration - uses ADD COLUMN IF NOT EXISTS
-- NO DROP TABLE - preserves existing data

-- Create positions table if it doesn't exist
CREATE TABLE IF NOT EXISTS positions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  token_address VARCHAR(44) NOT NULL UNIQUE,
  token_name VARCHAR(100),
  token_symbol VARCHAR(20),
  entry_price DECIMAL(18, 9) NOT NULL,
  entry_amount DECIMAL(18, 6) NOT NULL,
  entry_time TIMESTAMP NOT NULL DEFAULT NOW(),
  entry_conviction INTEGER NOT NULL DEFAULT 0,
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
  status VARCHAR(20) DEFAULT 'OPEN',
  exit_reason VARCHAR(100),
  exit_time TIMESTAMP,
  smart_wallets_in_position TEXT[] DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Add any missing columns to existing table
ALTER TABLE positions ADD COLUMN IF NOT EXISTS token_name VARCHAR(100);
ALTER TABLE positions ADD COLUMN IF NOT EXISTS token_symbol VARCHAR(20);
ALTER TABLE positions ADD COLUMN IF NOT EXISTS current_price DECIMAL(18, 9);
ALTER TABLE positions ADD COLUMN IF NOT EXISTS highest_price DECIMAL(18, 9);
ALTER TABLE positions ADD COLUMN IF NOT EXISTS stop_loss_price DECIMAL(18, 9);
ALTER TABLE positions ADD COLUMN IF NOT EXISTS trailing_stop_active BOOLEAN DEFAULT FALSE;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS take_profit_30_hit BOOLEAN DEFAULT FALSE;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS take_profit_60_hit BOOLEAN DEFAULT FALSE;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS take_profit_100_hit BOOLEAN DEFAULT FALSE;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS take_profit_200_hit BOOLEAN DEFAULT FALSE;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS remaining_amount DECIMAL(18, 6);
ALTER TABLE positions ADD COLUMN IF NOT EXISTS pnl_percent DECIMAL(10, 4);
ALTER TABLE positions ADD COLUMN IF NOT EXISTS pnl_usd DECIMAL(20, 10);
ALTER TABLE positions ADD COLUMN IF NOT EXISTS exit_reason VARCHAR(100);
ALTER TABLE positions ADD COLUMN IF NOT EXISTS exit_time TIMESTAMP;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS smart_wallets_in_position TEXT[] DEFAULT '{}';
ALTER TABLE positions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

-- Create indexes if not exist
CREATE INDEX IF NOT EXISTS idx_positions_status ON positions(status);
CREATE INDEX IF NOT EXISTS idx_positions_token ON positions(token_address);
CREATE INDEX IF NOT EXISTS idx_positions_entry_time ON positions(entry_time DESC);

-- Create or replace trigger for updated_at
DROP TRIGGER IF EXISTS update_positions_updated_at ON positions;
CREATE TRIGGER update_positions_updated_at BEFORE UPDATE ON positions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
