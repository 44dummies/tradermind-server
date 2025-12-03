-- Username Search Function for Friends Service
-- Run this in Supabase SQL Editor after the main migration

-- Enable the pg_trgm extension for fuzzy text search (if not already enabled)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Create the search function
CREATE OR REPLACE FUNCTION search_users_by_username(
  search_term TEXT,
  current_user_id UUID,
  result_limit INTEGER DEFAULT 20
)
RETURNS TABLE (
  id UUID,
  username VARCHAR(50),
  fullname VARCHAR(100),
  display_name VARCHAR(50),
  country VARCHAR(100),
  profile_photo TEXT,
  status_message VARCHAR(100),
  performance_tier VARCHAR(20),
  is_online BOOLEAN,
  similarity_score FLOAT,
  friendship_status TEXT
) AS $$
BEGIN
  RETURN QUERY
  WITH searched_users AS (
    SELECT 
      up.id,
      up.username,
      up.fullname,
      up.display_name,
      up.country,
      up.profile_photo,
      up.status_message,
      up.performance_tier,
      up.is_online,
      GREATEST(
        similarity(LOWER(up.username), LOWER(search_term)),
        similarity(LOWER(COALESCE(up.display_name, '')), LOWER(search_term)),
        similarity(LOWER(COALESCE(up.fullname, '')), LOWER(search_term))
      ) AS sim_score
    FROM user_profiles up
    LEFT JOIN user_settings us ON us.user_id = up.id
    WHERE 
      up.id != current_user_id
      AND (
        COALESCE(us.privacy->>'profileVisibility', 'public') != 'private'
        OR us.privacy IS NULL
      )
      AND (
        COALESCE(us.privacy->>'allowFriendRequests', 'true')::boolean = true
        OR us.privacy IS NULL
      )
      AND (
        LOWER(up.username) LIKE LOWER('%' || search_term || '%')
        OR LOWER(COALESCE(up.display_name, '')) LIKE LOWER('%' || search_term || '%')
        OR LOWER(COALESCE(up.fullname, '')) LIKE LOWER('%' || search_term || '%')
        OR similarity(LOWER(up.username), LOWER(search_term)) > 0.2
      )
  ),
  with_friendship AS (
    SELECT 
      su.*,
      COALESCE(
        (SELECT f.status 
         FROM friendships f 
         WHERE (f.requester_id = current_user_id AND f.recipient_id = su.id)
            OR (f.recipient_id = current_user_id AND f.requester_id = su.id)
         LIMIT 1
        ),
        'none'
      ) AS f_status
    FROM searched_users su
  )
  SELECT 
    wf.id,
    wf.username,
    wf.fullname,
    wf.display_name,
    wf.country,
    wf.profile_photo,
    wf.status_message,
    wf.performance_tier,
    wf.is_online,
    wf.sim_score,
    wf.f_status
  FROM with_friendship wf
  ORDER BY wf.sim_score DESC, wf.is_online DESC
  LIMIT result_limit;
END;
$$ LANGUAGE plpgsql STABLE;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION search_users_by_username TO service_role;
GRANT EXECUTE ON FUNCTION search_users_by_username TO authenticated;

-- Create a function to get the display name for a user (respects privacy settings)
CREATE OR REPLACE FUNCTION get_user_display_name(
  target_user_id UUID,
  viewer_user_id UUID DEFAULT NULL
)
RETURNS TEXT AS $$
DECLARE
  result TEXT;
  privacy_settings JSONB;
  show_username BOOLEAN;
  show_real_name BOOLEAN;
BEGIN
  -- Get user profile and settings
  SELECT 
    COALESCE(us.privacy, '{}'::jsonb),
    COALESCE(up.display_name, up.username, up.deriv_id),
    up.username,
    up.fullname
  INTO privacy_settings, result
  FROM user_profiles up
  LEFT JOIN user_settings us ON us.user_id = up.id
  WHERE up.id = target_user_id;
  
  -- Check privacy settings
  show_username := COALESCE((privacy_settings->>'showUsername')::boolean, true);
  show_real_name := COALESCE((privacy_settings->>'showRealName')::boolean, false);
  
  -- Return appropriate display name based on settings
  IF show_username THEN
    SELECT COALESCE(up.display_name, up.username, up.deriv_id) INTO result
    FROM user_profiles up WHERE up.id = target_user_id;
  ELSIF show_real_name THEN
    SELECT COALESCE(up.fullname, up.username, up.deriv_id) INTO result
    FROM user_profiles up WHERE up.id = target_user_id;
  ELSE
    SELECT up.deriv_id INTO result
    FROM user_profiles up WHERE up.id = target_user_id;
  END IF;
  
  RETURN result;
END;
$$ LANGUAGE plpgsql STABLE;

GRANT EXECUTE ON FUNCTION get_user_display_name TO service_role;
GRANT EXECUTE ON FUNCTION get_user_display_name TO authenticated;

-- Create index for faster username search
DROP INDEX IF EXISTS idx_user_profiles_username_trgm;
CREATE INDEX idx_user_profiles_username_trgm 
ON user_profiles USING gin(username gin_trgm_ops);

DROP INDEX IF EXISTS idx_user_profiles_display_name_trgm;
CREATE INDEX idx_user_profiles_display_name_trgm 
ON user_profiles USING gin(display_name gin_trgm_ops);

DROP INDEX IF EXISTS idx_user_profiles_fullname_trgm;
CREATE INDEX idx_user_profiles_fullname_trgm 
ON user_profiles USING gin(fullname gin_trgm_ops);
