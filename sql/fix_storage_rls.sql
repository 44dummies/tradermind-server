-- Supabase Storage RLS Fix
-- Run this SQL in your Supabase Dashboard -> SQL Editor

-- Allow bucket creation (for server initialization)
CREATE POLICY "Allow service role bucket creation" 
ON storage.buckets 
FOR INSERT 
TO service_role
WITH CHECK (true);

-- Allow object uploads for authenticated users
CREATE POLICY "Allow authenticated uploads" 
ON storage.objects 
FOR INSERT 
TO authenticated
WITH CHECK (true);

-- Allow public read access to certain buckets
CREATE POLICY "Allow public read" 
ON storage.objects 
FOR SELECT 
TO public
USING (bucket_id IN ('profile-photos', 'community-files'));

-- If you still get errors, you may need to use the Supabase Dashboard
-- to manually create the buckets first:
-- 1. Go to Storage in Supabase Dashboard
-- 2. Create buckets: chat-files, voice-notes, chatroom-files, profile-photos
-- 3. Set policies via the UI
