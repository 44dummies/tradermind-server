/**
 * Profile Service
 * Handles user profiles and profile pictures using Supabase
 * Profile photos are stored in the database (base64) for persistence
 */

const { supabase } = require('../db/supabase');

/**
 * Get user profile by user ID (internal UUID)
 */
async function getUserProfile(userId) {
  const { data: user, error } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('id', userId)
    .single();
  
  if (error || !user) {
    console.error('getUserProfile error:', error);
    return null;
  }
  
  return {
    id: user.id,
    derivId: user.deriv_id,
    username: user.username,
    displayName: user.display_name || user.fullname,
    fullname: user.fullname,
    email: user.email,
    avatarUrl: user.profile_photo,
    profilePhotoMetadata: user.profile_photo_metadata,
    country: user.country,
    bio: user.bio,
    statusMessage: user.status_message,
    performanceTier: user.performance_tier,
    isOnline: user.is_online,
    lastSeenAt: user.last_seen_at,
    createdAt: user.created_at,
    isProfileComplete: user.is_profile_complete
  };
}

/**
 * Get user profile by Deriv ID
 */
async function getProfileByDerivId(derivId) {
  const { data: user, error } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('deriv_id', derivId)
    .single();
  
  if (error || !user) {
    return null;
  }
  
  return user;
}

/**
 * Create or update user profile
 */
async function upsertUserProfile(derivId, profileData) {
  // Check if profile exists
  const existing = await getProfileByDerivId(derivId);
  
  if (existing) {
    // Update existing profile
    const { data, error } = await supabase
      .from('user_profiles')
      .update({
        username: profileData.username || existing.username,
        display_name: profileData.display_name || existing.display_name,
        fullname: profileData.fullname || existing.fullname,
        email: profileData.email || existing.email,
        country: profileData.country || existing.country,
        bio: profileData.bio !== undefined ? profileData.bio : existing.bio,
        status_message: profileData.status_message !== undefined ? profileData.status_message : existing.status_message,
        updated_at: new Date().toISOString()
      })
      .eq('id', existing.id)
      .select()
      .single();
    
    if (error) {
      console.error('Update profile error:', error);
      throw error;
    }
    return data;
  } else {
    // Create new profile
    const { data, error } = await supabase
      .from('user_profiles')
      .insert({
        deriv_id: derivId,
        username: profileData.username || `trader_${derivId.toLowerCase().slice(0, 8)}`,
        display_name: profileData.display_name,
        fullname: profileData.fullname,
        email: profileData.email,
        country: profileData.country,
        bio: profileData.bio || '',
        status_message: profileData.status_message || '',
        performance_tier: 'beginner',
        is_online: true,
        last_seen_at: new Date().toISOString()
      })
      .select()
      .single();
    
    if (error) {
      console.error('Create profile error:', error);
      throw error;
    }
    return data;
  }
}

/**
 * Update user profile fields
 * Tries UUID first, then falls back to deriv_id
 */
async function updateUserProfile(userId, updates) {
  console.log('[Profile] updateUserProfile called with userId:', userId);
  
  const allowedFields = [
    'username', 'display_name', 'fullname', 'bio', 'status_message', 
    'email', 'country', 'profile_photo', 'profile_photo_metadata'
  ];
  
  const data = {};
  for (const field of allowedFields) {
    if (updates[field] !== undefined) {
      data[field] = updates[field];
    }
  }
  
  // Check if this is a profile completion
  if (data.username && data.display_name) {
    data.is_profile_complete = true;
  }
  
  data.updated_at = new Date().toISOString();
  
  console.log('[Profile] Data to update:', JSON.stringify(data));
  
  // Determine if userId looks like a UUID or a deriv_id
  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId);
  
  let result;
  
  if (isUUID) {
    // Try by UUID first
    console.log('[Profile] Trying update by UUID:', userId);
    result = await supabase
      .from('user_profiles')
      .update(data)
      .eq('id', userId)
      .select()
      .single();
    
    // If no match by UUID, try by deriv_id
    if (result.error && result.error.code === 'PGRST116') {
      console.log('[Profile] No match by UUID, trying deriv_id');
      result = await supabase
        .from('user_profiles')
        .update(data)
        .eq('deriv_id', userId)
        .select()
        .single();
    }
  } else {
    // userId looks like a deriv_id (e.g., CR6550175)
    console.log('[Profile] Trying update by deriv_id:', userId);
    result = await supabase
      .from('user_profiles')
      .update(data)
      .eq('deriv_id', userId)
      .select()
      .single();
    
    // If no match, try by UUID anyway
    if (result.error && result.error.code === 'PGRST116') {
      console.log('[Profile] No match by deriv_id, trying as UUID');
      result = await supabase
        .from('user_profiles')
        .update(data)
        .eq('id', userId)
        .select()
        .single();
    }
  }
  
  if (result.error) {
    console.error('[Profile] Update error:', result.error);
    throw result.error;
  }
  
  console.log('[Profile] Update successful:', result.data?.id);
  return result.data;
}

/**
 * Save profile picture
 * Stores the image as base64 data URL in the database for persistence
 */
async function saveProfilePicture(userId, file) {
  try {
    console.log('[Profile] Saving photo for userId:', userId);
    
    // Convert buffer to base64 data URL
    const base64Data = file.buffer.toString('base64');
    const mimeType = file.mimetype;
    const dataUrl = `data:${mimeType};base64,${base64Data}`;
    
    // Create metadata
    const metadata = {
      fileName: file.originalname,
      fileType: mimeType,
      fileSize: file.size,
      uploadedAt: new Date().toISOString()
    };
    
    // First try by UUID
    let result = await supabase
      .from('user_profiles')
      .update({
        profile_photo: dataUrl,
        profile_photo_metadata: metadata,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId)
      .select('profile_photo')
      .single();
    
    // If no match, try by deriv_id
    if (result.error || !result.data) {
      console.log('[Profile] User not found by id, trying deriv_id');
      result = await supabase
        .from('user_profiles')
        .update({
          profile_photo: dataUrl,
          profile_photo_metadata: metadata,
          updated_at: new Date().toISOString()
        })
        .eq('deriv_id', userId)
        .select('profile_photo')
        .single();
    }
    
    if (result.error) {
      console.error('Save profile picture error:', result.error);
      throw result.error;
    }
    
    console.log('[Profile] Photo saved to database for user:', userId, 'Size:', file.size);
    return result.data.profile_photo;
  } catch (error) {
    console.error('[Profile] Save photo error:', error);
    throw error;
  }
}

/**
 * Delete profile picture
 */
async function deleteProfilePicture(userId) {
  try {
    console.log('[Profile] Deleting photo for userId:', userId);
    
    // Try updating by UUID first
    let result = await supabase
      .from('user_profiles')
      .update({
        profile_photo: null,
        profile_photo_metadata: null,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId)
      .select('id');
    
    // If no rows updated, try by deriv_id
    if (!result.data || result.data.length === 0) {
      console.log('[Profile] No user found by id, trying deriv_id:', userId);
      result = await supabase
        .from('user_profiles')
        .update({
          profile_photo: null,
          profile_photo_metadata: null,
          updated_at: new Date().toISOString()
        })
        .eq('deriv_id', userId)
        .select('id');
    }
    
    if (result.error) {
      console.error('Delete profile picture error:', result.error);
      throw result.error;
    }
    
    console.log('[Profile] Photo deleted for user:', userId, 'Rows affected:', result.data?.length || 0);
    return { success: true };
  } catch (error) {
    console.error('[Profile] Delete photo error:', error);
    // Return success anyway - photo is effectively "deleted" if user doesn't exist
    return { success: true };
  }
}

/**
 * Search users by username (fuzzy search)
 */
async function searchUsersByUsername(query, limit = 20, excludeUserId = null) {
  if (!query || query.length < 2) {
    return [];
  }
  
  // Sanitize query
  const sanitizedQuery = query.toLowerCase().replace(/[^a-z0-9_]/g, '');
  
  let queryBuilder = supabase
    .from('user_profiles')
    .select('id, username, display_name, fullname, profile_photo, is_online, last_seen_at, performance_tier')
    .or(`username.ilike.%${sanitizedQuery}%,display_name.ilike.%${sanitizedQuery}%,fullname.ilike.%${sanitizedQuery}%`)
    .limit(limit);
  
  if (excludeUserId) {
    queryBuilder = queryBuilder.neq('id', excludeUserId);
  }
  
  const { data: users, error } = await queryBuilder;
  
  if (error) {
    console.error('Search users error:', error);
    return [];
  }
  
  // Sort by relevance (exact match first, then starts with, then contains)
  return users.sort((a, b) => {
    const aLower = (a.username || '').toLowerCase();
    const bLower = (b.username || '').toLowerCase();
    const qLower = sanitizedQuery.toLowerCase();
    
    if (aLower === qLower) return -1;
    if (bLower === qLower) return 1;
    if (aLower.startsWith(qLower)) return -1;
    if (bLower.startsWith(qLower)) return 1;
    return 0;
  }).map(user => ({
    id: user.id,
    username: user.username,
    displayName: user.display_name || user.fullname,
    avatarUrl: user.profile_photo,
    isOnline: user.is_online,
    lastSeenAt: user.last_seen_at,
    performanceTier: user.performance_tier
  }));
}

/**
 * Get public profile (for viewing other users)
 */
async function getPublicProfile(username) {
  const { data: user, error } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('username', username)
    .single();
  
  if (error || !user) {
    return null;
  }
  
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name || user.fullname,
    avatarUrl: user.profile_photo,
    bio: user.bio,
    statusMessage: user.status_message,
    performanceTier: user.performance_tier,
    isOnline: user.is_online,
    lastSeenAt: user.last_seen_at,
    createdAt: user.created_at
  };
}

/**
 * Update online status
 */
async function updateOnlineStatus(userId, isOnline) {
  const { error } = await supabase
    .from('user_profiles')
    .update({
      is_online: isOnline,
      last_seen_at: new Date().toISOString()
    })
    .eq('id', userId);
  
  if (error) {
    console.error('Update online status error:', error);
  }
}

module.exports = {
  getUserProfile,
  getProfileByDerivId,
  upsertUserProfile,
  updateUserProfile,
  saveProfilePicture,
  deleteProfilePicture,
  searchUsersByUsername,
  getPublicProfile,
  updateOnlineStatus
};
