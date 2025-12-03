-- Fix user_settings table schema
-- This ensures all required columns exist

-- Add chat column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'user_settings' AND column_name = 'chat'
    ) THEN
        ALTER TABLE user_settings 
        ADD COLUMN chat JSONB DEFAULT '{
            "enterToSend": true,
            "showTypingIndicator": true,
            "showReadReceipts": true,
            "autoDeleteMessages": false,
            "messageRetention": 30
        }'::jsonb;
    END IF;
END $$;

-- Ensure privacy column exists with default
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'user_settings' AND column_name = 'privacy'
    ) THEN
        ALTER TABLE user_settings 
        ADD COLUMN privacy JSONB DEFAULT '{
            "showUsername": true,
            "showRealName": false,
            "showEmail": false,
            "showCountry": true,
            "showPerformance": true,
            "showOnlineStatus": true,
            "profileVisibility": "public",
            "allowFriendRequests": true,
            "allowMessages": "friends"
        }'::jsonb;
    END IF;
END $$;

-- Ensure notifications column exists with default
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'user_settings' AND column_name = 'notifications'
    ) THEN
        ALTER TABLE user_settings 
        ADD COLUMN notifications JSONB DEFAULT '{
            "friendRequests": true,
            "messages": true,
            "chatMentions": true,
            "achievements": true,
            "streakReminders": true,
            "communityUpdates": true,
            "soundEnabled": true,
            "pushEnabled": false
        }'::jsonb;
    END IF;
END $$;

-- Add is_first_login column to user_profiles if not exists
ALTER TABLE user_profiles 
ADD COLUMN IF NOT EXISTS is_first_login BOOLEAN DEFAULT true;

-- Add is_profile_complete column to track if user has set up their profile
ALTER TABLE user_profiles 
ADD COLUMN IF NOT EXISTS is_profile_complete BOOLEAN DEFAULT false;

-- Refresh the schema cache
NOTIFY pgrst, 'reload schema';
