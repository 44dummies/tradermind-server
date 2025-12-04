-- =============================================
-- COMMUNITY SYSTEM SQL SCHEMA
-- For Supabase Postgres
-- =============================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================
-- COMMUNITY POSTS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS community_posts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  
  -- Content
  content TEXT NOT NULL CHECK (char_length(content) >= 1 AND char_length(content) <= 5000),
  post_type VARCHAR(20) DEFAULT 'general' CHECK (post_type IN ('strategy', 'result', 'general', 'question', 'news')),
  
  -- Media
  image_url TEXT,
  image_metadata JSONB DEFAULT '{}',
  
  -- Engagement
  like_count INTEGER DEFAULT 0 CHECK (like_count >= 0),
  comment_count INTEGER DEFAULT 0 CHECK (comment_count >= 0),
  view_count INTEGER DEFAULT 0 CHECK (view_count >= 0),
  
  -- Flags
  is_pinned BOOLEAN DEFAULT FALSE,
  is_deleted BOOLEAN DEFAULT FALSE,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for community_posts
CREATE INDEX IF NOT EXISTS idx_posts_user_id ON community_posts(user_id);
CREATE INDEX IF NOT EXISTS idx_posts_created_at ON community_posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_post_type ON community_posts(post_type);
CREATE INDEX IF NOT EXISTS idx_posts_not_deleted ON community_posts(is_deleted) WHERE is_deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_posts_pinned ON community_posts(is_pinned) WHERE is_pinned = TRUE;

-- =============================================
-- COMMUNITY COMMENTS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS community_comments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  post_id UUID NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES community_comments(id) ON DELETE CASCADE,
  
  -- Content
  content TEXT NOT NULL CHECK (char_length(content) >= 1 AND char_length(content) <= 2000),
  
  -- Engagement
  like_count INTEGER DEFAULT 0 CHECK (like_count >= 0),
  
  -- Flags
  is_deleted BOOLEAN DEFAULT FALSE,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for community_comments
CREATE INDEX IF NOT EXISTS idx_comments_post_id ON community_comments(post_id);
CREATE INDEX IF NOT EXISTS idx_comments_user_id ON community_comments(user_id);
CREATE INDEX IF NOT EXISTS idx_comments_parent_id ON community_comments(parent_id);
CREATE INDEX IF NOT EXISTS idx_comments_created_at ON community_comments(created_at DESC);

-- =============================================
-- POST LIKES TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS community_post_likes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  post_id UUID NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(post_id, user_id)
);

-- Indexes for post likes
CREATE INDEX IF NOT EXISTS idx_post_likes_post_id ON community_post_likes(post_id);
CREATE INDEX IF NOT EXISTS idx_post_likes_user_id ON community_post_likes(user_id);

-- =============================================
-- COMMENT LIKES TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS community_comment_likes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  comment_id UUID NOT NULL REFERENCES community_comments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(comment_id, user_id)
);

-- =============================================
-- COMMUNITY ROOMS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS community_rooms (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) NOT NULL,
  description TEXT,
  room_type VARCHAR(20) DEFAULT 'public' CHECK (room_type IN ('public', 'private', 'tier')),
  tier_required VARCHAR(20),
  
  -- Settings
  max_members INTEGER DEFAULT 1000,
  is_active BOOLEAN DEFAULT TRUE,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- ROOM MESSAGES TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS community_room_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id UUID NOT NULL REFERENCES community_rooms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  
  content TEXT NOT NULL CHECK (char_length(content) >= 1 AND char_length(content) <= 2000),
  message_type VARCHAR(20) DEFAULT 'text' CHECK (message_type IN ('text', 'image', 'system')),
  
  -- Flags
  is_deleted BOOLEAN DEFAULT FALSE,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for room messages
CREATE INDEX IF NOT EXISTS idx_room_messages_room_id ON community_room_messages(room_id);
CREATE INDEX IF NOT EXISTS idx_room_messages_created_at ON community_room_messages(created_at DESC);

-- =============================================
-- ROOM MEMBERS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS community_room_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id UUID NOT NULL REFERENCES community_rooms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  last_read_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(room_id, user_id)
);

-- =============================================
-- USER ONLINE STATUS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS community_online_users (
  user_id UUID PRIMARY KEY REFERENCES user_profiles(id) ON DELETE CASCADE,
  last_seen TIMESTAMPTZ DEFAULT NOW(),
  status VARCHAR(20) DEFAULT 'online' CHECK (status IN ('online', 'away', 'busy', 'offline'))
);

-- =============================================
-- RATE LIMITING TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS community_rate_limits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  action_type VARCHAR(50) NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  action_count INTEGER DEFAULT 1,
  
  UNIQUE(user_id, action_type, window_start)
);

-- Index for rate limiting
CREATE INDEX IF NOT EXISTS idx_rate_limits_lookup ON community_rate_limits(user_id, action_type, window_start);

-- =============================================
-- FUNCTIONS
-- =============================================

-- Function to update post comment count
CREATE OR REPLACE FUNCTION update_post_comment_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE community_posts SET comment_count = comment_count + 1 WHERE id = NEW.post_id;
  ELSIF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND NEW.is_deleted = TRUE AND OLD.is_deleted = FALSE) THEN
    UPDATE community_posts SET comment_count = GREATEST(0, comment_count - 1) WHERE id = COALESCE(NEW.post_id, OLD.post_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Function to update post like count
CREATE OR REPLACE FUNCTION update_post_like_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE community_posts SET like_count = like_count + 1 WHERE id = NEW.post_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE community_posts SET like_count = GREATEST(0, like_count - 1) WHERE id = OLD.post_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Function to check rate limit
CREATE OR REPLACE FUNCTION check_rate_limit(
  p_user_id UUID,
  p_action_type VARCHAR(50),
  p_max_actions INTEGER,
  p_window_minutes INTEGER
)
RETURNS BOOLEAN AS $$
DECLARE
  v_window_start TIMESTAMPTZ;
  v_current_count INTEGER;
BEGIN
  v_window_start := date_trunc('minute', NOW()) - (EXTRACT(MINUTE FROM NOW())::INTEGER % p_window_minutes) * INTERVAL '1 minute';
  
  SELECT action_count INTO v_current_count
  FROM community_rate_limits
  WHERE user_id = p_user_id 
    AND action_type = p_action_type 
    AND window_start = v_window_start;
  
  IF v_current_count IS NULL THEN
    INSERT INTO community_rate_limits (user_id, action_type, window_start, action_count)
    VALUES (p_user_id, p_action_type, v_window_start, 1)
    ON CONFLICT (user_id, action_type, window_start) 
    DO UPDATE SET action_count = community_rate_limits.action_count + 1;
    RETURN TRUE;
  ELSIF v_current_count < p_max_actions THEN
    UPDATE community_rate_limits 
    SET action_count = action_count + 1
    WHERE user_id = p_user_id 
      AND action_type = p_action_type 
      AND window_start = v_window_start;
    RETURN TRUE;
  ELSE
    RETURN FALSE;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- TRIGGERS
-- =============================================

-- Trigger for comment count
DROP TRIGGER IF EXISTS trigger_update_comment_count ON community_comments;
CREATE TRIGGER trigger_update_comment_count
AFTER INSERT OR UPDATE OR DELETE ON community_comments
FOR EACH ROW EXECUTE FUNCTION update_post_comment_count();

-- Trigger for like count
DROP TRIGGER IF EXISTS trigger_update_like_count ON community_post_likes;
CREATE TRIGGER trigger_update_like_count
AFTER INSERT OR DELETE ON community_post_likes
FOR EACH ROW EXECUTE FUNCTION update_post_like_count();

-- =============================================
-- ROW LEVEL SECURITY (RLS)
-- =============================================

-- Enable RLS on all tables
ALTER TABLE community_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_post_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_room_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_room_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_online_users ENABLE ROW LEVEL SECURITY;

-- =============================================
-- RLS POLICIES - community_posts
-- =============================================

-- Anyone can read non-deleted posts
CREATE POLICY "Posts are viewable by everyone"
ON community_posts FOR SELECT
USING (is_deleted = FALSE);

-- Users can insert their own posts
CREATE POLICY "Users can create posts"
ON community_posts FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Users can update their own posts
CREATE POLICY "Users can update own posts"
ON community_posts FOR UPDATE
USING (auth.uid() = user_id);

-- Users can soft-delete their own posts
CREATE POLICY "Users can delete own posts"
ON community_posts FOR DELETE
USING (auth.uid() = user_id);

-- =============================================
-- RLS POLICIES - community_comments
-- =============================================

-- Anyone can read non-deleted comments
CREATE POLICY "Comments are viewable by everyone"
ON community_comments FOR SELECT
USING (is_deleted = FALSE);

-- Users can insert their own comments
CREATE POLICY "Users can create comments"
ON community_comments FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Users can update their own comments
CREATE POLICY "Users can update own comments"
ON community_comments FOR UPDATE
USING (auth.uid() = user_id);

-- Users can delete their own comments
CREATE POLICY "Users can delete own comments"
ON community_comments FOR DELETE
USING (auth.uid() = user_id);

-- =============================================
-- RLS POLICIES - community_post_likes
-- =============================================

-- Anyone can see likes
CREATE POLICY "Likes are viewable by everyone"
ON community_post_likes FOR SELECT
USING (TRUE);

-- Users can like posts
CREATE POLICY "Users can like posts"
ON community_post_likes FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Users can unlike posts
CREATE POLICY "Users can unlike posts"
ON community_post_likes FOR DELETE
USING (auth.uid() = user_id);

-- =============================================
-- RLS POLICIES - community_rooms
-- =============================================

-- Public rooms are viewable by everyone
CREATE POLICY "Public rooms are viewable"
ON community_rooms FOR SELECT
USING (room_type = 'public' OR is_active = TRUE);

-- =============================================
-- RLS POLICIES - community_room_messages
-- =============================================

-- Room members can view messages
CREATE POLICY "Room members can view messages"
ON community_room_messages FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM community_room_members 
    WHERE room_id = community_room_messages.room_id 
    AND user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM community_rooms 
    WHERE id = community_room_messages.room_id 
    AND room_type = 'public'
  )
);

-- Users can send messages
CREATE POLICY "Users can send messages"
ON community_room_messages FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- =============================================
-- RLS POLICIES - community_online_users
-- =============================================

-- Anyone can see online users
CREATE POLICY "Online users are viewable"
ON community_online_users FOR SELECT
USING (TRUE);

-- Users can update their own status
CREATE POLICY "Users can update own status"
ON community_online_users FOR ALL
USING (auth.uid() = user_id);

-- =============================================
-- SERVICE ROLE BYPASS
-- For server-side operations
-- =============================================

-- These policies allow the service role to bypass RLS
-- The service role key is used on the backend

-- =============================================
-- DEFAULT ROOMS
-- =============================================

INSERT INTO community_rooms (id, name, description, room_type) VALUES
  ('00000000-0000-0000-0000-000000000001', 'General', 'General trading discussion', 'public'),
  ('00000000-0000-0000-0000-000000000002', 'Strategies', 'Share and discuss trading strategies', 'public'),
  ('00000000-0000-0000-0000-000000000003', 'Results', 'Share your trading results', 'public'),
  ('00000000-0000-0000-0000-000000000004', 'Beginners', 'Help for new traders', 'public'),
  ('00000000-0000-0000-0000-000000000005', 'Pro Traders', 'For experienced traders', 'tier')
ON CONFLICT (id) DO NOTHING;

-- =============================================
-- STORAGE BUCKETS (run in Supabase dashboard)
-- =============================================

-- Create storage buckets via Supabase dashboard or API:
-- 1. avatars - for profile pictures
-- 2. post-images - for community post images

-- Storage policies (set via Supabase dashboard):
-- avatars bucket:
--   - SELECT: public (anyone can view)
--   - INSERT: authenticated users only, max 2MB, jpg/png/webp
--   - UPDATE: owner only
--   - DELETE: owner only

-- post-images bucket:
--   - SELECT: public (anyone can view)
--   - INSERT: authenticated users only, max 2MB, jpg/png/webp
--   - UPDATE: owner only  
--   - DELETE: owner only
