-- CLEANUP SCRIPT: RESET ALL SESSIONS
-- Use this to wipe old session data and start fresh.

BEGIN;

-- 1. Delete dependent data first (Trades)
DELETE FROM trades;

-- 2. Delete Participants and Invitations
DELETE FROM session_participants;
DELETE FROM session_invitations;

-- 3. Delete Sessions (Both V1 and V2 tables)
DELETE FROM trading_sessions;
DELETE FROM trading_sessions_v2;

-- 4. Reset sequences (Optional, but good for clean IDs if using serial, though UUIDs don't need this)
-- ALTER SEQUENCE trading_sessions_id_seq RESTART WITH 1; 

COMMIT;

-- Verify
SELECT count(*) as v1_count FROM trading_sessions;
SELECT count(*) as v2_count FROM trading_sessions_v2;
