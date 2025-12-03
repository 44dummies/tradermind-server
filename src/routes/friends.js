/**
 * Friends API Routes
 * Handles friend search, requests, and management
 */

const express = require('express');
const router = express.Router();
const FriendsService = require('../services/friends');
const { authMiddleware } = require('../middleware/auth');

// Apply auth middleware to all routes
router.use(authMiddleware);

/**
 * Helper to get or create user profile
 */
async function getOrCreateUser(derivId) {
  let user = await FriendsService.getProfileByDerivId(derivId);
  if (!user) {
    user = await FriendsService.upsertUserProfile(derivId, {
      username: `trader_${derivId.toLowerCase()}`,
      fullname: null,
      email: null,
      country: null
    });
  }
  return user;
}

// =============================================
// USER PROFILE ROUTES
// =============================================

/**
 * GET /api/friends/profile
 * Get current user's profile
 */
router.get('/profile', async (req, res) => {
  try {
    const profile = await getOrCreateUser(req.user.derivId);
    if (!profile) {
      return res.status(500).json({ error: 'Failed to get/create profile' });
    }
    res.json(profile);
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/friends/profile/:username
 * Get user profile by username
 */
router.get('/profile/:username', async (req, res) => {
  try {
    const profile = await FriendsService.getProfileByUsername(req.params.username);
    if (!profile) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Get friendship status
    const currentUser = await getOrCreateUser(req.user.derivId);
    if (currentUser) {
      const friendship = await FriendsService.getFriendshipStatus(currentUser.id, profile.id);
      profile.friendship_status = friendship?.status || 'none';
      profile.friendship_id = friendship?.id;
    }
    
    // Hide sensitive data for non-friends
    if (profile.privacy_mode === 'friends_only' && profile.friendship_status !== 'accepted') {
      delete profile.email;
      if (!profile.show_country) delete profile.country;
      if (!profile.show_performance) delete profile.performance_tier;
    }
    
    res.json(profile);
  } catch (error) {
    console.error('Get profile by username error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/friends/profile
 * Update current user's profile
 */
router.put('/profile', async (req, res) => {
  try {
    const currentUser = await getOrCreateUser(req.user.derivId);
    if (!currentUser) {
      return res.status(404).json({ error: 'Profile not found' });
    }
    
    const allowedUpdates = [
      'username', 'fullname', 'status_message', 'bio', 'profile_photo',
      'privacy_mode', 'show_country', 'show_performance', 'show_portfolio',
      'allow_friend_requests'
    ];
    
    const updates = {};
    for (const key of allowedUpdates) {
      if (req.body[key] !== undefined) {
        updates[key] = req.body[key];
      }
    }
    
    // Validate username if changing
    if (updates.username && updates.username !== currentUser.username) {
      const existing = await FriendsService.getProfileByUsername(updates.username);
      if (existing) {
        return res.status(400).json({ error: 'Username already taken' });
      }
    }
    
    const updated = await FriendsService.updateProfile(currentUser.id, updates);
    res.json(updated);
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: error.message });
  }
});

// =============================================
// FRIEND SEARCH
// =============================================

/**
 * GET /api/friends/search?q=username
 * Search for users by username
 */
router.get('/search', async (req, res) => {
  try {
    const { q, limit = 20 } = req.query;
    
    if (!q || q.length < 2) {
      return res.status(400).json({ error: 'Search query must be at least 2 characters' });
    }
    
    const currentUser = await getOrCreateUser(req.user.derivId);
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const results = await FriendsService.searchUsers(q, currentUser.id, parseInt(limit));
    res.json(results);
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: error.message });
  }
});

// =============================================
// FRIEND REQUESTS
// =============================================

/**
 * POST /api/friends/request/:userId
 * Send friend request
 */
router.post('/request/:userId', async (req, res) => {
  try {
    const currentUser = await getOrCreateUser(req.user.derivId);
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const result = await FriendsService.sendFriendRequest(currentUser.id, req.params.userId);
    
    // Emit socket event
    const io = req.app.get('io');
    if (io) {
      io.to(`user:${req.params.userId}`).emit('friend:request', {
        from: currentUser,
        friendship: result
      });
    }
    
    res.json(result);
  } catch (error) {
    console.error('Send request error:', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /api/friends/accept/:friendshipId
 * Accept friend request
 */
router.post('/accept/:friendshipId', async (req, res) => {
  try {
    const currentUser = await getOrCreateUser(req.user.derivId);
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const result = await FriendsService.acceptFriendRequest(currentUser.id, req.params.friendshipId);
    
    // Emit socket event to both users
    const io = req.app.get('io');
    if (io && result.friendship) {
      io.to(`user:${result.friendship.user_id}`).emit('friend:accepted', {
        from: currentUser,
        friendship: result.friendship,
        chatId: result.chatId
      });
    }
    
    res.json(result);
  } catch (error) {
    console.error('Accept request error:', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /api/friends/decline/:friendshipId
 * Decline friend request
 */
router.post('/decline/:friendshipId', async (req, res) => {
  try {
    const currentUser = await getOrCreateUser(req.user.derivId);
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const result = await FriendsService.declineFriendRequest(currentUser.id, req.params.friendshipId);
    res.json(result);
  } catch (error) {
    console.error('Decline request error:', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * DELETE /api/friends/:friendId
 * Remove friend
 */
router.delete('/:friendId', async (req, res) => {
  try {
    const currentUser = await getOrCreateUser(req.user.derivId);
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const result = await FriendsService.removeFriend(currentUser.id, req.params.friendId);
    res.json(result);
  } catch (error) {
    console.error('Remove friend error:', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /api/friends/block/:userId
 * Block user
 */
router.post('/block/:userId', async (req, res) => {
  try {
    const currentUser = await getOrCreateUser(req.user.derivId);
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const result = await FriendsService.blockUser(currentUser.id, req.params.userId);
    res.json(result);
  } catch (error) {
    console.error('Block user error:', error);
    res.status(400).json({ error: error.message });
  }
});

// =============================================
// FRIEND LISTS
// =============================================

/**
 * GET /api/friends
 * Get all friends
 */
router.get('/', async (req, res) => {
  try {
    const currentUser = await getOrCreateUser(req.user.derivId);
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const friends = await FriendsService.getFriends(currentUser.id);
    res.json(friends);
  } catch (error) {
    console.error('Get friends error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/friends/requests/pending
 * Get pending friend requests (received)
 */
router.get('/requests/pending', async (req, res) => {
  try {
    const currentUser = await getOrCreateUser(req.user.derivId);
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const requests = await FriendsService.getPendingRequests(currentUser.id);
    res.json(requests);
  } catch (error) {
    console.error('Get pending requests error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/friends/requests/sent
 * Get sent friend requests
 */
router.get('/requests/sent', async (req, res) => {
  try {
    const currentUser = await getOrCreateUser(req.user.derivId);
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const requests = await FriendsService.getSentRequests(currentUser.id);
    res.json(requests);
  } catch (error) {
    console.error('Get sent requests error:', error);
    res.status(500).json({ error: error.message });
  }
});

// =============================================
// RECOMMENDATIONS
// =============================================

/**
 * GET /api/friends/recommendations
 * Get friend recommendations
 */
router.get('/recommendations', async (req, res) => {
  try {
    const currentUser = await getOrCreateUser(req.user.derivId);
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const { limit = 10 } = req.query;
    const recommendations = await FriendsService.getRecommendations(currentUser.id, parseInt(limit));
    res.json(recommendations);
  } catch (error) {
    console.error('Get recommendations error:', error);
    res.status(500).json({ error: error.message });
  }
});

// =============================================
// ONLINE STATUS
// =============================================

/**
 * PUT /api/friends/status/online
 * Update online status
 */
router.put('/status/online', async (req, res) => {
  try {
    const currentUser = await getOrCreateUser(req.user.derivId);
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const { isOnline, socketId } = req.body;
    await FriendsService.updateOnlineStatus(currentUser.id, isOnline, socketId);
    
    // Notify friends
    const io = req.app.get('io');
    if (io) {
      const friends = await FriendsService.getFriends(currentUser.id);
      for (const f of friends) {
        io.to(`user:${f.friend_id}`).emit('friend:status', {
          userId: currentUser.id,
          isOnline,
          lastSeen: new Date().toISOString()
        });
      }
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Update status error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
