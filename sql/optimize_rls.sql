-- =====================================================
-- OPTIMIZE RLS POLICIES
-- Resolves 'auth_rls_initplan' and 'multiple_permissive_policies' warnings
-- Run this in Supabase SQL Editor
-- =====================================================

-- 1. TRADING SESSIONS V2
DROP POLICY IF EXISTS "trading_sessions_admin_all" ON trading_sessions_v2;
DROP POLICY IF EXISTS "trading_sessions_user_read" ON trading_sessions_v2;

-- Combined SELECT policy (Users + Admins)
CREATE POLICY "trading_sessions_select" ON trading_sessions_v2
  FOR SELECT
  TO authenticated
  USING (
    status IN ('pending', 'running') OR
    EXISTS (SELECT 1 FROM user_profiles WHERE id = (select auth.uid()) AND is_admin = true)
  );

-- Admin Write Access (Insert/Update/Delete)
CREATE POLICY "trading_sessions_admin_insert" ON trading_sessions_v2 FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM user_profiles WHERE id = (select auth.uid()) AND is_admin = true));
CREATE POLICY "trading_sessions_admin_update" ON trading_sessions_v2 FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM user_profiles WHERE id = (select auth.uid()) AND is_admin = true));
CREATE POLICY "trading_sessions_admin_delete" ON trading_sessions_v2 FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM user_profiles WHERE id = (select auth.uid()) AND is_admin = true));


-- 2. SESSION PARTICIPANTS
DROP POLICY IF EXISTS "session_participants_user_own" ON session_participants;
DROP POLICY IF EXISTS "session_participants_admin_all" ON session_participants;

-- Combined Access Policy (ALL is fine here as logic is identical for all actions for both roles)
CREATE POLICY "session_participants_access" ON session_participants
  FOR ALL
  TO authenticated
  USING (
    user_id = (select auth.uid()) OR
    EXISTS (SELECT 1 FROM user_profiles WHERE id = (select auth.uid()) AND is_admin = true)
  );


-- 3. USER TRADING SETTINGS
DROP POLICY IF EXISTS "user_settings_own" ON user_trading_settings;

CREATE POLICY "user_settings_own" ON user_trading_settings
  FOR ALL
  TO authenticated
  USING (user_id = (select auth.uid()));


-- 4. SYSTEM NOTIFICATIONS
DROP POLICY IF EXISTS "notifications_user" ON system_notifications;

CREATE POLICY "notifications_user" ON system_notifications
  FOR SELECT
  TO authenticated
  USING (user_id = (select auth.uid()) OR user_id IS NULL);

-- Admin Write Access (Send Notifications)
CREATE POLICY "notifications_admin_insert" ON system_notifications FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM user_profiles WHERE id = (select auth.uid()) AND is_admin = true));
CREATE POLICY "notifications_admin_update" ON system_notifications FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM user_profiles WHERE id = (select auth.uid()) AND is_admin = true));
CREATE POLICY "notifications_admin_delete" ON system_notifications FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM user_profiles WHERE id = (select auth.uid()) AND is_admin = true));


-- 5. TRADE LOGS
DROP POLICY IF EXISTS "trade_logs_user_own" ON trade_logs;
DROP POLICY IF EXISTS "trade_logs_admin_all" ON trade_logs;

-- Combined SELECT Policy
CREATE POLICY "trade_logs_select" ON trade_logs
  FOR SELECT
  TO authenticated
  USING (
    user_id = (select auth.uid()) OR
    EXISTS (SELECT 1 FROM user_profiles WHERE id = (select auth.uid()) AND is_admin = true)
  );

-- Admin Write Access
CREATE POLICY "trade_logs_admin_insert" ON trade_logs FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM user_profiles WHERE id = (select auth.uid()) AND is_admin = true));
CREATE POLICY "trade_logs_admin_update" ON trade_logs FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM user_profiles WHERE id = (select auth.uid()) AND is_admin = true));
CREATE POLICY "trade_logs_admin_delete" ON trade_logs FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM user_profiles WHERE id = (select auth.uid()) AND is_admin = true));


-- 6. ACTIVITY LOGS V2
DROP POLICY IF EXISTS "activity_logs_admin" ON activity_logs_v2;

CREATE POLICY "activity_logs_admin" ON activity_logs_v2
  FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM user_profiles WHERE id = (select auth.uid()) AND is_admin = true)
  );
