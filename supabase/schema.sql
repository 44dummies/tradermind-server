-- ============================================
-- TRADERMIND COMPLETE SUPABASE SCHEMA v3.0
-- ============================================
-- Combined schema for TraderMind trading platform
-- Includes: User profiles, Trading data, Chat system, Community
-- 
-- Project: endiwbrphlynhldnkgzf (eu-north-1)
-- URL: https://endiwbrphlynhldnkgzf.supabase.co
-- ============================================

-- ============================================
-- ENUM TYPES
-- ============================================

DO $$ BEGIN
    CREATE TYPE "TraderLevel" AS ENUM ('BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "MessageStatus" AS ENUM ('SENT', 'DELIVERED', 'READ', 'FLAGGED', 'DELETED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "ModerationAction" AS ENUM ('WARNING', 'MUTE', 'KICK', 'BAN', 'NONE');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- ============================================
-- 1. USER TABLE (Chat Users)
-- ============================================

CREATE TABLE IF NOT EXISTS "User" (
    "id" TEXT NOT NULL,
    "derivId" TEXT NOT NULL,
    "email" TEXT,
    "fullName" TEXT,
    "country" TEXT,
    "preferredLanguage" TEXT DEFAULT 'en',
    "traderLevel" "TraderLevel" NOT NULL DEFAULT 'BEGINNER',
    "tradingInterests" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "bio" TEXT,
    "avatarUrl" TEXT,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "lastSeen" TIMESTAMP(3),
    "isMuted" BOOLEAN NOT NULL DEFAULT false,
    "mutedUntil" TIMESTAMP(3),
    "isBanned" BOOLEAN NOT NULL DEFAULT false,
    "banReason" TEXT,
    "warningCount" INTEGER NOT NULL DEFAULT 0,
    "totalProfitLoss" DOUBLE PRECISION DEFAULT 0,
    "winRate" DOUBLE PRECISION DEFAULT 0,
    "totalTrades" INTEGER DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "User_derivId_key" ON "User"("derivId");
CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User"("email");

-- ============================================
-- 2. PROFILES TABLE (Deriv User Profiles)
-- ============================================

CREATE TABLE IF NOT EXISTS profiles (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    deriv_login_id TEXT UNIQUE NOT NULL,
    email TEXT,
    fullname TEXT,
    currency TEXT DEFAULT 'USD',
    is_virtual BOOLEAN DEFAULT false,
    last_login TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_select" ON profiles FOR SELECT USING (true);
CREATE POLICY "profiles_insert" ON profiles FOR INSERT WITH CHECK (true);
CREATE POLICY "profiles_update" ON profiles FOR UPDATE USING (true);

-- ============================================
-- 3. CHATROOM TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS "Chatroom" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL DEFAULT 'general',
    "traderLevel" "TraderLevel",
    "tradingInterest" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "maxMembers" INTEGER NOT NULL DEFAULT 50,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Chatroom_pkey" PRIMARY KEY ("id")
);

-- ============================================
-- 4. MESSAGE TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS "Message" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "chatroomId" TEXT NOT NULL,
    "status" "MessageStatus" NOT NULL DEFAULT 'SENT',
    "replyToId" TEXT,
    "isEdited" BOOLEAN NOT NULL DEFAULT false,
    "editedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Message_chatroomId_idx" ON "Message"("chatroomId");
CREATE INDEX IF NOT EXISTS "Message_senderId_idx" ON "Message"("senderId");
CREATE INDEX IF NOT EXISTS "Message_createdAt_idx" ON "Message"("createdAt");

-- ============================================
-- 5. USER-CHATROOM JUNCTION TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS "UserChatroom" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "chatroomId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastReadAt" TIMESTAMP(3),
    "isMuted" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "UserChatroom_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "UserChatroom_userId_chatroomId_key" ON "UserChatroom"("userId", "chatroomId");

-- ============================================
-- 6. FRIEND TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS "Friend" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "friendId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Friend_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Friend_userId_friendId_key" ON "Friend"("userId", "friendId");

-- ============================================
-- 7. REFRESH TOKEN TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS "RefreshToken" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "RefreshToken_token_key" ON "RefreshToken"("token");

-- ============================================
-- 8. MODERATION LOG TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS "ModerationLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "moderatorId" TEXT,
    "action" "ModerationAction" NOT NULL,
    "reason" TEXT NOT NULL,
    "messageId" TEXT,
    "chatroomId" TEXT,
    "duration" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ModerationLog_pkey" PRIMARY KEY ("id")
);

-- ============================================
-- 9. COMMUNITY POST TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS "CommunityPost" (
    "id" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'general',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "likesCount" INTEGER NOT NULL DEFAULT 0,
    "commentsCount" INTEGER NOT NULL DEFAULT 0,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CommunityPost_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CommunityPost_authorId_idx" ON "CommunityPost"("authorId");
CREATE INDEX IF NOT EXISTS "CommunityPost_category_idx" ON "CommunityPost"("category");

-- ============================================
-- 10. POST COMMENT TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS "PostComment" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "parentId" TEXT,
    "likesCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PostComment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PostComment_postId_idx" ON "PostComment"("postId");

-- ============================================
-- 11. POST LIKE TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS "PostLike" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PostLike_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PostLike_postId_userId_key" ON "PostLike"("postId", "userId");

-- ============================================
-- 12. JOURNAL ENTRIES TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS journal_entries (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    deriv_login_id TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    mood TEXT DEFAULT 'neutral' CHECK (mood IN ('great', 'good', 'neutral', 'bad')),
    tags TEXT[] DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "journal_select" ON journal_entries FOR SELECT USING (true);
CREATE POLICY "journal_insert" ON journal_entries FOR INSERT WITH CHECK (true);
CREATE POLICY "journal_delete" ON journal_entries FOR DELETE USING (true);
CREATE INDEX IF NOT EXISTS idx_journal_entries_login ON journal_entries(deriv_login_id);

-- ============================================
-- 13. TRADES TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS trades (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    deriv_login_id TEXT NOT NULL,
    contract_id TEXT NOT NULL,
    symbol TEXT,
    buy_price DECIMAL(20, 8) DEFAULT 0,
    sell_price DECIMAL(20, 8) DEFAULT 0,
    profit DECIMAL(20, 8) DEFAULT 0,
    purchase_time TIMESTAMPTZ,
    sell_time TIMESTAMPTZ,
    shortcode TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(deriv_login_id, contract_id)
);

ALTER TABLE trades ENABLE ROW LEVEL SECURITY;
CREATE POLICY "trades_select" ON trades FOR SELECT USING (true);
CREATE POLICY "trades_insert" ON trades FOR INSERT WITH CHECK (true);
CREATE POLICY "trades_update" ON trades FOR UPDATE USING (true);
CREATE INDEX IF NOT EXISTS idx_trades_login ON trades(deriv_login_id);
CREATE INDEX IF NOT EXISTS idx_trades_sell_time ON trades(sell_time DESC);

-- ============================================
-- 14. USER SETTINGS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS user_settings (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    deriv_login_id TEXT UNIQUE NOT NULL,
    theme TEXT DEFAULT 'dark' CHECK (theme IN ('dark', 'light')),
    notifications_enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "settings_select" ON user_settings FOR SELECT USING (true);
CREATE POLICY "settings_insert" ON user_settings FOR INSERT WITH CHECK (true);
CREATE POLICY "settings_update" ON user_settings FOR UPDATE USING (true);

-- ============================================
-- 15. ANALYTICS CACHE TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS analytics_cache (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    deriv_login_id TEXT UNIQUE NOT NULL,
    total_trades INTEGER DEFAULT 0,
    win_rate DECIMAL(5, 2) DEFAULT 0,
    total_profit DECIMAL(20, 8) DEFAULT 0,
    avg_profit DECIMAL(20, 8) DEFAULT 0,
    best_trade DECIMAL(20, 8) DEFAULT 0,
    worst_trade DECIMAL(20, 8) DEFAULT 0,
    win_streak INTEGER DEFAULT 0,
    loss_streak INTEGER DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE analytics_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "analytics_select" ON analytics_cache FOR SELECT USING (true);
CREATE POLICY "analytics_insert" ON analytics_cache FOR INSERT WITH CHECK (true);
CREATE POLICY "analytics_update" ON analytics_cache FOR UPDATE USING (true);

-- ============================================
-- 16. SESSION LOGS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS session_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    deriv_login_id TEXT NOT NULL,
    login_time TIMESTAMPTZ DEFAULT NOW(),
    logout_time TIMESTAMPTZ,
    logout_reason TEXT,
    user_agent TEXT,
    ip_address INET
);

ALTER TABLE session_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "session_select" ON session_logs FOR SELECT USING (true);
CREATE POLICY "session_insert" ON session_logs FOR INSERT WITH CHECK (true);
CREATE POLICY "session_update" ON session_logs FOR UPDATE USING (true);
CREATE INDEX IF NOT EXISTS idx_session_logs_login ON session_logs(deriv_login_id);

-- ============================================
-- FOREIGN KEYS
-- ============================================

ALTER TABLE "Message" DROP CONSTRAINT IF EXISTS "Message_senderId_fkey";
ALTER TABLE "Message" ADD CONSTRAINT "Message_senderId_fkey" 
    FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Message" DROP CONSTRAINT IF EXISTS "Message_chatroomId_fkey";
ALTER TABLE "Message" ADD CONSTRAINT "Message_chatroomId_fkey" 
    FOREIGN KEY ("chatroomId") REFERENCES "Chatroom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserChatroom" DROP CONSTRAINT IF EXISTS "UserChatroom_userId_fkey";
ALTER TABLE "UserChatroom" ADD CONSTRAINT "UserChatroom_userId_fkey" 
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserChatroom" DROP CONSTRAINT IF EXISTS "UserChatroom_chatroomId_fkey";
ALTER TABLE "UserChatroom" ADD CONSTRAINT "UserChatroom_chatroomId_fkey" 
    FOREIGN KEY ("chatroomId") REFERENCES "Chatroom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Friend" DROP CONSTRAINT IF EXISTS "Friend_userId_fkey";
ALTER TABLE "Friend" ADD CONSTRAINT "Friend_userId_fkey" 
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Friend" DROP CONSTRAINT IF EXISTS "Friend_friendId_fkey";
ALTER TABLE "Friend" ADD CONSTRAINT "Friend_friendId_fkey" 
    FOREIGN KEY ("friendId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RefreshToken" DROP CONSTRAINT IF EXISTS "RefreshToken_userId_fkey";
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" 
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CommunityPost" DROP CONSTRAINT IF EXISTS "CommunityPost_authorId_fkey";
ALTER TABLE "CommunityPost" ADD CONSTRAINT "CommunityPost_authorId_fkey" 
    FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PostComment" DROP CONSTRAINT IF EXISTS "PostComment_postId_fkey";
ALTER TABLE "PostComment" ADD CONSTRAINT "PostComment_postId_fkey" 
    FOREIGN KEY ("postId") REFERENCES "CommunityPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PostComment" DROP CONSTRAINT IF EXISTS "PostComment_authorId_fkey";
ALTER TABLE "PostComment" ADD CONSTRAINT "PostComment_authorId_fkey" 
    FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PostLike" DROP CONSTRAINT IF EXISTS "PostLike_postId_fkey";
ALTER TABLE "PostLike" ADD CONSTRAINT "PostLike_postId_fkey" 
    FOREIGN KEY ("postId") REFERENCES "CommunityPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PostLike" DROP CONSTRAINT IF EXISTS "PostLike_userId_fkey";
ALTER TABLE "PostLike" ADD CONSTRAINT "PostLike_userId_fkey" 
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================
-- HELPER FUNCTION: Auto-update timestamp
-- ============================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply triggers
DROP TRIGGER IF EXISTS update_profiles_updated_at ON profiles;
CREATE TRIGGER update_profiles_updated_at
    BEFORE UPDATE ON profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_journal_entries_updated_at ON journal_entries;
CREATE TRIGGER update_journal_entries_updated_at
    BEFORE UPDATE ON journal_entries
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_user_settings_updated_at ON user_settings;
CREATE TRIGGER update_user_settings_updated_at
    BEFORE UPDATE ON user_settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- DEFAULT CHATROOMS
-- ============================================

INSERT INTO "Chatroom" ("id", "name", "description", "type", "traderLevel")
VALUES 
    ('room-beginners', 'Beginners Lounge', 'Welcome! A friendly space for new traders', 'level_based', 'BEGINNER'),
    ('room-intermediate', 'Intermediate Traders', 'Level up your trading game', 'level_based', 'INTERMEDIATE'),
    ('room-advanced', 'Advanced Strategies', 'Deep dive into advanced techniques', 'level_based', 'ADVANCED'),
    ('room-experts', 'Expert Circle', 'Elite traders discussion', 'level_based', 'EXPERT'),
    ('room-general', 'General Discussion', 'Open chat for all traders', 'general', NULL)
ON CONFLICT ("id") DO NOTHING;

-- ============================================
-- SCHEMA COMPLETE
-- ============================================
