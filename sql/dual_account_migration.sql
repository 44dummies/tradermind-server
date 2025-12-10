-- DUAL ACCOUNT SYSTEM MIGRATION (CORRECTED TARGETS)
-- Target Tables: trading_sessions (V1) and session_invitations (Active backend usage)

-- 1. Add mode to trading_sessions (V1)
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'trading_sessions' AND column_name = 'mode'
    ) THEN
        ALTER TABLE trading_sessions ADD COLUMN mode TEXT CHECK (mode IN ('real', 'demo')) DEFAULT 'real';
        RAISE NOTICE 'Added mode column to trading_sessions';
    END IF;
END $$;

-- 2. Add columns to session_invitations
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'session_invitations' AND column_name = 'account_id'
    ) THEN
        ALTER TABLE session_invitations ADD COLUMN account_id UUID REFERENCES trading_accounts(id);
        ALTER TABLE session_invitations ADD COLUMN account_type TEXT CHECK (account_type IN ('real', 'demo'));
        
        RAISE NOTICE 'Added account_id/type to session_invitations';
    END IF;
END $$;

-- 3. Backfill existing sessions
UPDATE trading_sessions SET mode = 'real' WHERE mode IS NULL;
