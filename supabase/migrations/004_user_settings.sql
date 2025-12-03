-- User Settings and Profile Enhancement Migration
-- Run this in Supabase SQL Editor

-- Add new columns to user_profiles table if they don't exist
ALTER TABLE user_profiles 
ADD COLUMN IF NOT EXISTS display_name VARCHAR(50),
ADD COLUMN IF NOT EXISTS bio TEXT,
ADD COLUMN IF NOT EXISTS status_message VARCHAR(100),
ADD COLUMN IF NOT EXISTS profile_photo_metadata JSONB;

-- Create user_settings table for storing all settings as JSONB
CREATE TABLE IF NOT EXISTS user_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  privacy JSONB DEFAULT '{
    "showUsername": true,
    "showRealName": false,
    "showEmail": false,
    "showCountry": true,
    "showPerformance": true,
    "showOnlineStatus": true,
    "profileVisibility": "public",
    "allowFriendRequests": true,
    "allowMessages": "friends"
  }'::jsonb,
  notifications JSONB DEFAULT '{
    "friendRequests": true,
    "messages": true,
    "chatMentions": true,
    "achievements": true,
    "streakReminders": true,
    "communityUpdates": true,
    "soundEnabled": true,
    "pushEnabled": false
  }'::jsonb,
  chat JSONB DEFAULT '{
    "enterToSend": true,
    "showTypingIndicator": true,
    "showReadReceipts": true,
    "autoDeleteMessages": false,
    "messageRetention": 30
  }'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id)
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_user_settings_user_id ON user_settings(user_id);

-- Enable RLS on user_settings
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

-- RLS Policies for user_settings (allow service role to bypass)
-- Drop existing policies first if they exist
DROP POLICY IF EXISTS "Users can view own settings" ON user_settings;
DROP POLICY IF EXISTS "Users can update own settings" ON user_settings;
DROP POLICY IF EXISTS "Users can insert own settings" ON user_settings;
DROP POLICY IF EXISTS "Service role full access to user_settings" ON user_settings;

-- Create policy for service role (bypasses RLS anyway, but good for documentation)
CREATE POLICY "Service role full access to user_settings" ON user_settings
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Create policies for authenticated users
CREATE POLICY "Users can view own settings" ON user_settings
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can update own settings" ON user_settings
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own settings" ON user_settings
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Update user_profiles RLS to allow service role
DROP POLICY IF EXISTS "Service role full access" ON user_profiles;
CREATE POLICY "Service role full access" ON user_profiles
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Create function to get display name (fallback to username or deriv_id)
CREATE OR REPLACE FUNCTION get_display_name(profile user_profiles)
RETURNS TEXT AS $$
BEGIN
  RETURN COALESCE(
    NULLIF(profile.display_name, ''),
    NULLIF(profile.username, ''),
    profile.deriv_id
  );
END;
$$ LANGUAGE plpgsql;

-- Create index for username search
CREATE INDEX IF NOT EXISTS idx_user_profiles_username_search 
ON user_profiles USING gin(username gin_trgm_ops);

-- If the gin_trgm extension isn't enabled, use this simpler index instead:
-- CREATE INDEX IF NOT EXISTS idx_user_profiles_username ON user_profiles(username);

COMMENT ON TABLE user_settings IS 'Stores user preferences for privacy, notifications, and chat settings';
COMMENT ON COLUMN user_settings.privacy IS 'Privacy settings as JSON: showUsername, showRealName, etc.';
COMMENT ON COLUMN user_settings.notifications IS 'Notification preferences as JSON';
COMMENT ON COLUMN user_settings.chat IS 'Chat settings as JSON: enterToSend, typingIndicator, etc.';
