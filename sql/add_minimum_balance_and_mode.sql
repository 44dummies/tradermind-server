-- Add minimum_balance and mode columns to trading_sessions
-- Run this migration on your Supabase database

-- Add minimum_balance column
ALTER TABLE trading_sessions 
ADD COLUMN IF NOT EXISTS minimum_balance DECIMAL(20, 8) DEFAULT 5.0;

-- Add mode column with check constraint
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'trading_sessions' AND column_name = 'mode'
    ) THEN
        ALTER TABLE trading_sessions 
        ADD COLUMN mode VARCHAR(10) DEFAULT 'demo';
        
        -- Add check constraint
        ALTER TABLE trading_sessions 
        ADD CONSTRAINT check_session_mode CHECK (mode IN ('real', 'demo'));
    END IF;
END $$;

-- Update status constraint to include 'running' (for V1 compatibility with V2-style status)
ALTER TABLE trading_sessions 
DROP CONSTRAINT IF EXISTS check_session_status;

ALTER TABLE trading_sessions 
ADD CONSTRAINT check_session_status 
CHECK (status IN ('pending', 'active', 'running', 'paused', 'completed', 'cancelled', 'failed'));

-- Add index for mode-based queries
CREATE INDEX IF NOT EXISTS idx_trading_sessions_mode ON trading_sessions(mode);

-- Refresh schema cache (Supabase specific)
NOTIFY pgrst, 'reload schema';
