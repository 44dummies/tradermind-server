/**
 * User Routes
 */

const express = require('express');
const multer = require('multer');
const { 
  getUserProfile,
  updateUserProfile,
  saveProfilePicture,
  deleteProfilePicture,
  searchUsersByUsername,
  getPublicProfile,
  sendFriendRequest,
  acceptFriendRequest,
  declineFriendRequest,
  getFriendList,
  getPendingRequests,
  removeFriend,
  blockUser,
  unblockUser
} = require('../services/profile');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

/**
 * Get current user profile
 * GET /api/users/me
 */
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const profile = await getUserProfile(req.userId);
    if (!profile) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(profile);
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: 'Failed to get profile' });
  }
});

/**
 * Update current user profile
 * PUT /api/users/me
 */
router.put('/me', authMiddleware, async (req, res) => {
  try {
    const profile = await updateUserProfile(req.userId, req.body);
    res.json(profile);
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

/**
 * Upload profile picture
 * POST /api/users/me/avatar
 */
router.post('/me/avatar', authMiddleware, upload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }
    const avatarUrl = await saveProfilePicture(req.userId, req.file);
    res.json({ avatarUrl });
  } catch (error) {
    console.error('Upload avatar error:', error);
    res.status(500).json({ error: 'Failed to upload avatar' });
  }
});

/**
 * Delete profile picture
 * DELETE /api/users/me/avatar
 */
router.delete('/me/avatar', authMiddleware, async (req, res) => {
  try {
    await deleteProfilePicture(req.userId);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete avatar error:', error);
    res.status(500).json({ error: 'Failed to delete avatar' });
  }
});

/**
 * Search users by username
 * GET /api/users/search?q=username
 */
router.get('/search', authMiddleware, async (req, res) => {
  try {
    const { q, limit } = req.query;
    if (!q || q.length < 2) {
      return res.status(400).json({ error: 'Search query must be at least 2 characters' });
    }
    const users = await searchUsersByUsername(q, parseInt(limit) || 20, req.userId);
    res.json(users);
  } catch (error) {
    console.error('Search users error:', error);
    res.status(500).json({ error: 'Failed to search users' });
  }
});

/**
 * Get user public profile by username
 * GET /api/users/:username
 */
router.get('/:username', authMiddleware, async (req, res) => {
  try {
    const profile = await getPublicProfile(req.params.username);
    if (!profile) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(profile);
  } catch (error) {
    console.error('Get public profile error:', error);
    res.status(500).json({ error: 'Failed to get profile' });
  }
});

// ============ Friends Routes ============

/**
 * Get friend list
 * GET /api/users/friends/list
 */
router.get('/friends/list', authMiddleware, async (req, res) => {
  try {
    const friends = await getFriendList(req.userId);
    res.json(friends);
  } catch (error) {
    console.error('Get friends error:', error);
    res.status(500).json({ error: 'Failed to get friends' });
  }
});

/**
 * Get pending friend requests
 * GET /api/users/friends/pending
 */
router.get('/friends/pending', authMiddleware, async (req, res) => {
  try {
    const requests = await getPendingRequests(req.userId);
    res.json(requests);
  } catch (error) {
    console.error('Get pending requests error:', error);
    res.status(500).json({ error: 'Failed to get pending requests' });
  }
});

/**
 * Send friend request
 * POST /api/users/friends/request
 */
router.post('/friends/request', authMiddleware, async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) {
      return res.status(400).json({ error: 'Username is required' });
    }
    const result = await sendFriendRequest(req.userId, username);
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    res.json(result);
  } catch (error) {
    console.error('Send friend request error:', error);
    res.status(500).json({ error: 'Failed to send friend request' });
  }
});

/**
 * Accept friend request
 * POST /api/users/friends/accept/:requestId
 */
router.post('/friends/accept/:requestId', authMiddleware, async (req, res) => {
  try {
    const result = await acceptFriendRequest(req.userId, req.params.requestId);
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    res.json(result);
  } catch (error) {
    console.error('Accept friend request error:', error);
    res.status(500).json({ error: 'Failed to accept friend request' });
  }
});

/**
 * Decline friend request
 * POST /api/users/friends/decline/:requestId
 */
router.post('/friends/decline/:requestId', authMiddleware, async (req, res) => {
  try {
    const result = await declineFriendRequest(req.userId, req.params.requestId);
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    res.json(result);
  } catch (error) {
    console.error('Decline friend request error:', error);
    res.status(500).json({ error: 'Failed to decline friend request' });
  }
});

/**
 * Remove friend
 * DELETE /api/users/friends/:friendshipId
 */
router.delete('/friends/:friendshipId', authMiddleware, async (req, res) => {
  try {
    const result = await removeFriend(req.userId, req.params.friendshipId);
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    res.json(result);
  } catch (error) {
    console.error('Remove friend error:', error);
    res.status(500).json({ error: 'Failed to remove friend' });
  }
});

/**
 * Block user
 * POST /api/users/block
 */
router.post('/block', authMiddleware, async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) {
      return res.status(400).json({ error: 'Username is required' });
    }
    const result = await blockUser(req.userId, username);
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    res.json(result);
  } catch (error) {
    console.error('Block user error:', error);
    res.status(500).json({ error: 'Failed to block user' });
  }
});

/**
 * Unblock user
 * POST /api/users/unblock
 */
router.post('/unblock', authMiddleware, async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) {
      return res.status(400).json({ error: 'Username is required' });
    }
    const result = await unblockUser(req.userId, username);
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    res.json(result);
  } catch (error) {
    console.error('Unblock user error:', error);
    res.status(500).json({ error: 'Failed to unblock user' });
  }
});

// ============ Settings Routes ============

const FriendsService = require('../services/friends');
const { supabase } = require('../db/supabase');

/**
 * Get user settings
 * GET /api/users/settings
 */
router.get('/settings', authMiddleware, async (req, res) => {
  try {
    // Get user profile by derivId (which is stored in req.user.derivId)
    let user = await FriendsService.getProfileByDerivId(req.user.derivId);
    
    // If user doesn't exist, create a new profile
    if (!user) {
      console.log('User not found, creating profile for:', req.user.derivId);
      user = await FriendsService.upsertUserProfile(req.user.derivId, {
        username: `trader_${req.user.derivId.toLowerCase()}`,
        fullname: null,
        email: null,
        country: null
      });
    }

    // Get settings from user_settings table or use defaults
    const { data: settings } = await supabase
      .from('user_settings')
      .select('*')
      .eq('user_id', user.id)
      .single();

    res.json({
      profile: {
        username: user.username,
        display_name: user.display_name || user.fullname,
        fullname: user.fullname,
        bio: user.bio || '',
        status_message: user.status_message || '',
        profile_photo: user.profile_photo,
        profile_photo_metadata: user.profile_photo_metadata,
        email: user.email,
        country: user.country,
        deriv_id: user.deriv_id,
        performance_tier: user.performance_tier,
      },
      privacy: settings?.privacy || {
        showUsername: true,
        showRealName: false,
        showEmail: false,
        showCountry: true,
        showPerformance: true,
        showOnlineStatus: true,
        profileVisibility: 'public',
        allowFriendRequests: true,
        allowMessages: 'friends',
      },
      notifications: settings?.notifications || {
        friendRequests: true,
        messages: true,
        chatMentions: true,
        achievements: true,
        streakReminders: true,
        communityUpdates: true,
        soundEnabled: true,
        pushEnabled: false,
      },
      chat: settings?.chat || {
        enterToSend: true,
        showTypingIndicator: true,
        showReadReceipts: true,
        autoDeleteMessages: false,
        messageRetention: 30,
      },
    });
  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({ error: 'Failed to get settings' });
  }
});

/**
 * Update user settings
 * PUT /api/users/settings
 */
router.put('/settings', authMiddleware, async (req, res) => {
  try {
    const { profile, privacy, notifications, chat } = req.body;
    
    // Get user profile or create if doesn't exist
    let user = await FriendsService.getProfileByDerivId(req.user.derivId);
    if (!user) {
      console.log('User not found during settings update, creating profile for:', req.user.derivId);
      user = await FriendsService.upsertUserProfile(req.user.derivId, {
        username: `trader_${req.user.derivId.toLowerCase()}`,
        fullname: null,
        email: null,
        country: null
      });
    }

    // Validate username uniqueness if changed
    if (profile?.username && profile.username.toLowerCase() !== user.username?.toLowerCase()) {
      const { data: existingUser } = await supabase
        .from('user_profiles')
        .select('id')
        .ilike('username', profile.username)
        .neq('id', user.id)
        .single();
      
      if (existingUser) {
        return res.status(400).json({ error: 'Username already taken' });
      }
    }

    // Update profile
    if (profile) {
      const profileUpdate = {
        updated_at: new Date().toISOString()
      };
      if (profile.username) profileUpdate.username = profile.username.toLowerCase();
      if (profile.display_name !== undefined) profileUpdate.display_name = profile.display_name;
      if (profile.fullname !== undefined) profileUpdate.fullname = profile.fullname;
      if (profile.bio !== undefined) profileUpdate.bio = profile.bio;
      if (profile.status_message !== undefined) profileUpdate.status_message = profile.status_message;
      if (profile.profile_photo !== undefined) profileUpdate.profile_photo = profile.profile_photo;
      if (profile.profile_photo_metadata !== undefined) {
        profileUpdate.profile_photo_metadata = profile.profile_photo_metadata;
      }

      console.log('Updating profile for user:', user.id, 'with:', profileUpdate);
      
      const { error: updateError } = await supabase
        .from('user_profiles')
        .update(profileUpdate)
        .eq('id', user.id);
      
      if (updateError) {
        console.error('Profile update error:', updateError);
        throw updateError;
      }
    }

    // Upsert settings
    const settingsData = {
      user_id: user.id,
      privacy: privacy || {},
      notifications: notifications || {},
      chat: chat || {},
      updated_at: new Date().toISOString(),
    };

    console.log('Upserting settings for user:', user.id);
    
    const { error: settingsError } = await supabase
      .from('user_settings')
      .upsert(settingsData, { onConflict: 'user_id' });
    
    if (settingsError) {
      console.error('Settings upsert error:', settingsError);
      throw settingsError;
    }

    res.json({ success: true, message: 'Settings updated successfully' });
  } catch (error) {
    console.error('Update settings error:', error);
    res.status(500).json({ error: 'Failed to update settings: ' + error.message });
  }
});

/**
 * Check username availability
 * GET /api/users/check-username/:username
 */
router.get('/check-username/:username', authMiddleware, async (req, res) => {
  try {
    const username = req.params.username.toLowerCase();
    
    // Validate format
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
      return res.json({ available: false, reason: 'Invalid format' });
    }

    const { data: existingUser } = await supabase
      .from('user_profiles')
      .select('id')
      .eq('username', username)
      .single();

    res.json({ 
      available: !existingUser,
      reason: existingUser ? 'Username taken' : null
    });
  } catch (error) {
    console.error('Check username error:', error);
    res.status(500).json({ error: 'Failed to check username' });
  }
});

module.exports = router;
