-- =============================================
-- FRIENDS CENTER SYSTEM - DATABASE SCHEMA
-- Complete migration for Supabase PostgreSQL
-- =============================================

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================
-- 1. USER PROFILES TABLE (Extended)
-- =============================================
CREATE TABLE IF NOT EXISTS user_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    deriv_id VARCHAR(255) UNIQUE NOT NULL,
    username VARCHAR(50) UNIQUE NOT NULL,
    fullname VARCHAR(255),
    email VARCHAR(255),
    country VARCHAR(100),
    profile_photo TEXT,
    status_message VARCHAR(500) DEFAULT 'Trading the markets 📈',
    performance_tier VARCHAR(50) DEFAULT 'beginner', -- beginner, intermediate, advanced, expert, master
    bio TEXT,
    
    -- Privacy settings
    privacy_mode VARCHAR(20) DEFAULT 'public', -- public, friends_only, private
    show_country BOOLEAN DEFAULT true,
    show_performance BOOLEAN DEFAULT true,
    show_portfolio BOOLEAN DEFAULT true,
    allow_friend_requests BOOLEAN DEFAULT true,
    
    -- Stats
    total_trades INTEGER DEFAULT 0,
    win_rate DECIMAL(5,2) DEFAULT 0.00,
    discipline_score INTEGER DEFAULT 50,
    helpfulness_score INTEGER DEFAULT 0,
    
    -- Status
    is_online BOOLEAN DEFAULT false,
    last_seen TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for username search
CREATE INDEX IF NOT EXISTS idx_user_profiles_username ON user_profiles(username);
CREATE INDEX IF NOT EXISTS idx_user_profiles_username_lower ON user_profiles(LOWER(username));
CREATE INDEX IF NOT EXISTS idx_user_profiles_deriv_id ON user_profiles(deriv_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_country ON user_profiles(country);
CREATE INDEX IF NOT EXISTS idx_user_profiles_performance_tier ON user_profiles(performance_tier);

-- =============================================
-- 2. FRIENDSHIPS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS friendships (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    friend_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    status VARCHAR(20) DEFAULT 'pending', -- pending, accepted, blocked, declined
    
    -- Friendship metadata
    nickname VARCHAR(100), -- Custom nickname for friend
    is_favorite BOOLEAN DEFAULT false,
    is_muted BOOLEAN DEFAULT false,
    is_mentor BOOLEAN DEFAULT false, -- Mentorship mode
    
    -- Anniversary & streaks
    friendship_started_at TIMESTAMP WITH TIME ZONE,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Ensure unique friendship pairs
    UNIQUE(user_id, friend_id)
);

CREATE INDEX IF NOT EXISTS idx_friendships_user_id ON friendships(user_id);
CREATE INDEX IF NOT EXISTS idx_friendships_friend_id ON friendships(friend_id);
CREATE INDEX IF NOT EXISTS idx_friendships_status ON friendships(status);

-- =============================================
-- 3. FRIEND CHATS TABLE (1-on-1 chats)
-- =============================================
CREATE TABLE IF NOT EXISTS friend_chats (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user1_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    user2_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    
    -- Last message preview
    last_message TEXT,
    last_message_at TIMESTAMP WITH TIME ZONE,
    last_message_by UUID REFERENCES user_profiles(id),
    
    -- Streak system
    streak_count INTEGER DEFAULT 0,
    streak_last_date DATE,
    streak_name VARCHAR(100), -- Custom streak name
    streak_badge VARCHAR(50), -- starter, bronze, silver, gold, diamond, aurora
    
    -- Settings
    is_archived_user1 BOOLEAN DEFAULT false,
    is_archived_user2 BOOLEAN DEFAULT false,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Ensure unique chat pair
    UNIQUE(user1_id, user2_id)
);

CREATE INDEX IF NOT EXISTS idx_friend_chats_user1 ON friend_chats(user1_id);
CREATE INDEX IF NOT EXISTS idx_friend_chats_user2 ON friend_chats(user2_id);

-- =============================================
-- 4. FRIEND MESSAGES TABLE (Temporary storage)
-- =============================================
CREATE TABLE IF NOT EXISTS friend_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    chat_id UUID NOT NULL REFERENCES friend_chats(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    
    -- Message content
    message_text TEXT,
    message_type VARCHAR(50) DEFAULT 'text', -- text, image_metadata, video_metadata, voice_metadata, ping, system
    
    -- Media metadata (actual files stored locally on device)
    media_filename VARCHAR(255),
    media_type VARCHAR(50),
    media_size INTEGER,
    media_duration INTEGER, -- For voice/video in seconds
    
    -- Message status
    is_read BOOLEAN DEFAULT false,
    read_at TIMESTAMP WITH TIME ZONE,
    is_deleted BOOLEAN DEFAULT false,
    
    -- Reactions
    reactions JSONB DEFAULT '{}', -- {"👍": ["user_id1"], "❤️": ["user_id2"]}
    
    -- Reply reference
    reply_to_id UUID REFERENCES friend_messages(id),
    
    -- Auto-delete
    expires_at TIMESTAMP WITH TIME ZONE, -- Auto-delete timestamp
    stored_locally BOOLEAN DEFAULT true,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_friend_messages_chat_id ON friend_messages(chat_id);
CREATE INDEX IF NOT EXISTS idx_friend_messages_sender_id ON friend_messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_friend_messages_created_at ON friend_messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_friend_messages_expires_at ON friend_messages(expires_at);

-- =============================================
-- 5. PORTFOLIO TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS portfolio_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    
    -- Media metadata (actual file stored locally)
    media_type VARCHAR(50) NOT NULL, -- image, video, screenshot, post
    title VARCHAR(255),
    description TEXT,
    
    -- Local storage reference
    local_filename VARCHAR(255),
    thumbnail_data TEXT, -- Base64 thumbnail for preview
    
    -- Metadata
    tags JSONB DEFAULT '[]',
    
    -- Privacy
    privacy_level VARCHAR(20) DEFAULT 'public', -- public, friends_only, locked
    
    -- Engagement
    likes_count INTEGER DEFAULT 0,
    views_count INTEGER DEFAULT 0,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_portfolio_items_user_id ON portfolio_items(user_id);
CREATE INDEX IF NOT EXISTS idx_portfolio_items_privacy ON portfolio_items(privacy_level);

-- =============================================
-- 6. SHARED NOTES TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS shared_notes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    chat_id UUID REFERENCES friend_chats(id) ON DELETE CASCADE,
    
    -- Content
    title VARCHAR(255) DEFAULT 'Shared Notes',
    content TEXT DEFAULT '',
    content_type VARCHAR(20) DEFAULT 'markdown', -- markdown, plain
    
    -- Collaboration
    last_edited_by UUID REFERENCES user_profiles(id),
    version INTEGER DEFAULT 1,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shared_notes_chat_id ON shared_notes(chat_id);

-- =============================================
-- 7. SHARED WATCHLIST TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS shared_watchlists (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    chat_id UUID REFERENCES friend_chats(id) ON DELETE CASCADE,
    
    -- Watchlist content
    name VARCHAR(255) DEFAULT 'Our Watchlist',
    symbols JSONB DEFAULT '[]', -- [{"symbol": "EURUSD", "notes": "...", "addedBy": "..."}]
    strategies JSONB DEFAULT '[]',
    timeframes JSONB DEFAULT '[]',
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shared_watchlists_chat_id ON shared_watchlists(chat_id);

-- =============================================
-- 8. NOTIFICATIONS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    
    -- Notification content
    type VARCHAR(50) NOT NULL, -- friend_request, request_accepted, streak_milestone, portfolio_update, notes_edit, achievement, badge, anniversary, trading_started, mentor_feedback
    title VARCHAR(255),
    message TEXT,
    payload JSONB DEFAULT '{}',
    
    -- Related entities
    related_user_id UUID REFERENCES user_profiles(id),
    related_chat_id UUID REFERENCES friend_chats(id),
    
    -- Status
    is_read BOOLEAN DEFAULT false,
    read_at TIMESTAMP WITH TIME ZONE,
    
    -- Action URL
    action_url VARCHAR(500),
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);

-- =============================================
-- 9. ACHIEVEMENTS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS achievements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    
    achievement_type VARCHAR(100) NOT NULL,
    achievement_name VARCHAR(255) NOT NULL,
    achievement_icon VARCHAR(50),
    description TEXT,
    
    unlocked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(user_id, achievement_type)
);

CREATE INDEX IF NOT EXISTS idx_achievements_user_id ON achievements(user_id);

-- =============================================
-- 10. MENTOR FEEDBACK TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS mentor_feedback (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    mentor_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    mentee_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    chat_id UUID REFERENCES friend_chats(id) ON DELETE CASCADE,
    
    -- Feedback content
    week_number INTEGER NOT NULL,
    feedback_text TEXT,
    rating INTEGER CHECK (rating >= 1 AND rating <= 5),
    areas_of_improvement JSONB DEFAULT '[]',
    goals_for_next_week JSONB DEFAULT '[]',
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mentor_feedback_mentor ON mentor_feedback(mentor_id);
CREATE INDEX IF NOT EXISTS idx_mentor_feedback_mentee ON mentor_feedback(mentee_id);

-- =============================================
-- 11. TYPING INDICATORS TABLE (Ephemeral)
-- =============================================
CREATE TABLE IF NOT EXISTS typing_indicators (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    chat_id UUID NOT NULL REFERENCES friend_chats(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(chat_id, user_id)
);

-- =============================================
-- 12. ONLINE STATUS TABLE (For real-time presence)
-- =============================================
CREATE TABLE IF NOT EXISTS user_presence (
    user_id UUID PRIMARY KEY REFERENCES user_profiles(id) ON DELETE CASCADE,
    is_online BOOLEAN DEFAULT false,
    last_seen TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    socket_id VARCHAR(255),
    device_type VARCHAR(50)
);

-- =============================================
-- HELPER FUNCTIONS
-- =============================================

-- Function to get or create a chat between two users
CREATE OR REPLACE FUNCTION get_or_create_friend_chat(p_user1_id UUID, p_user2_id UUID)
RETURNS UUID AS $$
DECLARE
    v_chat_id UUID;
    v_smaller_id UUID;
    v_larger_id UUID;
BEGIN
    -- Always store with smaller ID first for consistency
    IF p_user1_id < p_user2_id THEN
        v_smaller_id := p_user1_id;
        v_larger_id := p_user2_id;
    ELSE
        v_smaller_id := p_user2_id;
        v_larger_id := p_user1_id;
    END IF;
    
    -- Try to find existing chat
    SELECT id INTO v_chat_id
    FROM friend_chats
    WHERE (user1_id = v_smaller_id AND user2_id = v_larger_id);
    
    -- Create if not exists
    IF v_chat_id IS NULL THEN
        INSERT INTO friend_chats (user1_id, user2_id)
        VALUES (v_smaller_id, v_larger_id)
        RETURNING id INTO v_chat_id;
    END IF;
    
    RETURN v_chat_id;
END;
$$ LANGUAGE plpgsql;

-- Function to calculate streak badge
CREATE OR REPLACE FUNCTION get_streak_badge(streak_days INTEGER)
RETURNS VARCHAR AS $$
BEGIN
    IF streak_days >= 180 THEN
        RETURN 'aurora';
    ELSIF streak_days >= 90 THEN
        RETURN 'diamond';
    ELSIF streak_days >= 30 THEN
        RETURN 'gold';
    ELSIF streak_days >= 14 THEN
        RETURN 'silver';
    ELSIF streak_days >= 7 THEN
        RETURN 'bronze';
    ELSIF streak_days >= 3 THEN
        RETURN 'starter';
    ELSE
        RETURN NULL;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Function to update streak
CREATE OR REPLACE FUNCTION update_chat_streak(p_chat_id UUID)
RETURNS VOID AS $$
DECLARE
    v_last_date DATE;
    v_today DATE := CURRENT_DATE;
    v_streak INTEGER;
BEGIN
    SELECT streak_last_date, streak_count INTO v_last_date, v_streak
    FROM friend_chats WHERE id = p_chat_id;
    
    IF v_last_date IS NULL OR v_last_date < v_today - INTERVAL '1 day' THEN
        -- Reset streak if more than 1 day gap
        v_streak := 1;
    ELSIF v_last_date = v_today - INTERVAL '1 day' THEN
        -- Continue streak
        v_streak := v_streak + 1;
    ELSIF v_last_date = v_today THEN
        -- Already counted today
        RETURN;
    END IF;
    
    UPDATE friend_chats
    SET 
        streak_count = v_streak,
        streak_last_date = v_today,
        streak_badge = get_streak_badge(v_streak),
        updated_at = NOW()
    WHERE id = p_chat_id;
END;
$$ LANGUAGE plpgsql;

-- Function for fuzzy username search
CREATE OR REPLACE FUNCTION search_users_by_username(search_term VARCHAR, current_user_id UUID, result_limit INTEGER DEFAULT 20)
RETURNS TABLE (
    id UUID,
    username VARCHAR,
    fullname VARCHAR,
    country VARCHAR,
    profile_photo TEXT,
    status_message VARCHAR,
    performance_tier VARCHAR,
    is_online BOOLEAN,
    friendship_status VARCHAR
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        up.id,
        up.username,
        up.fullname,
        up.country,
        up.profile_photo,
        up.status_message,
        up.performance_tier,
        up.is_online,
        COALESCE(f.status, 'none')::VARCHAR as friendship_status
    FROM user_profiles up
    LEFT JOIN friendships f ON (
        (f.user_id = current_user_id AND f.friend_id = up.id) OR
        (f.friend_id = current_user_id AND f.user_id = up.id)
    )
    WHERE 
        up.id != current_user_id
        AND up.privacy_mode != 'private'
        AND up.allow_friend_requests = true
        AND (
            LOWER(up.username) LIKE LOWER('%' || search_term || '%')
            OR LOWER(up.fullname) LIKE LOWER('%' || search_term || '%')
        )
    ORDER BY 
        CASE 
            WHEN LOWER(up.username) = LOWER(search_term) THEN 0
            WHEN LOWER(up.username) LIKE LOWER(search_term || '%') THEN 1
            ELSE 2
        END,
        up.username
    LIMIT result_limit;
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- ROW LEVEL SECURITY POLICIES
-- =============================================

-- Enable RLS on all tables
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE friendships ENABLE ROW LEVEL SECURITY;
ALTER TABLE friend_chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE friend_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE portfolio_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared_watchlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE mentor_feedback ENABLE ROW LEVEL SECURITY;

-- Create policies for authenticated users (service role bypasses these)
-- User profiles - public read for non-private users
CREATE POLICY "Public profiles readable" ON user_profiles
    FOR SELECT USING (privacy_mode != 'private');

CREATE POLICY "Users can update own profile" ON user_profiles
    FOR UPDATE USING (true);

-- Messages readable by chat participants
CREATE POLICY "Chat messages readable by participants" ON friend_messages
    FOR SELECT USING (true);

-- Notifications only for owner
CREATE POLICY "Users see own notifications" ON notifications
    FOR SELECT USING (true);

-- =============================================
-- TRIGGERS FOR UPDATED_AT
-- =============================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_user_profiles_updated_at
    BEFORE UPDATE ON user_profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_friendships_updated_at
    BEFORE UPDATE ON friendships
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_friend_chats_updated_at
    BEFORE UPDATE ON friend_chats
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_portfolio_items_updated_at
    BEFORE UPDATE ON portfolio_items
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_shared_notes_updated_at
    BEFORE UPDATE ON shared_notes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_shared_watchlists_updated_at
    BEFORE UPDATE ON shared_watchlists
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================
-- CRON JOB HELPER: Auto-delete expired messages
-- (Run this via pg_cron or external cron)
-- =============================================

CREATE OR REPLACE FUNCTION cleanup_expired_messages()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM friend_messages
    WHERE expires_at IS NOT NULL AND expires_at < NOW();
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- SEED DATA: Achievement Types
-- =============================================

CREATE TABLE IF NOT EXISTS achievement_definitions (
    type VARCHAR(100) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    icon VARCHAR(50),
    category VARCHAR(50)
);

INSERT INTO achievement_definitions (type, name, description, icon, category) VALUES
('first_friend', 'First Friend', 'Made your first friend on TraderMind', '🤝', 'social'),
('social_butterfly', 'Social Butterfly', 'Have 10+ friends', '🦋', 'social'),
('streak_starter', 'Streak Starter', 'Maintained a 3-day streak', '🔥', 'streaks'),
('streak_bronze', 'Bronze Streak', 'Maintained a 7-day streak', '🥉', 'streaks'),
('streak_silver', 'Silver Streak', 'Maintained a 14-day streak', '🥈', 'streaks'),
('streak_gold', 'Gold Streak', 'Maintained a 30-day streak', '🥇', 'streaks'),
('streak_diamond', 'Diamond Streak', 'Maintained a 90-day streak', '💎', 'streaks'),
('streak_aurora', 'Aurora Streak', 'Maintained a 180-day streak', '🌌', 'streaks'),
('helpful_trader', 'Helpful Trader', 'Received 50+ reactions on messages', '❤️', 'social'),
('mentor', 'Mentor', 'Became a mentor to a friend', '🎓', 'mentorship'),
('portfolio_star', 'Portfolio Star', 'Received 100+ likes on portfolio', '⭐', 'portfolio'),
('one_month_friends', '1 Month Anniversary', 'Friends for 1 month', '📅', 'anniversary'),
('one_year_friends', '1 Year Anniversary', 'Friends for 1 year', '🎂', 'anniversary')
ON CONFLICT (type) DO NOTHING;
