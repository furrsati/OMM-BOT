-- Production Performance Optimizations
-- Run with: psql $DATABASE_URL -f database/migrations/002b_production_optimizations.sql
-- Note: Using regular CREATE INDEX (not CONCURRENTLY) for migration compatibility
-- All operations are idempotent and check for column/table existence

-- Performance indexes for trades table
CREATE INDEX IF NOT EXISTS idx_trades_timestamp ON trades(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trades_outcome ON trades(outcome, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trades_token_outcome ON trades(token_address, outcome, created_at DESC);

-- Performance indexes for positions table (with column existence checks)
DO $$
BEGIN
  -- Basic index always works
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_positions_token_status') THEN
    CREATE INDEX idx_positions_token_status ON positions(token_address, status);
  END IF;

  -- Index on pnl_percent only if column exists
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'positions' AND column_name = 'pnl_percent') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_positions_open_pnl') THEN
      EXECUTE 'CREATE INDEX idx_positions_open_pnl ON positions(status, pnl_percent) WHERE status = ''OPEN''';
    END IF;
  END IF;

  -- Status created index
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_positions_status_created') THEN
    CREATE INDEX idx_positions_status_created ON positions(status, created_at DESC);
  END IF;

  -- Open positions index
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_positions_open_by_created') THEN
    CREATE INDEX idx_positions_open_by_created ON positions(created_at DESC) WHERE status = 'OPEN';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Some position indexes could not be created: %', SQLERRM;
END $$;

-- Performance indexes for smart_wallets table
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_smart_wallets_tier_active') THEN
    CREATE INDEX idx_smart_wallets_tier_active ON smart_wallets(tier, is_active);
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'smart_wallets' AND column_name = 'win_rate') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_smart_wallets_performance') THEN
      EXECUTE 'CREATE INDEX idx_smart_wallets_performance ON smart_wallets(tier, win_rate DESC, is_active) WHERE is_active = true';
    END IF;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Some smart_wallets indexes could not be created: %', SQLERRM;
END $$;

-- Performance indexes for learning_cycles table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'learning_cycles') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_learning_cycles_timestamp') THEN
      CREATE INDEX idx_learning_cycles_timestamp ON learning_cycles(created_at DESC);
    END IF;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'learning_cycles index could not be created: %', SQLERRM;
END $$;

-- Performance indexes for trades with pnl_percent
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'trades' AND column_name = 'pnl_percent') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_trades_recent_outcomes') THEN
      EXECUTE 'CREATE INDEX idx_trades_recent_outcomes ON trades(outcome, pnl_percent, created_at DESC)';
    END IF;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'trades pnl_percent index could not be created: %', SQLERRM;
END $$;

-- Success message
DO $$
BEGIN
  RAISE NOTICE 'Production optimizations applied successfully';
END $$;
