-- Migration: Add unique constraint for scanner functionality
-- Ensures token_address is unique in token_opportunities table
-- Required for ON CONFLICT upsert in SignalTracker

-- Add unique constraint on token_address if not exists
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

-- Add index for faster lookups by discovered_via
CREATE INDEX IF NOT EXISTS idx_token_opportunities_discovered_via
ON token_opportunities(discovered_via);

-- Add index for active opportunities (not expired, still analyzing)
CREATE INDEX IF NOT EXISTS idx_token_opportunities_active
ON token_opportunities(status, expires_at)
WHERE status IN ('ANALYZING', 'QUALIFIED');
