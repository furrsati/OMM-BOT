-- Production Performance Optimizations
-- Run with: psql $DATABASE_URL -f database/migrations/002_production_optimizations.sql
-- Note: Using regular CREATE INDEX (not CONCURRENTLY) for migration compatibility

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_trades_timestamp ON trades(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trades_outcome ON trades(outcome, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_positions_token_status ON positions(token_address, status);
CREATE INDEX IF NOT EXISTS idx_positions_open_pnl ON positions(status, pnl_percent) WHERE status = 'OPEN';
CREATE INDEX IF NOT EXISTS idx_smart_wallets_tier_active ON smart_wallets(tier, is_active);
CREATE INDEX IF NOT EXISTS idx_learning_cycles_timestamp ON learning_cycles(created_at DESC);

-- Composite indexes for common queries
CREATE INDEX IF NOT EXISTS idx_trades_token_outcome ON trades(token_address, outcome, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_positions_status_created ON positions(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_smart_wallets_performance ON smart_wallets(tier, win_rate DESC, is_active) WHERE is_active = true;

-- Partial indexes for hot data
CREATE INDEX IF NOT EXISTS idx_positions_open_by_created ON positions(created_at DESC) WHERE status = 'OPEN';
CREATE INDEX IF NOT EXISTS idx_trades_recent_outcomes ON trades(outcome, pnl_percent, created_at DESC);

-- NOTE: ANALYZE and VACUUM commands removed from migration
-- These cannot run inside a transaction block
-- Run manually if needed:
--   ANALYZE trades;
--   VACUUM ANALYZE trades;
--   etc.

-- Success message
DO $$
BEGIN
  RAISE NOTICE 'Production optimizations applied successfully';
END $$;
