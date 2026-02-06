-- Migration: Fix audit_log table - add missing checksum column
-- This fixes the error: column "checksum" of relation "audit_log" does not exist

-- Add checksum column if it doesn't exist
ALTER TABLE audit_log
  ADD COLUMN IF NOT EXISTS checksum VARCHAR(64);

-- Add other columns that may be missing from the audit middleware
ALTER TABLE audit_log
  ADD COLUMN IF NOT EXISTS api_key_id VARCHAR(50),
  ADD COLUMN IF NOT EXISTS ip_address VARCHAR(45),
  ADD COLUMN IF NOT EXISTS user_agent VARCHAR(500),
  ADD COLUMN IF NOT EXISTS path VARCHAR(255),
  ADD COLUMN IF NOT EXISTS method VARCHAR(10),
  ADD COLUMN IF NOT EXISTS request_body JSONB,
  ADD COLUMN IF NOT EXISTS response_status INT;

-- Make details column nullable if not already
DO $$
BEGIN
  ALTER TABLE audit_log ALTER COLUMN details DROP NOT NULL;
EXCEPTION WHEN others THEN
  NULL;
END $$;

-- Create indexes for security queries if not exist
CREATE INDEX IF NOT EXISTS idx_audit_log_api_key_id ON audit_log(api_key_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_ip_address ON audit_log(ip_address);
CREATE INDEX IF NOT EXISTS idx_audit_log_path ON audit_log(path);
