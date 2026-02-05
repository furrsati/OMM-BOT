-- Migration: Update positions table for Phase 6
-- Run this migration to update the positions table with new columns

-- Drop existing positions table if it exists
DROP TABLE IF EXISTS positions CASCADE;

-- Recreate with enhanced schema
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

-- Create indexes
CREATE INDEX idx_positions_status ON positions(status);
CREATE INDEX idx_positions_token ON positions(token_address);
CREATE INDEX idx_positions_entry_time ON positions(entry_time DESC);

-- Create trigger for updated_at
CREATE TRIGGER update_positions_updated_at BEFORE UPDATE ON positions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
