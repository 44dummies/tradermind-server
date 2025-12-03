-- Fix user_settings table - Complete Recreation
-- Run this in Supabase SQL Editor

-- Drop and recreate user_settings table to ensure correct schema
DROP TABLE IF EXISTS user_settings CASCADE;

-- Create user_settings table with all required columns
CREATE TABLE user_settings (
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
CREATE INDEX idx_user_settings_user_id ON user_settings(user_id);

-- Enable RLS on user_settings
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

-- Create policy for service role (full access)
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

-- Add missing columns to user_profiles if not exists
ALTER TABLE user_profiles 
ADD COLUMN IF NOT EXISTS is_first_login BOOLEAN DEFAULT true;

ALTER TABLE user_profiles 
ADD COLUMN IF NOT EXISTS is_profile_complete BOOLEAN DEFAULT false;

ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS display_name VARCHAR(50);

ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS bio TEXT;

ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS status_message VARCHAR(100);

-- Refresh the schema cache - IMPORTANT
NOTIFY pgrst, 'reload schema';

-- Verify the table was created
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'user_settings' 
ORDER BY ordinal_position;
