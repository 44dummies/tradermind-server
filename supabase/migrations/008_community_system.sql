-- =============================================
-- Community System Tables Migration
-- =============================================
-- Creates tables for posts, comments, and votes
-- Run this in Supabase SQL Editor
-- =============================================

-- =============================================
-- 1. COMMUNITY POSTS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS community_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  content TEXT NOT NULL,
  category VARCHAR(50) DEFAULT 'discussion',
  tags TEXT[] DEFAULT '{}',
  attachments TEXT[] DEFAULT '{}',
  upvotes INTEGER DEFAULT 0,
  downvotes INTEGER DEFAULT 0,
  view_count INTEGER DEFAULT 0,
  is_pinned BOOLEAN DEFAULT false,
  is_deleted BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_community_posts_user_id ON community_posts(user_id);
CREATE INDEX IF NOT EXISTS idx_community_posts_category ON community_posts(category);
CREATE INDEX IF NOT EXISTS idx_community_posts_created_at ON community_posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_community_posts_is_deleted ON community_posts(is_deleted);

-- =============================================
-- 2. POST COMMENTS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS post_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  parent_id UUID REFERENCES post_comments(id) ON DELETE CASCADE,
  is_deleted BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_post_comments_post_id ON post_comments(post_id);
CREATE INDEX IF NOT EXISTS idx_post_comments_user_id ON post_comments(user_id);
CREATE INDEX IF NOT EXISTS idx_post_comments_parent_id ON post_comments(parent_id);

-- =============================================
-- 3. POST VOTES TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS post_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  vote_value INTEGER NOT NULL CHECK (vote_value IN (-1, 1)),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(post_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_post_votes_post_id ON post_votes(post_id);
CREATE INDEX IF NOT EXISTS idx_post_votes_user_id ON post_votes(user_id);

-- =============================================
-- 4. RLS POLICIES
-- =============================================

-- Enable RLS
ALTER TABLE community_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_votes ENABLE ROW LEVEL SECURITY;

-- Service role full access
CREATE POLICY "Service role full access to community_posts" ON community_posts
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access to post_comments" ON post_comments
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access to post_votes" ON post_votes
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Public read access for non-deleted posts
CREATE POLICY "Anyone can view non-deleted posts" ON community_posts
  FOR SELECT USING (is_deleted = false);

CREATE POLICY "Anyone can view non-deleted comments" ON post_comments
  FOR SELECT USING (is_deleted = false);

CREATE POLICY "Anyone can view votes" ON post_votes
  FOR SELECT USING (true);

-- Authenticated users can create
CREATE POLICY "Authenticated users can create posts" ON community_posts
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can create comments" ON post_comments
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can vote" ON post_votes
  FOR INSERT TO authenticated WITH CHECK (true);

-- Users can update/delete own content
CREATE POLICY "Users can update own posts" ON community_posts
  FOR UPDATE TO authenticated USING (user_id = auth.uid());

CREATE POLICY "Users can update own comments" ON post_comments
  FOR UPDATE TO authenticated USING (user_id = auth.uid());

CREATE POLICY "Users can update own votes" ON post_votes
  FOR UPDATE TO authenticated USING (user_id = auth.uid());

CREATE POLICY "Users can delete own votes" ON post_votes
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- =============================================
-- 5. TRIGGERS FOR VOTE COUNTS
-- =============================================

-- Function to update vote counts on community_posts
CREATE OR REPLACE FUNCTION update_post_vote_counts()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.vote_value = 1 THEN
      UPDATE community_posts SET upvotes = upvotes + 1 WHERE id = NEW.post_id;
    ELSE
      UPDATE community_posts SET downvotes = downvotes + 1 WHERE id = NEW.post_id;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Remove old vote
    IF OLD.vote_value = 1 THEN
      UPDATE community_posts SET upvotes = upvotes - 1 WHERE id = OLD.post_id;
    ELSE
      UPDATE community_posts SET downvotes = downvotes - 1 WHERE id = OLD.post_id;
    END IF;
    -- Add new vote
    IF NEW.vote_value = 1 THEN
      UPDATE community_posts SET upvotes = upvotes + 1 WHERE id = NEW.post_id;
    ELSE
      UPDATE community_posts SET downvotes = downvotes + 1 WHERE id = NEW.post_id;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.vote_value = 1 THEN
      UPDATE community_posts SET upvotes = upvotes - 1 WHERE id = OLD.post_id;
    ELSE
      UPDATE community_posts SET downvotes = downvotes - 1 WHERE id = OLD.post_id;
    END IF;
    RETURN OLD;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop and recreate trigger
DROP TRIGGER IF EXISTS trigger_update_post_vote_counts ON post_votes;
CREATE TRIGGER trigger_update_post_vote_counts
  AFTER INSERT OR UPDATE OR DELETE ON post_votes
  FOR EACH ROW EXECUTE FUNCTION update_post_vote_counts();

-- =============================================
-- 6. AUTO-UPDATE TIMESTAMP TRIGGERS
-- =============================================

DROP TRIGGER IF EXISTS update_community_posts_updated_at ON community_posts;
CREATE TRIGGER update_community_posts_updated_at
  BEFORE UPDATE ON community_posts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_post_comments_updated_at ON post_comments;
CREATE TRIGGER update_post_comments_updated_at
  BEFORE UPDATE ON post_comments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================
-- 7. SCHEMA CACHE REFRESH
-- =============================================
NOTIFY pgrst, 'reload schema';

-- =============================================
-- 8. VERIFY TABLES
-- =============================================
SELECT 
  table_name,
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = t.table_name) as column_count
FROM information_schema.tables t
WHERE table_name IN ('community_posts', 'post_comments', 'post_votes')
ORDER BY table_name;
