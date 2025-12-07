-- =============================================
-- TIER CHATROOM SYSTEM MIGRATION
-- Add file_url column and ensure schema is complete
-- =============================================

-- Add file_url column to chatroom_messages if not exists
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'chatroom_messages' AND column_name = 'file_url'
    ) THEN
        ALTER TABLE chatroom_messages ADD COLUMN file_url TEXT;
    END IF;
END $$;

-- Ensure tier_chatrooms table exists with all required columns
CREATE TABLE IF NOT EXISTS tier_chatrooms (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tier VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    icon VARCHAR(50),
    color VARCHAR(50),
    min_win_rate DECIMAL(5,2) DEFAULT 0,
    max_win_rate DECIMAL(5,2) DEFAULT 100,
    min_trades INTEGER DEFAULT 0,
    member_count INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Ensure chatroom_members table exists
CREATE TABLE IF NOT EXISTS chatroom_members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    chatroom_id UUID NOT NULL REFERENCES tier_chatrooms(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    deriv_id VARCHAR(255) NOT NULL,
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_active TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    is_muted BOOLEAN DEFAULT false,
    role VARCHAR(50) DEFAULT 'member',
    
    UNIQUE(chatroom_id, user_id)
);

-- Ensure chatroom_messages table exists
CREATE TABLE IF NOT EXISTS chatroom_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    chatroom_id UUID NOT NULL REFERENCES tier_chatrooms(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    
    message_text TEXT,
    message_type VARCHAR(50) DEFAULT 'text',
    
    file_name VARCHAR(255),
    file_type VARCHAR(100),
    file_size INTEGER,
    file_hash VARCHAR(255),
    file_url TEXT,
    
    reply_to_id UUID REFERENCES chatroom_messages(id),
    reactions JSONB DEFAULT '{}',
    
    is_deleted BOOLEAN DEFAULT false,
    deleted_by UUID REFERENCES user_profiles(id),
    is_pinned BOOLEAN DEFAULT false,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_chatroom_members_chatroom ON chatroom_members(chatroom_id);
CREATE INDEX IF NOT EXISTS idx_chatroom_members_user ON chatroom_members(user_id);
CREATE INDEX IF NOT EXISTS idx_chatroom_members_deriv ON chatroom_members(deriv_id);
CREATE INDEX IF NOT EXISTS idx_chatroom_messages_room ON chatroom_messages(chatroom_id);
CREATE INDEX IF NOT EXISTS idx_chatroom_messages_sender ON chatroom_messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_chatroom_messages_created ON chatroom_messages(created_at DESC);

-- Insert default tier chatrooms if they don't exist
INSERT INTO tier_chatrooms (tier, name, description, icon, color, min_win_rate, max_win_rate, min_trades) VALUES
('beginner', 'Beginners Hub 🌱', 'Welcome! Learn the basics of trading together. Ask questions, share experiences, and grow!', '🌱', '#4CAF50', 0, 45, 0),
('intermediate', 'Intermediate Traders 📈', 'Level up your skills! Discuss strategies, analyze trades, and improve together.', '📈', '#2196F3', 45, 55, 50),
('advanced', 'Advanced Trading Room 🎯', 'For consistent traders. Share advanced strategies and market insights.', '🎯', '#9C27B0', 55, 65, 200),
('expert', 'Expert Lounge 👑', 'Elite traders only. High-level discussions and proven strategies.', '👑', '#FF9800', 65, 80, 500),
('master', 'Masters Circle 🏆', 'The pinnacle of trading excellence. For the most successful traders.', '🏆', '#F44336', 80, 100, 1000)
ON CONFLICT (tier) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    icon = EXCLUDED.icon,
    color = EXCLUDED.color,
    min_win_rate = EXCLUDED.min_win_rate,
    max_win_rate = EXCLUDED.max_win_rate,
    min_trades = EXCLUDED.min_trades;

-- Enable RLS
ALTER TABLE tier_chatrooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE chatroom_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE chatroom_messages ENABLE ROW LEVEL SECURITY;

-- Drop existing policies to avoid conflicts
DROP POLICY IF EXISTS "Tier chatrooms are public" ON tier_chatrooms;
DROP POLICY IF EXISTS "Members are viewable" ON chatroom_members;
DROP POLICY IF EXISTS "Users can manage membership" ON chatroom_members;
DROP POLICY IF EXISTS "Messages are viewable by members" ON chatroom_messages;
DROP POLICY IF EXISTS "Users can send messages" ON chatroom_messages;

-- Create policies for tier_chatrooms
CREATE POLICY "Tier chatrooms are public" ON tier_chatrooms
    FOR SELECT USING (is_active = true);

-- Create policies for chatroom_members
CREATE POLICY "Members are viewable" ON chatroom_members
    FOR SELECT USING (true);

CREATE POLICY "Users can manage membership" ON chatroom_members
    FOR ALL USING (true);

-- Create policies for chatroom_messages
CREATE POLICY "Messages are viewable by members" ON chatroom_messages
    FOR SELECT USING (is_deleted = false);

CREATE POLICY "Users can send messages" ON chatroom_messages
    FOR INSERT WITH CHECK (true);

CREATE POLICY "Users can update own messages" ON chatroom_messages
    FOR UPDATE USING (true);
