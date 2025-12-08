-- FIX SCHEMA ISSUES
-- 1. Add missing expires_at column to friend_chats
-- 2. Consolidate chat schema if needed

-- Add expires_at column to friend_chats if it doesn't exist
DO $$ 
BEGIN
    -- Check if table exists
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'friend_chats') THEN
        -- Check if column exists
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'friend_chats' AND column_name = 'expires_at'
        ) THEN
            ALTER TABLE friend_chats ADD COLUMN expires_at TIMESTAMP WITH TIME ZONE;
            RAISE NOTICE 'Added expires_at column to friend_chats';
        END IF;
    ELSE
        -- If table doesn't exist at all, create it (Best Effort based on usage)
        CREATE TABLE friend_chats (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user1_id UUID REFERENCES user_profiles(id),
            user2_id UUID REFERENCES user_profiles(id),
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            expires_at TIMESTAMP WITH TIME ZONE,
            UNIQUE(user1_id, user2_id)
        );
        RAISE NOTICE 'Created friend_chats table';
    END IF;
END $$;

-- Enable RLS on friend_chats if created
ALTER TABLE friend_chats ENABLE ROW LEVEL SECURITY;

-- Drop redundant policies if they exist (cleanup)
DROP POLICY IF EXISTS "friend_chats_user" ON friend_chats;

-- Create policy allowing users to see their own chats
CREATE POLICY "friend_chats_user" ON friend_chats
    FOR ALL
    TO authenticated
    USING (user1_id = auth.uid() OR user2_id = auth.uid());
