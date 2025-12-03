-- =============================================
-- COMMUNITY CHATROOMS - TIER-BASED GROUPS
-- Auto-assigns users to chatrooms based on performance tier
-- =============================================

-- =============================================
-- 1. TIER CHATROOMS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS tier_chatrooms (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tier VARCHAR(50) NOT NULL UNIQUE, -- beginner, intermediate, advanced, expert, master
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

-- =============================================
-- 2. CHATROOM MEMBERS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS chatroom_members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    chatroom_id UUID NOT NULL REFERENCES tier_chatrooms(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    deriv_id VARCHAR(255) NOT NULL,
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_active TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    is_muted BOOLEAN DEFAULT false,
    role VARCHAR(50) DEFAULT 'member', -- member, moderator, admin
    
    UNIQUE(chatroom_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_chatroom_members_chatroom ON chatroom_members(chatroom_id);
CREATE INDEX IF NOT EXISTS idx_chatroom_members_user ON chatroom_members(user_id);
CREATE INDEX IF NOT EXISTS idx_chatroom_members_deriv ON chatroom_members(deriv_id);

-- =============================================
-- 3. CHATROOM MESSAGES TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS chatroom_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    chatroom_id UUID NOT NULL REFERENCES tier_chatrooms(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    
    -- Message content
    message_text TEXT,
    message_type VARCHAR(50) DEFAULT 'text', -- text, image, video, file, system
    
    -- File metadata (files stored locally on user devices)
    file_name VARCHAR(255),
    file_type VARCHAR(100),
    file_size INTEGER,
    file_hash VARCHAR(255), -- For verifying file integrity
    
    -- Reply reference
    reply_to_id UUID REFERENCES chatroom_messages(id),
    
    -- Reactions
    reactions JSONB DEFAULT '{}',
    
    -- Moderation
    is_deleted BOOLEAN DEFAULT false,
    deleted_by UUID REFERENCES user_profiles(id),
    is_pinned BOOLEAN DEFAULT false,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chatroom_messages_room ON chatroom_messages(chatroom_id);
CREATE INDEX IF NOT EXISTS idx_chatroom_messages_sender ON chatroom_messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_chatroom_messages_created ON chatroom_messages(created_at DESC);

-- =============================================
-- 4. USER TYPING INDICATORS (EPHEMERAL)
-- =============================================
CREATE TABLE IF NOT EXISTS chatroom_typing (
    chatroom_id UUID NOT NULL REFERENCES tier_chatrooms(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (chatroom_id, user_id)
);

-- =============================================
-- SEED DATA: Default Tier Chatrooms
-- =============================================
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

-- =============================================
-- FUNCTION: Get User's Tier Based on Analytics
-- =============================================
CREATE OR REPLACE FUNCTION get_user_tier(p_win_rate DECIMAL, p_total_trades INTEGER)
RETURNS VARCHAR AS $$
BEGIN
    IF p_total_trades >= 1000 AND p_win_rate >= 80 THEN
        RETURN 'master';
    ELSIF p_total_trades >= 500 AND p_win_rate >= 65 THEN
        RETURN 'expert';
    ELSIF p_total_trades >= 200 AND p_win_rate >= 55 THEN
        RETURN 'advanced';
    ELSIF p_total_trades >= 50 AND p_win_rate >= 45 THEN
        RETURN 'intermediate';
    ELSE
        RETURN 'beginner';
    END IF;
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- FUNCTION: Auto-assign User to Tier Chatroom
-- =============================================
CREATE OR REPLACE FUNCTION assign_user_to_tier_chatroom(
    p_user_id UUID,
    p_deriv_id VARCHAR,
    p_win_rate DECIMAL DEFAULT 0,
    p_total_trades INTEGER DEFAULT 0
)
RETURNS UUID AS $$
DECLARE
    v_tier VARCHAR;
    v_chatroom_id UUID;
BEGIN
    -- Determine user's tier
    v_tier := get_user_tier(p_win_rate, p_total_trades);
    
    -- Get the chatroom for this tier
    SELECT id INTO v_chatroom_id FROM tier_chatrooms WHERE tier = v_tier;
    
    IF v_chatroom_id IS NULL THEN
        RAISE EXCEPTION 'Chatroom for tier % not found', v_tier;
    END IF;
    
    -- Remove from any other tier chatrooms first
    DELETE FROM chatroom_members 
    WHERE user_id = p_user_id 
    AND chatroom_id IN (SELECT id FROM tier_chatrooms);
    
    -- Add to the correct tier chatroom
    INSERT INTO chatroom_members (chatroom_id, user_id, deriv_id)
    VALUES (v_chatroom_id, p_user_id, p_deriv_id)
    ON CONFLICT (chatroom_id, user_id) DO UPDATE SET
        last_active = NOW();
    
    -- Update member count
    UPDATE tier_chatrooms SET 
        member_count = (SELECT COUNT(*) FROM chatroom_members WHERE chatroom_id = v_chatroom_id),
        updated_at = NOW()
    WHERE id = v_chatroom_id;
    
    RETURN v_chatroom_id;
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- FUNCTION: Get Users in Same Tier Chatroom
-- =============================================
CREATE OR REPLACE FUNCTION get_tier_chatroom_members(p_chatroom_id UUID, p_limit INTEGER DEFAULT 50)
RETURNS TABLE (
    user_id UUID,
    deriv_id VARCHAR,
    username VARCHAR,
    fullname VARCHAR,
    profile_photo TEXT,
    is_online BOOLEAN,
    last_active TIMESTAMP WITH TIME ZONE,
    win_rate DECIMAL,
    total_trades INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        up.id as user_id,
        up.deriv_id,
        up.username,
        up.fullname,
        up.profile_photo,
        up.is_online,
        cm.last_active,
        up.win_rate,
        up.total_trades
    FROM chatroom_members cm
    JOIN user_profiles up ON cm.user_id = up.id
    WHERE cm.chatroom_id = p_chatroom_id
    ORDER BY up.is_online DESC, cm.last_active DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- ROW LEVEL SECURITY
-- =============================================
ALTER TABLE tier_chatrooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE chatroom_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE chatroom_messages ENABLE ROW LEVEL SECURITY;

-- Everyone can read tier chatrooms
CREATE POLICY "Tier chatrooms are public" ON tier_chatrooms
    FOR SELECT USING (true);

-- Members can see other members
CREATE POLICY "Members can view chatroom members" ON chatroom_members
    FOR SELECT USING (true);

-- Messages visible to all (tier-based access controlled in app)
CREATE POLICY "Messages readable by members" ON chatroom_messages
    FOR SELECT USING (true);

-- =============================================
-- TRIGGERS
-- =============================================
CREATE TRIGGER update_tier_chatrooms_updated_at
    BEFORE UPDATE ON tier_chatrooms
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
