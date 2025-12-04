-- =============================================
-- SETTINGS SYSTEM SQL SCHEMA
-- For Deriv-Authenticated Trading Platform
-- Uses deriv_account_id as primary identifier
-- =============================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================
-- ADD COLUMNS TO USER_PROFILES IF NOT EXISTS
-- =============================================
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS bio TEXT;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS status_message VARCHAR(200);
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS last_seen TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS is_online BOOLEAN DEFAULT FALSE;

-- =============================================
-- USER SETTINGS TABLE
-- Privacy, notifications, security settings
-- =============================================
CREATE TABLE IF NOT EXISTS user_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  
  -- Privacy Settings
  online_visibility BOOLEAN DEFAULT TRUE,
  profile_visibility VARCHAR(20) DEFAULT 'public' CHECK (profile_visibility IN ('public', 'friends', 'private')),
  allow_messages_from VARCHAR(20) DEFAULT 'everyone' CHECK (allow_messages_from IN ('everyone', 'friends', 'none')),
  allow_tags_from VARCHAR(20) DEFAULT 'everyone' CHECK (allow_tags_from IN ('everyone', 'friends', 'none')),
  show_trading_stats BOOLEAN DEFAULT TRUE,
  show_on_leaderboard BOOLEAN DEFAULT TRUE,
  searchable BOOLEAN DEFAULT TRUE,
  
  -- Notification Settings
  notify_trade_alerts BOOLEAN DEFAULT TRUE,
  notify_community_mentions BOOLEAN DEFAULT TRUE,
  notify_post_replies BOOLEAN DEFAULT TRUE,
  notify_new_followers BOOLEAN DEFAULT TRUE,
  notify_admin_announcements BOOLEAN DEFAULT TRUE,
  push_notifications BOOLEAN DEFAULT TRUE,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(user_id)
);

-- =============================================
-- TRADING PREFERENCES TABLE
-- User's trading configuration
-- =============================================
CREATE TABLE IF NOT EXISTS trading_preferences (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  
  -- Market Preferences
  default_market VARCHAR(50) DEFAULT 'boom_crash' CHECK (default_market IN ('boom_crash', 'binary', 'forex', 'indices', 'commodities', 'crypto')),
  favorite_markets JSONB DEFAULT '["boom_crash"]',
  
  -- Trade Settings
  default_stake_amount DECIMAL(15, 2) DEFAULT 10.00,
  max_stake_amount DECIMAL(15, 2) DEFAULT 1000.00,
  
  -- Risk Settings
  risk_level VARCHAR(20) DEFAULT 'medium' CHECK (risk_level IN ('low', 'medium', 'high')),
  stop_loss_enabled BOOLEAN DEFAULT TRUE,
  default_stop_loss_percent DECIMAL(5, 2) DEFAULT 5.00,
  take_profit_enabled BOOLEAN DEFAULT TRUE,
  default_take_profit_percent DECIMAL(5, 2) DEFAULT 10.00,
  
  -- Sound Settings
  sound_enabled BOOLEAN DEFAULT TRUE,
  sound_trade_open BOOLEAN DEFAULT TRUE,
  sound_trade_win BOOLEAN DEFAULT TRUE,
  sound_trade_loss BOOLEAN DEFAULT TRUE,
  sound_volume INTEGER DEFAULT 70 CHECK (sound_volume >= 0 AND sound_volume <= 100),
  
  -- Display Preferences
  chart_theme VARCHAR(20) DEFAULT 'dark',
  default_timeframe VARCHAR(10) DEFAULT '1m',
  compact_mode BOOLEAN DEFAULT FALSE,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(user_id)
);

-- =============================================
-- ACTIVE SESSIONS TABLE
-- Track WebSocket and device sessions
-- =============================================
CREATE TABLE IF NOT EXISTS active_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  
  -- Session Info
  socket_id VARCHAR(100),
  session_token TEXT,
  
  -- Device Info
  ip_address INET,
  user_agent TEXT,
  device_type VARCHAR(50),
  device_name VARCHAR(100),
  browser VARCHAR(100),
  os VARCHAR(100),
  
  -- Location
  location_country VARCHAR(100),
  location_city VARCHAR(100),
  
  -- Status
  is_current BOOLEAN DEFAULT FALSE,
  is_trusted BOOLEAN DEFAULT FALSE,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '7 days')
);

-- Indexes for active_sessions
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON active_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_socket_id ON active_sessions(socket_id);
CREATE INDEX IF NOT EXISTS idx_sessions_last_seen ON active_sessions(last_seen DESC);

-- =============================================
-- TRUSTED DEVICES TABLE
-- Store verified devices
-- =============================================
CREATE TABLE IF NOT EXISTS trusted_devices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  
  device_fingerprint TEXT NOT NULL,
  device_name VARCHAR(100),
  device_type VARCHAR(50),
  browser VARCHAR(100),
  os VARCHAR(100),
  
  trusted_at TIMESTAMPTZ DEFAULT NOW(),
  last_used TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '90 days'),
  
  UNIQUE(user_id, device_fingerprint)
);

-- =============================================
-- SETTINGS CHANGELOG
-- Audit trail for settings changes
-- =============================================
CREATE TABLE IF NOT EXISTS settings_changelog (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  
  setting_type VARCHAR(50) NOT NULL,
  setting_key VARCHAR(100) NOT NULL,
  old_value TEXT,
  new_value TEXT,
  
  ip_address INET,
  changed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_changelog_user_id ON settings_changelog(user_id);
CREATE INDEX IF NOT EXISTS idx_changelog_changed_at ON settings_changelog(changed_at DESC);

-- =============================================
-- FUNCTIONS
-- =============================================

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create default settings for new user
CREATE OR REPLACE FUNCTION create_default_settings()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO user_settings (user_id) VALUES (NEW.id) ON CONFLICT (user_id) DO NOTHING;
  INSERT INTO trading_preferences (user_id) VALUES (NEW.id) ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- TRIGGERS
-- =============================================

-- Auto-update timestamps
DROP TRIGGER IF EXISTS trigger_user_settings_updated ON user_settings;
CREATE TRIGGER trigger_user_settings_updated
BEFORE UPDATE ON user_settings
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_trading_prefs_updated ON trading_preferences;
CREATE TRIGGER trigger_trading_prefs_updated
BEFORE UPDATE ON trading_preferences
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create default settings on new user
DROP TRIGGER IF EXISTS trigger_create_default_settings ON user_profiles;
CREATE TRIGGER trigger_create_default_settings
AFTER INSERT ON user_profiles
FOR EACH ROW EXECUTE FUNCTION create_default_settings();

-- =============================================
-- ENABLE ROW LEVEL SECURITY
-- =============================================

ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE trading_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE active_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE trusted_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings_changelog ENABLE ROW LEVEL SECURITY;

-- =============================================
-- RLS POLICIES - user_settings
-- =============================================

DROP POLICY IF EXISTS "Users can view own settings" ON user_settings;
CREATE POLICY "Users can view own settings" ON user_settings
FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS "Users can update own settings" ON user_settings;
CREATE POLICY "Users can update own settings" ON user_settings
FOR UPDATE USING (TRUE);

DROP POLICY IF EXISTS "System can insert settings" ON user_settings;
CREATE POLICY "System can insert settings" ON user_settings
FOR INSERT WITH CHECK (TRUE);

-- =============================================
-- RLS POLICIES - trading_preferences
-- =============================================

DROP POLICY IF EXISTS "Users can view own trading prefs" ON trading_preferences;
CREATE POLICY "Users can view own trading prefs" ON trading_preferences
FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS "Users can update own trading prefs" ON trading_preferences;
CREATE POLICY "Users can update own trading prefs" ON trading_preferences
FOR UPDATE USING (TRUE);

DROP POLICY IF EXISTS "System can insert trading prefs" ON trading_preferences;
CREATE POLICY "System can insert trading prefs" ON trading_preferences
FOR INSERT WITH CHECK (TRUE);

-- =============================================
-- RLS POLICIES - active_sessions
-- =============================================

DROP POLICY IF EXISTS "Users can view own sessions" ON active_sessions;
CREATE POLICY "Users can view own sessions" ON active_sessions
FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS "System can manage sessions" ON active_sessions;
CREATE POLICY "System can manage sessions" ON active_sessions
FOR ALL USING (TRUE);

-- =============================================
-- RLS POLICIES - trusted_devices
-- =============================================

DROP POLICY IF EXISTS "Users can manage own devices" ON trusted_devices;
CREATE POLICY "Users can manage own devices" ON trusted_devices
FOR ALL USING (TRUE);

-- Done!
SELECT 'Settings schema created!' as status;
