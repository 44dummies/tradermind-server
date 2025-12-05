-- Add file columns to community_posts for sharing documents
ALTER TABLE community_posts 
ADD COLUMN IF NOT EXISTS file_url TEXT,
ADD COLUMN IF NOT EXISTS file_name TEXT,
ADD COLUMN IF NOT EXISTS file_type TEXT,
ADD COLUMN IF NOT EXISTS file_size BIGINT;

-- Create community-files storage bucket (run in Supabase dashboard or via API)
-- Bucket name: community-files
-- Public: true
-- Max file size: 10MB
-- Allowed file types: all (validated by backend)
