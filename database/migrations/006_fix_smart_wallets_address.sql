-- Migration: Ensure smart_wallets address column has UNIQUE constraint
-- Note: This database uses 'address' as the primary column (not 'wallet_address')

-- Add UNIQUE constraint on address column if not exists (required for ON CONFLICT)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'smart_wallets_address_key'
  ) THEN
    ALTER TABLE smart_wallets ADD CONSTRAINT smart_wallets_address_key UNIQUE (address);
  END IF;
END $$;

-- Create index on address for faster lookups (if not exists)
CREATE INDEX IF NOT EXISTS idx_smart_wallets_address ON smart_wallets(address);
