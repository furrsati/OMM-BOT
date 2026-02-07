-- Migration: 008_paper_trading.sql
-- Description: Add paper trading tables for simulated trading
-- Created: 2024

-- ============================================================
-- PAPER TRADES TABLE
-- Stores all simulated trade entries and exits
-- ============================================================
CREATE TABLE IF NOT EXISTS paper_trades (
    id SERIAL PRIMARY KEY,

    -- Token information
    token_address VARCHAR(64) NOT NULL,
    token_name VARCHAR(128),
    token_symbol VARCHAR(32),

    -- Entry details
    entry_price DECIMAL(30, 18) NOT NULL,
    entry_amount_sol DECIMAL(20, 9) NOT NULL,
    entry_amount_tokens DECIMAL(30, 9),
    entry_time TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    entry_conviction_score DECIMAL(5, 2),
    entry_signal JSONB, -- Full signal data at entry

    -- Exit details (NULL if position still open)
    exit_price DECIMAL(30, 18),
    exit_amount_sol DECIMAL(20, 9),
    exit_time TIMESTAMP WITH TIME ZONE,
    exit_reason VARCHAR(64), -- TAKE_PROFIT_1, STOP_LOSS, TRAILING_STOP, etc.

    -- P&L tracking
    pnl_sol DECIMAL(20, 9) DEFAULT 0,
    pnl_percent DECIMAL(10, 4) DEFAULT 0,
    pnl_usd DECIMAL(20, 2) DEFAULT 0,

    -- Trade metadata
    position_size_percent DECIMAL(5, 2), -- % of paper wallet used
    conviction_level VARCHAR(16), -- HIGH, MEDIUM, LOW
    entry_type VARCHAR(32), -- EARLY_DISCOVERY, PRIMARY, SECONDARY, TIER3_CLUSTER

    -- Status
    status VARCHAR(16) DEFAULT 'OPEN', -- OPEN, CLOSED, CANCELLED
    outcome VARCHAR(16), -- WIN, LOSS, BREAKEVEN (set on close)

    -- Smart wallet info
    smart_wallets_triggered TEXT[], -- Array of wallet addresses that triggered
    tier1_count INTEGER DEFAULT 0,
    tier2_count INTEGER DEFAULT 0,
    tier3_count INTEGER DEFAULT 0,

    -- Learning data (fingerprint for pattern matching)
    fingerprint JSONB,

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================
-- PAPER POSITIONS TABLE
-- Tracks currently open paper positions with real-time updates
-- ============================================================
CREATE TABLE IF NOT EXISTS paper_positions (
    id SERIAL PRIMARY KEY,
    paper_trade_id INTEGER REFERENCES paper_trades(id) ON DELETE CASCADE,

    -- Token info
    token_address VARCHAR(64) NOT NULL UNIQUE,
    token_name VARCHAR(128),
    token_symbol VARCHAR(32),

    -- Position details
    entry_price DECIMAL(30, 18) NOT NULL,
    entry_amount_sol DECIMAL(20, 9) NOT NULL,
    entry_amount_tokens DECIMAL(30, 9),
    remaining_amount_tokens DECIMAL(30, 9),
    entry_time TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Current state
    current_price DECIMAL(30, 18),
    highest_price DECIMAL(30, 18),
    lowest_price DECIMAL(30, 18),

    -- P&L
    unrealized_pnl_sol DECIMAL(20, 9) DEFAULT 0,
    unrealized_pnl_percent DECIMAL(10, 4) DEFAULT 0,
    unrealized_pnl_usd DECIMAL(20, 2) DEFAULT 0,

    -- Stop loss & Take profit tracking
    stop_loss_price DECIMAL(30, 18),
    stop_loss_percent DECIMAL(5, 2) DEFAULT 25,
    trailing_stop_active BOOLEAN DEFAULT FALSE,
    trailing_stop_price DECIMAL(30, 18),
    trailing_stop_percent DECIMAL(5, 2),

    -- Take profit levels hit
    take_profit_1_hit BOOLEAN DEFAULT FALSE, -- +30%
    take_profit_2_hit BOOLEAN DEFAULT FALSE, -- +60%
    take_profit_3_hit BOOLEAN DEFAULT FALSE, -- +100%
    take_profit_4_hit BOOLEAN DEFAULT FALSE, -- +200%

    -- Amounts sold at each TP
    tp1_amount_sold DECIMAL(30, 9) DEFAULT 0,
    tp2_amount_sold DECIMAL(30, 9) DEFAULT 0,
    tp3_amount_sold DECIMAL(30, 9) DEFAULT 0,
    tp4_amount_sold DECIMAL(30, 9) DEFAULT 0,

    -- Realized P&L from partial exits
    realized_pnl_sol DECIMAL(20, 9) DEFAULT 0,
    realized_pnl_usd DECIMAL(20, 2) DEFAULT 0,

    -- Status
    status VARCHAR(16) DEFAULT 'ACTIVE', -- ACTIVE, CLOSED

    -- Danger monitoring
    danger_signals JSONB DEFAULT '[]'::JSONB,
    last_danger_check TIMESTAMP WITH TIME ZONE,

    -- Smart wallets still holding
    smart_wallets_holding TEXT[],
    smart_wallets_exited TEXT[],

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_price_update TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================
-- PAPER WALLET TABLE
-- Simulated wallet balance and statistics
-- ============================================================
CREATE TABLE IF NOT EXISTS paper_wallet (
    id SERIAL PRIMARY KEY,

    -- Balance
    initial_balance_sol DECIMAL(20, 9) DEFAULT 10.0,
    current_balance_sol DECIMAL(20, 9) DEFAULT 10.0,
    reserved_balance_sol DECIMAL(20, 9) DEFAULT 0, -- In open positions
    available_balance_sol DECIMAL(20, 9) DEFAULT 10.0,

    -- USD values (for display)
    initial_balance_usd DECIMAL(20, 2),
    current_balance_usd DECIMAL(20, 2),

    -- Performance stats
    total_trades INTEGER DEFAULT 0,
    winning_trades INTEGER DEFAULT 0,
    losing_trades INTEGER DEFAULT 0,
    breakeven_trades INTEGER DEFAULT 0,

    -- P&L
    total_pnl_sol DECIMAL(20, 9) DEFAULT 0,
    total_pnl_usd DECIMAL(20, 2) DEFAULT 0,
    total_pnl_percent DECIMAL(10, 4) DEFAULT 0,

    -- Best/Worst
    best_trade_pnl_percent DECIMAL(10, 4) DEFAULT 0,
    worst_trade_pnl_percent DECIMAL(10, 4) DEFAULT 0,
    best_trade_token VARCHAR(64),
    worst_trade_token VARCHAR(64),

    -- Streaks
    current_streak INTEGER DEFAULT 0, -- Positive = wins, negative = losses
    longest_win_streak INTEGER DEFAULT 0,
    longest_loss_streak INTEGER DEFAULT 0,

    -- Daily limits tracking
    daily_pnl_sol DECIMAL(20, 9) DEFAULT 0,
    daily_pnl_percent DECIMAL(10, 4) DEFAULT 0,
    daily_trades INTEGER DEFAULT 0,
    daily_reset_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Settings
    max_position_size_percent DECIMAL(5, 2) DEFAULT 5.0,
    max_open_positions INTEGER DEFAULT 5,
    max_daily_loss_percent DECIMAL(5, 2) DEFAULT 8.0,
    max_daily_profit_percent DECIMAL(5, 2) DEFAULT 15.0,

    -- State
    is_active BOOLEAN DEFAULT TRUE,
    is_paused BOOLEAN DEFAULT FALSE,
    pause_reason VARCHAR(128),

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_trade_at TIMESTAMP WITH TIME ZONE
);

-- ============================================================
-- PAPER TRADING DAILY STATS
-- Daily performance snapshots for charts
-- ============================================================
CREATE TABLE IF NOT EXISTS paper_daily_stats (
    id SERIAL PRIMARY KEY,
    date DATE NOT NULL UNIQUE,

    -- Balance at end of day
    balance_sol DECIMAL(20, 9),
    balance_usd DECIMAL(20, 2),

    -- Daily metrics
    trades_count INTEGER DEFAULT 0,
    wins INTEGER DEFAULT 0,
    losses INTEGER DEFAULT 0,

    -- P&L
    pnl_sol DECIMAL(20, 9) DEFAULT 0,
    pnl_usd DECIMAL(20, 2) DEFAULT 0,
    pnl_percent DECIMAL(10, 4) DEFAULT 0,

    -- Volume
    volume_sol DECIMAL(20, 9) DEFAULT 0,

    -- Best/Worst of day
    best_trade_percent DECIMAL(10, 4),
    worst_trade_percent DECIMAL(10, 4),

    -- Market conditions
    sol_price_usd DECIMAL(20, 2),
    market_regime VARCHAR(16),

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================
-- PAPER TRADE EVENTS
-- Detailed event log for paper trades (entries, partial exits, alerts)
-- ============================================================
CREATE TABLE IF NOT EXISTS paper_trade_events (
    id SERIAL PRIMARY KEY,
    paper_trade_id INTEGER REFERENCES paper_trades(id) ON DELETE CASCADE,
    paper_position_id INTEGER REFERENCES paper_positions(id) ON DELETE CASCADE,

    -- Event details
    event_type VARCHAR(32) NOT NULL, -- ENTRY, PARTIAL_EXIT, FULL_EXIT, TP_HIT, SL_HIT, TRAILING_ACTIVATED, DANGER_DETECTED
    event_data JSONB,

    -- Price at event
    price_at_event DECIMAL(30, 18),
    pnl_at_event DECIMAL(10, 4),

    -- Message for console display
    message TEXT,
    severity VARCHAR(16) DEFAULT 'INFO', -- INFO, WARNING, SUCCESS, DANGER

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================
-- INDEXES
-- ============================================================

-- Paper trades indexes
CREATE INDEX IF NOT EXISTS idx_paper_trades_token ON paper_trades(token_address);
CREATE INDEX IF NOT EXISTS idx_paper_trades_status ON paper_trades(status);
CREATE INDEX IF NOT EXISTS idx_paper_trades_created ON paper_trades(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_paper_trades_outcome ON paper_trades(outcome);

-- Paper positions indexes
CREATE INDEX IF NOT EXISTS idx_paper_positions_token ON paper_positions(token_address);
CREATE INDEX IF NOT EXISTS idx_paper_positions_status ON paper_positions(status);
CREATE INDEX IF NOT EXISTS idx_paper_positions_trade ON paper_positions(paper_trade_id);

-- Paper daily stats indexes
CREATE INDEX IF NOT EXISTS idx_paper_daily_stats_date ON paper_daily_stats(date DESC);

-- Paper trade events indexes
CREATE INDEX IF NOT EXISTS idx_paper_events_trade ON paper_trade_events(paper_trade_id);
CREATE INDEX IF NOT EXISTS idx_paper_events_position ON paper_trade_events(paper_position_id);
CREATE INDEX IF NOT EXISTS idx_paper_events_type ON paper_trade_events(event_type);
CREATE INDEX IF NOT EXISTS idx_paper_events_created ON paper_trade_events(created_at DESC);

-- ============================================================
-- INSERT DEFAULT PAPER WALLET
-- ============================================================
INSERT INTO paper_wallet (
    initial_balance_sol,
    current_balance_sol,
    available_balance_sol
) VALUES (10.0, 10.0, 10.0)
ON CONFLICT DO NOTHING;

-- ============================================================
-- UPDATE TRIGGER for updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION update_paper_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply triggers
DROP TRIGGER IF EXISTS paper_trades_updated_at ON paper_trades;
CREATE TRIGGER paper_trades_updated_at
    BEFORE UPDATE ON paper_trades
    FOR EACH ROW EXECUTE FUNCTION update_paper_updated_at();

DROP TRIGGER IF EXISTS paper_positions_updated_at ON paper_positions;
CREATE TRIGGER paper_positions_updated_at
    BEFORE UPDATE ON paper_positions
    FOR EACH ROW EXECUTE FUNCTION update_paper_updated_at();

DROP TRIGGER IF EXISTS paper_wallet_updated_at ON paper_wallet;
CREATE TRIGGER paper_wallet_updated_at
    BEFORE UPDATE ON paper_wallet
    FOR EACH ROW EXECUTE FUNCTION update_paper_updated_at();

-- ============================================================
-- MIGRATION COMPLETE
-- ============================================================
