-- =====================================================
-- LEARNING ENGINE TABLES
-- Phase 7: Adaptive Intelligence System
-- =====================================================

-- =====================================================
-- LEARNING WEIGHTS TABLE
-- Tracks category weight adjustments over time
-- =====================================================
CREATE TABLE learning_weights (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  version INT NOT NULL,
  weights JSONB NOT NULL,
  reason TEXT NOT NULL,
  performance_before JSONB,
  performance_after JSONB,
  trade_count INT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_learning_weights_version ON learning_weights(version DESC);
CREATE INDEX idx_learning_weights_created_at ON learning_weights(created_at DESC);

-- =====================================================
-- LEARNING PARAMETERS TABLE
-- Tracks parameter tuning adjustments over time
-- =====================================================
CREATE TABLE learning_parameters (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  version INT NOT NULL,
  parameter_name VARCHAR(100) NOT NULL,
  old_value JSONB NOT NULL,
  new_value JSONB NOT NULL,
  reason TEXT NOT NULL,
  performance_impact JSONB,
  trade_count INT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_learning_parameters_version ON learning_parameters(version DESC);
CREATE INDEX idx_learning_parameters_name ON learning_parameters(parameter_name);
CREATE INDEX idx_learning_parameters_created_at ON learning_parameters(created_at DESC);

-- =====================================================
-- LEARNING META TABLE
-- Tracks meta-learning evaluations and adjustments
-- =====================================================
CREATE TABLE learning_meta (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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

CREATE INDEX idx_learning_meta_cycle_id ON learning_meta(cycle_id DESC);
CREATE INDEX idx_learning_meta_cycle_type ON learning_meta(cycle_type);
CREATE INDEX idx_learning_meta_improvement ON learning_meta(improvement_flag);
CREATE INDEX idx_learning_meta_created_at ON learning_meta(created_at DESC);

-- =====================================================
-- LEARNING CYCLES TABLE
-- Tracks when each learning cycle ran
-- =====================================================
CREATE TABLE learning_cycles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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

CREATE INDEX idx_learning_cycles_cycle_number ON learning_cycles(cycle_number DESC);
CREATE INDEX idx_learning_cycles_cycle_type ON learning_cycles(cycle_type);
CREATE INDEX idx_learning_cycles_status ON learning_cycles(status);
CREATE INDEX idx_learning_cycles_created_at ON learning_cycles(created_at DESC);

-- =====================================================
-- FROZEN PARAMETERS TABLE
-- Tracks parameters that operator has locked
-- =====================================================
CREATE TABLE frozen_parameters (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  parameter_name VARCHAR(100) NOT NULL UNIQUE,
  frozen_value JSONB NOT NULL,
  reason TEXT NOT NULL,
  frozen_by VARCHAR(100) DEFAULT 'operator',
  frozen_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_frozen_parameters_name ON frozen_parameters(parameter_name);

-- =====================================================
-- LEARNING STATISTICS VIEW
-- Convenient view for monitoring learning performance
-- =====================================================
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
-- COMMENTS
-- =====================================================
COMMENT ON TABLE learning_weights IS 'Stores history of category weight adjustments made by Weight Optimizer';
COMMENT ON TABLE learning_parameters IS 'Stores history of parameter tuning adjustments made by Parameter Tuner';
COMMENT ON TABLE learning_meta IS 'Stores meta-learning evaluations and impact assessments';
COMMENT ON TABLE learning_cycles IS 'Tracks execution of learning cycles (every 50/100/200 trades)';
COMMENT ON TABLE frozen_parameters IS 'Parameters locked by operator to prevent Learning Engine modifications';
