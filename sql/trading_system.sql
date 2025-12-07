-- Deriv Multi-Account Trading System Database Schema
-- Run this migration to set up the required tables

-- =====================================================
-- TRADING SESSIONS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS trading_sessions_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL,
  name TEXT NOT NULL,
  type TEXT CHECK (type IN ('day', 'one_time', 'recovery')) DEFAULT 'day',
  status TEXT CHECK (status IN ('pending', 'running', 'paused', 'completed', 'cancelled')) DEFAULT 'pending',
  min_balance DECIMAL(10,2) DEFAULT 10.00,
  default_tp DECIMAL(10,2) DEFAULT 10.00,
  default_sl DECIMAL(10,2) DEFAULT 5.00,
  markets TEXT[] DEFAULT '{"R_100"}',
  strategy TEXT DEFAULT 'DFPM',
  staking_mode TEXT DEFAULT 'fixed',
  base_stake DECIMAL(10,2) DEFAULT 1.00,
  current_pnl DECIMAL(10,2) DEFAULT 0,
  trade_count INTEGER DEFAULT 0,
  win_count INTEGER DEFAULT 0,
  loss_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  started_at TIMESTAMP WITH TIME ZONE,
  ended_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_trading_sessions_v2_status ON trading_sessions_v2(status);
CREATE INDEX IF NOT EXISTS idx_trading_sessions_v2_type ON trading_sessions_v2(type);
CREATE INDEX IF NOT EXISTS idx_trading_sessions_v2_admin ON trading_sessions_v2(admin_id);

-- =====================================================
-- SESSION PARTICIPANTS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS session_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES trading_sessions_v2(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  tp DECIMAL(10,2) NOT NULL,
  sl DECIMAL(10,2) NOT NULL,
  status TEXT CHECK (status IN ('active', 'removed_tp', 'removed_sl', 'left', 'kicked')) DEFAULT 'active',
  initial_balance DECIMAL(10,2),
  current_pnl DECIMAL(10,2) DEFAULT 0,
  accepted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  removed_at TIMESTAMP WITH TIME ZONE,
  removal_reason TEXT,
  UNIQUE(session_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_session_participants_session ON session_participants(session_id);
CREATE INDEX IF NOT EXISTS idx_session_participants_user ON session_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_session_participants_status ON session_participants(status);

-- =====================================================
-- USER TRADING SETTINGS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS user_trading_settings (
  user_id UUID PRIMARY KEY,
  default_tp DECIMAL(10,2) DEFAULT 10.00,
  default_sl DECIMAL(10,2) DEFAULT 5.00,
  can_join_recovery BOOLEAN DEFAULT FALSE,
  last_sl_hit_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =====================================================
-- SYSTEM NOTIFICATIONS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS system_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,  -- NULL for broadcasts
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_system_notifications_user ON system_notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_system_notifications_type ON system_notifications(type);
CREATE INDEX IF NOT EXISTS idx_system_notifications_read ON system_notifications(read);
CREATE INDEX IF NOT EXISTS idx_system_notifications_created ON system_notifications(created_at DESC);

-- =====================================================
-- TRADE LOGS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS trade_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES trading_sessions_v2(id) ON DELETE SET NULL,
  user_id UUID,
  account_id TEXT,
  contract_id TEXT,
  market TEXT,
  contract_type TEXT,
  strategy TEXT,
  stake DECIMAL(10,2),
  prediction INTEGER,
  entry_tick DECIMAL(20,8),
  exit_tick DECIMAL(20,8),
  result TEXT CHECK (result IN ('pending', 'won', 'lost', 'cancelled')),
  profit DECIMAL(10,2),
  confidence DECIMAL(5,2),
  signal_reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  closed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_trade_logs_session ON trade_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_trade_logs_user ON trade_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_trade_logs_result ON trade_logs(result);
CREATE INDEX IF NOT EXISTS idx_trade_logs_created ON trade_logs(created_at DESC);

-- =====================================================
-- ACTIVITY LOGS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS activity_logs_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL,
  level TEXT CHECK (level IN ('debug', 'info', 'warning', 'error')) DEFAULT 'info',
  message TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  user_id UUID,
  session_id UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_logs_v2_type ON activity_logs_v2(type);
CREATE INDEX IF NOT EXISTS idx_activity_logs_v2_level ON activity_logs_v2(level);
CREATE INDEX IF NOT EXISTS idx_activity_logs_v2_user ON activity_logs_v2(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_v2_session ON activity_logs_v2(session_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_v2_created ON activity_logs_v2(created_at DESC);

-- =====================================================
-- ADD is_admin COLUMN TO user_profiles IF NOT EXISTS
-- =====================================================
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'user_profiles' AND column_name = 'is_admin'
  ) THEN
    ALTER TABLE user_profiles ADD COLUMN is_admin BOOLEAN DEFAULT FALSE;
  END IF;
END $$;

DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'user_profiles' AND column_name = 'role'
  ) THEN
    ALTER TABLE user_profiles ADD COLUMN role TEXT DEFAULT 'user';
  END IF;
END $$;

-- =====================================================
-- ROW LEVEL SECURITY POLICIES
-- =====================================================

-- Enable RLS on new tables
ALTER TABLE trading_sessions_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_trading_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs_v2 ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "trading_sessions_admin_all" ON trading_sessions_v2;
DROP POLICY IF EXISTS "trading_sessions_user_read" ON trading_sessions_v2;
DROP POLICY IF EXISTS "session_participants_user_own" ON session_participants;
DROP POLICY IF EXISTS "session_participants_admin_all" ON session_participants;
DROP POLICY IF EXISTS "user_settings_own" ON user_trading_settings;
DROP POLICY IF EXISTS "notifications_user" ON system_notifications;
DROP POLICY IF EXISTS "trade_logs_user_own" ON trade_logs;
DROP POLICY IF EXISTS "trade_logs_admin_all" ON trade_logs;
DROP POLICY IF EXISTS "activity_logs_admin" ON activity_logs_v2;

-- Policy for trading_sessions_v2 - admins can do everything
CREATE POLICY "trading_sessions_admin_all" ON trading_sessions_v2
  FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_admin = true)
  );

-- Policy for trading_sessions_v2 - users can read active sessions
CREATE POLICY "trading_sessions_user_read" ON trading_sessions_v2
  FOR SELECT
  TO authenticated
  USING (status IN ('pending', 'running'));

-- Policy for session_participants - users can see their own
CREATE POLICY "session_participants_user_own" ON session_participants
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid());

-- Policy for session_participants - admin can see all
CREATE POLICY "session_participants_admin_all" ON session_participants
  FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_admin = true)
  );

-- Policy for user_trading_settings
CREATE POLICY "user_settings_own" ON user_trading_settings
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid());

-- Policy for notifications - users see their own + broadcasts
CREATE POLICY "notifications_user" ON system_notifications
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR user_id IS NULL);

-- Policy for trade_logs - users see their own
CREATE POLICY "trade_logs_user_own" ON trade_logs
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Policy for trade_logs - admin can see all
CREATE POLICY "trade_logs_admin_all" ON trade_logs
  FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_admin = true)
  );

-- Policy for activity_logs - admin only
CREATE POLICY "activity_logs_admin" ON activity_logs_v2
  FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_admin = true)
  );

-- Grant service role access for backend operations
GRANT ALL ON trading_sessions_v2 TO service_role;
GRANT ALL ON session_participants TO service_role;
GRANT ALL ON user_trading_settings TO service_role;
GRANT ALL ON system_notifications TO service_role;
GRANT ALL ON trade_logs TO service_role;
GRANT ALL ON activity_logs_v2 TO service_role;
