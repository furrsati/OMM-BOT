-- Migration: Ensure smart_wallets address column has UNIQUE constraint
-- Note: This database uses 'address' as the primary column (not 'wallet_address')

-- Add UNIQUE constraint on address column if not exists (required for ON CONFLICT)
-- Check for any existing unique constraint/index on the address column
DO $$
BEGIN
  -- Check if there's already a unique constraint or index on address
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'smart_wallets'
    AND indexdef LIKE '%UNIQUE%'
    AND indexdef LIKE '%address%'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE t.relname = 'smart_wallets'
    AND c.contype = 'u'
    AND EXISTS (
      SELECT 1 FROM pg_attribute a
      WHERE a.attrelid = t.oid
      AND a.attnum = ANY(c.conkey)
      AND a.attname = 'address'
    )
  ) THEN
    ALTER TABLE smart_wallets ADD CONSTRAINT smart_wallets_address_key UNIQUE (address);
  END IF;
EXCEPTION
  WHEN duplicate_object THEN
    NULL; -- Constraint already exists
  WHEN duplicate_table THEN
    NULL; -- Index already exists
  WHEN OTHERS THEN
    RAISE NOTICE 'smart_wallets address constraint check: %', SQLERRM;
END $$;

-- Create index on address for faster lookups (if not exists)
CREATE INDEX IF NOT EXISTS idx_smart_wallets_address ON smart_wallets(address);
