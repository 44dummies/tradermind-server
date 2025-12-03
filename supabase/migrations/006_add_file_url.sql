-- Add file_url column to chatroom_messages table
-- This stores the persistent URL for files uploaded to Supabase Storage
-- Run this in Supabase SQL Editor

-- Add file_url column to chatroom_messages
ALTER TABLE chatroom_messages 
ADD COLUMN IF NOT EXISTS file_url TEXT;

-- Add file_url column to friend_messages
ALTER TABLE friend_messages 
ADD COLUMN IF NOT EXISTS file_url TEXT;

-- Create index for file messages
CREATE INDEX IF NOT EXISTS idx_chatroom_messages_file 
ON chatroom_messages(message_type) 
WHERE message_type IN ('image', 'video', 'file', 'voice');

CREATE INDEX IF NOT EXISTS idx_friend_messages_file 
ON friend_messages(message_type) 
WHERE message_type IN ('image', 'video', 'file', 'voice');

-- Create storage buckets if they don't exist
-- Note: This is handled by the server on startup, but can be done manually:
-- 1. Go to Supabase Dashboard > Storage
-- 2. Create buckets: chat-files, voice-notes, chatroom-files
-- 3. Set them as Public buckets

-- Add RLS policies for storage (optional - if using RLS)
-- These allow authenticated users to upload and read files

-- Policy for chat-files bucket
-- CREATE POLICY "Allow authenticated uploads to chat-files"
-- ON storage.objects FOR INSERT
-- WITH CHECK (bucket_id = 'chat-files' AND auth.role() = 'authenticated');

-- CREATE POLICY "Allow public reads from chat-files"
-- ON storage.objects FOR SELECT
-- USING (bucket_id = 'chat-files');
