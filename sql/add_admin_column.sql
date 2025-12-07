-- Add is_admin column to user_profiles if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'user_profiles' AND column_name = 'is_admin'
    ) THEN
        ALTER TABLE user_profiles ADD COLUMN is_admin BOOLEAN DEFAULT FALSE;
        CREATE INDEX IF NOT EXISTS idx_user_profiles_is_admin ON user_profiles(is_admin) WHERE is_admin = TRUE;
    END IF;
END $$;

-- Now you can set yourself as admin
-- UPDATE user_profiles SET is_admin = true WHERE deriv_id = 'CR6550175';
