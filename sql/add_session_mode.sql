-- Add mode column to trading_sessions
ALTER TABLE trading_sessions 
ADD COLUMN IF NOT EXISTS mode VARCHAR(10) DEFAULT 'real';

-- Add check constraint for mode
ALTER TABLE trading_sessions 
DROP CONSTRAINT IF EXISTS check_session_mode;

ALTER TABLE trading_sessions
ADD CONSTRAINT check_session_mode CHECK (mode IN ('real', 'demo'));

-- Update existing sessions to default 'real' if null
UPDATE trading_sessions SET mode = 'real' WHERE mode IS NULL;
