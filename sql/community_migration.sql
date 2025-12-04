-- =============================================
-- COMMUNITY SYSTEM MIGRATION
-- Run this if tables already exist
-- =============================================

-- Add missing columns to community_posts
ALTER TABLE community_posts 
ADD COLUMN IF NOT EXISTS post_type VARCHAR(20) DEFAULT 'general';

ALTER TABLE community_posts 
ADD COLUMN IF NOT EXISTS image_url TEXT;

ALTER TABLE community_posts 
ADD COLUMN IF NOT EXISTS image_metadata JSONB DEFAULT '{}';

ALTER TABLE community_posts 
ADD COLUMN IF NOT EXISTS view_count INTEGER DEFAULT 0;

ALTER TABLE community_posts 
ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN DEFAULT FALSE;

ALTER TABLE community_posts 
ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE;

-- Add constraint for post_type if not exists
DO $$ 
BEGIN
  ALTER TABLE community_posts 
  ADD CONSTRAINT check_post_type 
  CHECK (post_type IN ('strategy', 'result', 'general', 'question', 'news'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Create indexes if not exist
CREATE INDEX IF NOT EXISTS idx_posts_post_type ON community_posts(post_type);
CREATE INDEX IF NOT EXISTS idx_posts_not_deleted ON community_posts(is_deleted) WHERE is_deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_posts_pinned ON community_posts(is_pinned) WHERE is_pinned = TRUE;

-- =============================================
-- COMMUNITY COMMENTS TABLE (if not exists)
-- =============================================
CREATE TABLE IF NOT EXISTS community_comments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  post_id UUID NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES community_comments(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  like_count INTEGER DEFAULT 0,
  is_deleted BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comments_post_id ON community_comments(post_id);
CREATE INDEX IF NOT EXISTS idx_comments_user_id ON community_comments(user_id);
CREATE INDEX IF NOT EXISTS idx_comments_parent_id ON community_comments(parent_id);

-- =============================================
-- POST LIKES TABLE (if not exists)
-- =============================================
CREATE TABLE IF NOT EXISTS community_post_likes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  post_id UUID NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(post_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_post_likes_post_id ON community_post_likes(post_id);
CREATE INDEX IF NOT EXISTS idx_post_likes_user_id ON community_post_likes(user_id);

-- =============================================
-- COMMUNITY ROOMS TABLE (if not exists)
-- =============================================
CREATE TABLE IF NOT EXISTS community_rooms (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) NOT NULL,
  description TEXT,
  room_type VARCHAR(20) DEFAULT 'public',
  tier_required VARCHAR(20),
  max_members INTEGER DEFAULT 1000,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- ROOM MESSAGES TABLE (if not exists)
-- =============================================
CREATE TABLE IF NOT EXISTS community_room_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id UUID NOT NULL REFERENCES community_rooms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  message_type VARCHAR(20) DEFAULT 'text',
  is_deleted BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_room_messages_room_id ON community_room_messages(room_id);
CREATE INDEX IF NOT EXISTS idx_room_messages_created_at ON community_room_messages(created_at DESC);

-- =============================================
-- ROOM MEMBERS TABLE (if not exists)
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
-- ONLINE USERS TABLE (if not exists)
-- =============================================
CREATE TABLE IF NOT EXISTS community_online_users (
  user_id UUID PRIMARY KEY REFERENCES user_profiles(id) ON DELETE CASCADE,
  last_seen TIMESTAMPTZ DEFAULT NOW(),
  status VARCHAR(20) DEFAULT 'online'
);

-- =============================================
-- RATE LIMITS TABLE (if not exists)
-- =============================================
CREATE TABLE IF NOT EXISTS community_rate_limits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  action_type VARCHAR(50) NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  action_count INTEGER DEFAULT 1,
  UNIQUE(user_id, action_type, window_start)
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_lookup ON community_rate_limits(user_id, action_type, window_start);

-- =============================================
-- FUNCTIONS
-- =============================================

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

-- =============================================
-- TRIGGERS (drop and recreate)
-- =============================================

DROP TRIGGER IF EXISTS trigger_update_comment_count ON community_comments;
CREATE TRIGGER trigger_update_comment_count
AFTER INSERT OR UPDATE OR DELETE ON community_comments
FOR EACH ROW EXECUTE FUNCTION update_post_comment_count();

DROP TRIGGER IF EXISTS trigger_update_like_count ON community_post_likes;
CREATE TRIGGER trigger_update_like_count
AFTER INSERT OR DELETE ON community_post_likes
FOR EACH ROW EXECUTE FUNCTION update_post_like_count();

-- =============================================
-- ENABLE RLS
-- =============================================

ALTER TABLE community_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_post_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_room_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_room_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_online_users ENABLE ROW LEVEL SECURITY;

-- =============================================
-- RLS POLICIES (drop existing first)
-- =============================================

-- Posts policies
DROP POLICY IF EXISTS "Posts are viewable by everyone" ON community_posts;
CREATE POLICY "Posts are viewable by everyone" ON community_posts FOR SELECT USING (is_deleted = FALSE);

DROP POLICY IF EXISTS "Users can create posts" ON community_posts;
CREATE POLICY "Users can create posts" ON community_posts FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own posts" ON community_posts;
CREATE POLICY "Users can update own posts" ON community_posts FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own posts" ON community_posts;
CREATE POLICY "Users can delete own posts" ON community_posts FOR DELETE USING (auth.uid() = user_id);

-- Comments policies
DROP POLICY IF EXISTS "Comments are viewable by everyone" ON community_comments;
CREATE POLICY "Comments are viewable by everyone" ON community_comments FOR SELECT USING (is_deleted = FALSE);

DROP POLICY IF EXISTS "Users can create comments" ON community_comments;
CREATE POLICY "Users can create comments" ON community_comments FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own comments" ON community_comments;
CREATE POLICY "Users can update own comments" ON community_comments FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own comments" ON community_comments;
CREATE POLICY "Users can delete own comments" ON community_comments FOR DELETE USING (auth.uid() = user_id);

-- Likes policies
DROP POLICY IF EXISTS "Likes are viewable by everyone" ON community_post_likes;
CREATE POLICY "Likes are viewable by everyone" ON community_post_likes FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS "Users can like posts" ON community_post_likes;
CREATE POLICY "Users can like posts" ON community_post_likes FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can unlike posts" ON community_post_likes;
CREATE POLICY "Users can unlike posts" ON community_post_likes FOR DELETE USING (auth.uid() = user_id);

-- Rooms policies
DROP POLICY IF EXISTS "Public rooms are viewable" ON community_rooms;
CREATE POLICY "Public rooms are viewable" ON community_rooms FOR SELECT USING (room_type = 'public' OR is_active = TRUE);

-- Room messages policies
DROP POLICY IF EXISTS "Room members can view messages" ON community_room_messages;
CREATE POLICY "Room members can view messages" ON community_room_messages FOR SELECT
USING (
  EXISTS (SELECT 1 FROM community_room_members WHERE room_id = community_room_messages.room_id AND user_id = auth.uid())
  OR EXISTS (SELECT 1 FROM community_rooms WHERE id = community_room_messages.room_id AND room_type = 'public')
);

DROP POLICY IF EXISTS "Users can send messages" ON community_room_messages;
CREATE POLICY "Users can send messages" ON community_room_messages FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Online users policies
DROP POLICY IF EXISTS "Online users are viewable" ON community_online_users;
CREATE POLICY "Online users are viewable" ON community_online_users FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS "Users can update own status" ON community_online_users;
CREATE POLICY "Users can update own status" ON community_online_users FOR ALL USING (auth.uid() = user_id);

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

-- Done!
SELECT 'Migration complete!' as status;
