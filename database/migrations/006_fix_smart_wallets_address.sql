-- Migration: Ensure smart_wallets address column has UNIQUE constraint
-- Note: This database uses 'address' as the primary column (not 'wallet_address')

-- Add UNIQUE constraint on address column if not exists (required for ON CONFLICT)
-- Uses exception handling to gracefully handle if constraint already exists
DO $$
BEGIN
  -- Check if constraint exists in current schema
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE c.conname = 'smart_wallets_address_key'
    AND n.nspname = current_schema()
  ) THEN
    ALTER TABLE smart_wallets ADD CONSTRAINT smart_wallets_address_key UNIQUE (address);
  END IF;
EXCEPTION
  WHEN duplicate_object THEN
    -- Constraint already exists, safe to ignore
    NULL;
END $$;

-- Create index on address for faster lookups (if not exists)
CREATE INDEX IF NOT EXISTS idx_smart_wallets_address ON smart_wallets(address);
